import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import type { Express } from "express";
import type { Browser } from "puppeteer-core";
import * as trips from "./trips";

// Real PDF files on the server (for Telegram, e-mail, download links): headless Chrome opens the web app's /print page — the
// same quotation template as the browser's "Save as PDF", so Indian scripts shape correctly — waits until every translation
// and image has arrived (<html data-print-ready="1">) and prints A4. Links are signed, so a bill can't be guessed from a trip id.
// Without Chrome (or under tests) rendering returns null and callers fall back to the web link.

export type PdfKind = "quote" | "bill";
type Renderer = (tripId: string, kind: PdfKind, lang: string) => Promise<Uint8Array | null>;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
];
export const chromePath = () => CHROME_CANDIDATES.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

let localBase = "";
/** The address this server listens on, so Chrome can open its own /print page. */
export function setLocalBaseUrl(url: string) { localBase = url.replace(/\/$/, ""); }

let override: Renderer | null = null;
/** Tests swap in a fake renderer (no Chrome). */
export function setPdfRendererForTests(renderer: Renderer | null) { override = renderer; }
export const pdfEnabled = () => Boolean(override) || (!process.env.VITEST && Boolean(localBase) && Boolean(chromePath()));

let browser: Promise<Browser> | null = null;
async function getBrowser() {
  if (!browser) {
    const executablePath = chromePath()!;
    browser = import("puppeteer-core").then(({ launch }) => launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] }));
    browser.then(instance => instance.on("disconnected", () => { browser = null; })).catch(() => { browser = null; });
  }
  return browser;
}

// Recently rendered files, keyed by what they show (a trip change makes a new key).
const cache = new Map<string, Uint8Array>();
const MAX_CACHED = 40;

async function chromeRender(tripId: string, kind: PdfKind, lang: string) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(`${localBase}/print?trip=${encodeURIComponent(tripId)}&lang=${encodeURIComponent(lang)}&kind=${kind}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.printReady), { timeout: 40000 });
    if (await page.evaluate(() => document.documentElement.dataset.printReady) !== "1") return null;
    return new Uint8Array(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The trip's quotation or bill as a PDF, in the traveller's language; null when it can't be rendered here. */
export async function renderTripPdf(tripId: string, kind: PdfKind, lang: string): Promise<Uint8Array | null> {
  if (!pdfEnabled()) return null;
  try {
    const trip = trips.getTrip(tripId);
    const key = `${tripId}|${kind}|${lang}|${trip.status}|${trip.runningTotal}|${trip.booking?.reference ?? ""}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const pdf = await (override ?? chromeRender)(tripId, kind, lang);
    if (pdf) {
      cache.set(key, pdf);
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    }
    return pdf;
  } catch (error) {
    console.warn("[pdf] render failed:", (error as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------- signed links
const secret = () => process.env.JWT_SECRET?.trim() || "packagepro-pdf-links";
const sign = (tripId: string, kind: PdfKind, lang: string) => createHmac("sha256", secret()).update(`${tripId}|${kind}|${lang}`).digest("base64url").slice(0, 22);

export function pdfPath(tripId: string, kind: PdfKind, lang: string) {
  return `/api/pdf/${encodeURIComponent(tripId)}/${kind}/${encodeURIComponent(lang)}/${sign(tripId, kind, lang)}.pdf`;
}

/** A public https link to the PDF (Railway's domain or PUBLIC_APP_URL); null when the server has no public address. */
export function publicPdfLink(tripId: string, kind: PdfKind, lang: string) {
  const base = (process.env.PUBLIC_APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}${pdfPath(tripId, kind, lang)}` : null;
}

function validSignature(tripId: string, kind: PdfKind, lang: string, signature: string) {
  const expected = Buffer.from(sign(tripId, kind, lang));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** GET /api/pdf/:trip/:kind/:lang/:signature.pdf — the quotation (any time) or the bill (only once the booking is confirmed). */
export function registerPdfRoutes(app: Express) {
  app.get("/api/pdf/:tripId/:kind/:lang/:signature.pdf", async (req, res) => {
    const { tripId, lang, signature } = req.params;
    const kind = req.params.kind === "bill" ? "bill" : req.params.kind === "quote" ? "quote" : null;
    if (!kind || !validSignature(tripId, kind, lang, signature)) return void res.status(404).send("Not found");
    let status: string;
    try { status = trips.getTrip(tripId).status; } catch { return void res.status(404).send("Not found"); }
    if (kind === "bill" && status !== "confirmed") return void res.status(409).send("The bill is issued once the booking is confirmed.");
    const pdf = await renderTripPdf(tripId, kind, lang);
    if (!pdf) return void res.status(503).send("PDF rendering is not available on this server.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="PackagePro-${kind === "bill" ? "Bill" : "Quotation"}-${tripId}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(Buffer.from(pdf));
  });
}
