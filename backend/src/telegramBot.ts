import { LANGS, t, type CopyKey, type Lang } from "../../frontend/src/i18n";
import { explainWithFreeOpenRouter, parseBudget } from "../../ai/pipeline";
import { loadBotSession, saveBotSession } from "./appStore";
import { say, type BotKey } from "./botCopy";
import { PACKAGE_POPULARITY, estimateTrip } from "./estimate";
import { cityImage } from "./insights";
import { DESTINATIONS, ORIGINS, translateMany } from "./integrations";
import { PACKAGES, getAlternatives } from "./packagepro";
import * as trips from "./trips";
import { travellerForLanguage } from "./travellers";
import { unitsFor } from "./trips";
import { MAX_VOICE_SECONDS, hear, speak, speakable, voiceEnabled } from "./voice";
import { takeToken } from "./rateLimit";
import { pdfEnabled, publicPdfLink, renderTripPdf, type PdfKind } from "./pdf";
import { REJECT_REASONS, agentChat, approvalRequired, dashboardKey, publicBase } from "./agentDesk";
import { notifyWebTraveller } from "./travellerMessages";

// PackagePro on Telegram: the same engine as the web app (live fares, PS-04 packages, per-date guide checks with
// same-language substitutes, budget negotiation, bookings), driven by inline buttons and free-text AI in 4 languages.
// Long polling, so it runs locally and on Railway without a public webhook.
// After the flight the bot walks the traveller step by step (stay → extras → guide → review), sends the quotation as a
// PDF, and — when AGENT_TELEGRAM_CHAT_ID is set — sends the booking to a travel agent's chat to approve or reject; on
// approval the traveller gets the booking confirmation and bill as a PDF plus a link. Without an agent chat it books at once.

type TripView = Awaited<ReturnType<typeof trips.getTrip>>;
type Draft = { cityId?: string; city?: string; origin?: string; departDate?: string; days?: number; travelers?: number; budget?: number; language?: string };
type WizardStep = "stay" | "extras" | "guide";
type Session = { lang: Lang; step?: "origin" | "budget" | "raiseCap"; wizard?: WizardStep; draft: Draft; tripId?: string; history: { role: "user" | "assistant"; content: string }[] };
type From = { language_code?: string; first_name?: string; username?: string };
type Button = { text: string; data?: string; url?: string };
type VoiceNote = { file_id: string; duration: number; mime_type?: string };
type Rows = Button[][];
type Update = {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; from?: { language_code?: string }; text?: string; voice?: VoiceNote; audio?: VoiceNote };
  callback_query?: { id: string; data?: string; from?: From; message?: { message_id: number; chat: { id: number } } };
};

const THEMES = ["heritage", "honeymoon", "adventure", "pilgrimage", "family", "wellness", "wildlife", "food_trail"] as const;
const GUIDE_LANG_NAMES: Record<string, string> = {
  "en-IN": "English", hi: "हिन्दी", ta: "தமிழ்", te: "తెలుగు", kn: "ಕನ್ನಡ", ml: "മലയാളം", mr: "मराठी", gu: "ગુજરાતી",
  bn: "বাংলা", pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ", ur: "اردو", as: "অসমীয়া",
};

// ---------------------------------------------------------------------------
// Telegram transport
// ---------------------------------------------------------------------------

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";

async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json() as { ok: boolean; result: T; description?: string; error_code?: number };
  if (!json.ok) throw Object.assign(new Error(`Telegram ${method}: ${json.description}`), { code: json.error_code });
  return json.result;
}

const markup = (rows?: Rows) => rows && { inline_keyboard: rows.map(row => row.map(button => button.url ? { text: button.text, url: button.url } : { text: button.text, callback_data: button.data ?? "x" })) };

// While a voice note is being answered, the first reply to that chat is turned into speech at once, in parallel with the
// rest of the answer, so the voice note follows the text within a moment instead of after every message has gone out.
const spokenReplies = new Map<string, { lang: Lang; audio?: Promise<Uint8Array | null> }>();

function captureSpoken(chatId: string, text: string) {
  const pending = spokenReplies.get(chatId);
  if (!pending || pending.audio) return;
  const words = speakable(text);
  // Spoken replies share the credit guard; when over it the text reply alone is enough.
  pending.audio = words && !takeToken("voiceSpeak", `tg:${chatId}`) ? speak(words, pending.lang).catch(() => null) : Promise.resolve(null);
}

/** Multipart upload (voice replies); the JSON helper above covers every other call. */
async function tgUpload(method: string, form: FormData, timeoutMs = 30000) {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
  const json = await response.json() as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
}

function send(chatId: string, text: string, rows?: Rows) {
  captureSpoken(chatId, text);
  return tg<{ message_id: number }>("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(rows) });
}

async function edit(chatId: string, messageId: number, text: string, rows?: Rows) {
  try {
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(rows) });
  } catch (error) {
    if (!String((error as Error).message).includes("not modified")) await send(chatId, text, rows);
  }
}

async function sendPhoto(chatId: string, photo: string | undefined, caption: string, rows?: Rows) {
  if (photo?.startsWith("http")) {
    captureSpoken(chatId, caption);
    try { return await tg("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", reply_markup: markup(rows) }, 20000); } catch { /* fall back to text */ }
  }
  return send(chatId, caption, rows);
}

/**
 * The quotation or bill as a PDF document (headless Chrome, backend/src/pdf.ts), with a button to the signed link when the
 * server has a public address. Returns false when no PDF could be made here — callers show the link instead.
 */
async function sendTripPdf(chatId: string, trip: TripView, kind: PdfKind, lang: Lang, caption: string) {
  if (!pdfEnabled()) return false;
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => undefined);
  const pdf = await renderTripPdf(trip.tripId, kind, lang);
  if (!pdf) return false;
  const link = publicPdfLink(trip.tripId, kind, lang);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (link) form.append("reply_markup", JSON.stringify(markup([[{ text: say(lang, "pdfLink"), url: link }]])));
  form.append("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), `PackagePro-${kind === "bill" ? "Bill" : "Quotation"}-${trip.booking?.reference ?? trip.tripId}.pdf`);
  return tgUpload("sendDocument", form, 60000).then(() => true, error => { console.warn("[telegram] PDF upload failed:", (error as Error).message); return false; });
}

const typing = (chatId: string) => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const locale = (lang: Lang) => (lang === "en-IN" ? "en-IN" : `${lang}-IN`);
const shortDate = (iso: string, lang: Lang) => new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const addDays = (iso: string, days: number) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const copyKey = (lang: Lang, key: string, fallback: string) => t(lang, key as CopyKey) || fallback;
const specName = (lang: Lang, spec: string) => copyKey(lang, `spec_${spec}`, spec);
const cleanDetail = (detail: string) => detail.replace(/^Day \d+ · \w+ · /, "");
/** Model replies use **bold**; Telegram HTML needs <b>. */
const richText = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Dataset content (package names, cities, activities) in the user's language; cached server-side after the first call. */
async function translator(lang: Lang, texts: string[]) {
  if (lang === "en-IN") return (text: string) => text;
  const map = await translateMany(texts.filter(Boolean), lang);
  return (text: string) => map[text] || text;
}

function webLink(tripId: string) {
  const base = publicBase();
  return base ? `${base}/#trip=${tripId}` : null;
}

// ---------------------------------------------------------------------------
// Sessions (persisted in the app database; one queue per chat so updates apply in order)
// ---------------------------------------------------------------------------

function loadSession(chatId: string, languageCode?: string): { session: Session; fresh: boolean } {
  const saved = loadBotSession<Session>(chatId);
  if (saved) return { session: saved, fresh: false };
  const guess = (["hi", "ta", "te"] as const).find(code => languageCode?.startsWith(code));
  return { session: { lang: guess ?? "en-IN", draft: {}, history: [] }, fresh: true };
}

const queues = new Map<string, Promise<void>>();
function enqueue(chatId: string, job: () => Promise<void>) {
  const next = (queues.get(chatId) ?? Promise.resolve()).then(job).catch(error => console.warn("[telegram]", (error as Error).message));
  queues.set(chatId, next);
  void next.finally(() => { if (queues.get(chatId) === next) queues.delete(chatId); });
  return next;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

async function showWelcome(chatId: string) {
  await send(chatId, say("en-IN", "welcome"), [LANGS.slice(0, 2).map(lang => ({ text: lang.native, data: `L:${lang.value}` })), LANGS.slice(2).map(lang => ({ text: lang.native, data: `L:${lang.value}` }))]);
}

async function showMenu(chatId: string, s: Session, lead?: string) {
  await send(chatId, `${lead ? `${lead}\n\n` : ""}${say(s.lang, "menu")}`, [
    [{ text: say(s.lang, "btnBrowse"), data: "M:browse" }, { text: say(s.lang, "btnAi"), data: "M:ai" }],
    [{ text: say(s.lang, "btnTrip"), data: "M:trip" }, { text: say(s.lang, "btnLang"), data: "M:lang" }],
    [{ text: say(s.lang, "btnDemo"), data: "M:demo" }],
  ]);
}

/** One-tap demo: Delhi → Thanjavur on 28 Sept with a Tamil guide; Meera Novak is busy that day, Arjun Nair is free. */
async function startDemo(chatId: string, s: Session) {
  const cityId = DESTINATIONS.find(item => item.city === "Thanjavur")?.code;
  if (!cityId) return showMenu(chatId, s);
  startPlanning(s, cityId);
  s.draft = { ...s.draft, origin: "DEL", departDate: "2026-09-28", days: 3, travelers: 4, budget: 150000, language: "ta" };
  await send(chatId, say(s.lang, "demoIntro"));
  return runEstimate(chatId, s);
}

async function showThemes(chatId: string, s: Session) {
  const rows: Rows = [[{ text: say(s.lang, "mostBooked"), data: "T:all" }]];
  for (let index = 0; index < THEMES.length; index += 2) rows.push(THEMES.slice(index, index + 2).map(theme => ({ text: copyKey(s.lang, `theme_${theme}`, theme), data: `T:${theme}` })));
  await send(chatId, say(s.lang, "pickTheme"), rows);
}

async function showPackageList(chatId: string, s: Session, theme: string) {
  const list = PACKAGES.filter(pkg => theme === "all" || pkg.tags.includes(theme) || pkg.theme === theme)
    .sort((a, b) => (PACKAGE_POPULARITY[b.cityId]?.bookings ?? 0) - (PACKAGE_POPULARITY[a.cityId]?.bookings ?? 0)).slice(0, 8);
  const tr = await translator(s.lang, list.map(pkg => pkg.name));
  await send(chatId, say(s.lang, "packagesFor"), [...list.map(pkg => [{ text: `${tr(pkg.name)} · ${money(pkg.basePrice)}`, data: `P:${pkg.id}` }]), [{ text: say(s.lang, "back"), data: "M:browse" }]]);
}

async function showPackageCard(chatId: string, s: Session, packageId: string) {
  const pkg = PACKAGES.find(item => item.id === packageId);
  if (!pkg) return showThemes(chatId, s);
  const highlights = pkg.components.filter(item => item.isDefault && item.type === "experience").slice(0, 4).map(item => item.label);
  const tr = await translator(s.lang, [pkg.name, pkg.city, pkg.inclusions, ...highlights]);
  const langs = pkg.languagesOffered.map(code => GUIDE_LANG_NAMES[code] ?? code).join(", ");
  const bookings = PACKAGE_POPULARITY[pkg.cityId]?.bookings ?? 0;
  const caption = [
    `<b>${esc(tr(pkg.name))}</b>`,
    `📍 ${esc(tr(pkg.city))} · ${pkg.durationNights}N/${pkg.duration}D · ${copyKey(s.lang, `tier_${pkg.tier}`, pkg.tier)}${bookings ? ` · ⭐ ${say(s.lang, "bookings", { n: bookings })}` : ""}`,
    `💰 <b>${money(pkg.basePrice)}</b>`,
    `🗣 ${esc(langs)}`,
    highlights.length ? `\n<b>${say(s.lang, "highlights")}</b>\n${highlights.map(item => `• ${esc(tr(item))}`).join("\n")}` : "",
    `\n✅ ${esc(tr(pkg.inclusions))}`,
  ].filter(Boolean).join("\n");
  await sendPhoto(chatId, cityImage(pkg.city), caption.slice(0, 1024), [[{ text: say(s.lang, "planThis"), data: `B:${pkg.id}` }], [{ text: say(s.lang, "back"), data: "M:browse" }]]);
}

// --- Planning wizard: city → origin → date → days → travellers → budget → guide language → live estimate ---

async function askNext(chatId: string, s: Session) {
  const d = s.draft;
  if (!d.cityId) return showThemes(chatId, s);
  if (!d.origin) {
    s.step = "origin";
    const tr = await translator(s.lang, ORIGINS.map(origin => origin.city));
    const rows: Rows = [];
    for (let index = 0; index < ORIGINS.length; index += 3) rows.push(ORIGINS.slice(index, index + 3).map(origin => ({ text: tr(origin.city), data: `O:${origin.code}` })));
    return send(chatId, say(s.lang, "askOrigin"), rows);
  }
  s.step = undefined;
  if (!d.departDate) return send(chatId, say(s.lang, "askDate"), calendar(s.lang, todayIso().slice(0, 7)));
  if (!d.days) {
    const pkg = PACKAGES.find(item => item.cityId === d.cityId);
    const days = [2, 3, 4, 5, 6, 7, 8, 10];
    return send(chatId, say(s.lang, "askDays"), [days.slice(0, 4), days.slice(4)].map(row => row.map(n => ({ text: `${n === pkg?.duration ? "⭐ " : ""}${say(s.lang, "daysN", { n })}`, data: `N:${n}` }))));
  }
  if (!d.travelers) {
    // Only party sizes the package accepts (tour_packages.min_group_size … max_group_size).
    const pkg = PACKAGES.find(item => item.cityId === d.cityId);
    const sizes = Array.from({ length: Math.min(8, (pkg?.maxGroupSize ?? 6) - (pkg?.minGroupSize ?? 1) + 1) }, (_, index) => (pkg?.minGroupSize ?? 1) + index);
    return send(chatId, say(s.lang, "askTravellers"), [sizes.slice(0, 4), sizes.slice(4)].filter(row => row.length).map(row => row.map(n => ({ text: `${n > 1 ? "👥" : "👤"} ${n}`, data: `V:${n}` }))));
  }
  if (!d.budget) {
    s.step = "budget";
    return send(chatId, say(s.lang, "askBudget"), [
      [25000, 40000, 60000].map(value => ({ text: money(value), data: `G:${value}` })),
      [100000, 150000].map(value => ({ text: money(value), data: `G:${value}` })),
      [{ text: say(s.lang, "typeAmount"), data: "G:x" }],
    ]);
  }
  s.step = undefined;
  if (!d.language) {
    const pkg = PACKAGES.find(item => item.cityId === d.cityId);
    const codes = Array.from(new Set([s.lang, ...(pkg?.languagesOffered ?? []), "en-IN", "hi", "ta", "te"])).slice(0, 8);
    const rows: Rows = [];
    for (let index = 0; index < codes.length; index += 2) rows.push(codes.slice(index, index + 2).map(code => ({ text: GUIDE_LANG_NAMES[code] ?? code, data: `GL:${code}` })));
    return send(chatId, say(s.lang, "askGuideLang"), rows);
  }
  return runEstimate(chatId, s);
}

/** Month grid with ‹ › navigation; past days are inert. */
function calendar(lang: Lang, month: string): Rows {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const today = todayIso();
  const title = new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const shift = (delta: number) => { const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1)); return date.toISOString().slice(0, 7); };
  const weekday = new Intl.DateTimeFormat(locale(lang), { weekday: "narrow", timeZone: "UTC" });
  const rows: Rows = [
    [{ text: month > today.slice(0, 7) ? "‹" : " ", data: month > today.slice(0, 7) ? `C:${shift(-1)}` : "x" }, { text: title, data: "x" }, { text: "›", data: `C:${shift(1)}` }],
    Array.from({ length: 7 }, (_, index) => ({ text: weekday.format(new Date(Date.UTC(2024, 0, 1 + index))), data: "x" })),
  ];
  let week: Button[] = Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => ({ text: " ", data: "x" }));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    week.push(iso < today ? { text: "·", data: "x" } : { text: String(day), data: `D:${iso}` });
    if (week.length === 7) { rows.push(week); week = []; }
  }
  if (week.length) rows.push([...week, ...Array.from({ length: 7 - week.length }, () => ({ text: " ", data: "x" }))]);
  return rows;
}

async function runEstimate(chatId: string, s: Session) {
  const d = s.draft as Required<Draft>;
  await send(chatId, say(s.lang, "checking"));
  await typing(chatId);
  const e = await estimateTrip({ origin: d.origin, destination: d.cityId, departDate: d.departDate, returnDate: addDays(d.departDate, d.days), travelers: d.travelers, budget: d.budget, language: d.language, uiLanguage: s.lang });
  const flight = [...e.flights.options].sort((a, b) => a.price - b.price)[0];
  const guide = e.guides.find(item => item.available);
  const tr = await translator(s.lang, [e.destination, e.package.name, ...e.popularity.topPlaces.slice(0, 3).map(place => place.title)]);
  const ai = e.ai.text.replace(/\*\*/g, "").trim().slice(0, 700);
  const text = [
    `<b>${esc(tr(e.destination))} · ${esc(tr(e.package.name))}</b>`,
    `📊 ${say(s.lang, "estimateTitle")}`,
    `${say(s.lang, "low")} ${money(e.low)} · <b>${say(s.lang, "typical")} ${money(e.typical)}</b> · ${say(s.lang, "high")} ${money(e.high)}`,
    say(s.lang, `verdict_${e.verdict}` as BotKey),
    "",
    e.flights.source === "catalogue" ? say(s.lang, "catalogueFares") : "",
    flight ? `✈️ ${say(s.lang, "cheapestFlight")}: ${esc(flight.airline)} ${flight.depart}${flight.arrive ? `→${flight.arrive}` : ""} · ${money(flight.price)}` : `✈️ ${say(s.lang, "noFlights")}`,
    `🧳 ${say(s.lang, "packageDays", { days: e.days })}: ${money(e.package.forTrip)}`,
    `🧭 ${guide ? `${say(s.lang, "guideFrom")}: ${esc(guide.name)} ★${guide.rating} · ${money(guide.tripCost)}` : say(s.lang, "noGuide")}`,
    e.popularity.topPlaces.length ? `❤️ ${e.popularity.topPlaces.slice(0, 3).map(place => esc(tr(place.title))).join(" · ")}` : "",
    ai ? `\n🤖 ${esc(ai)}` : "",
  ].filter(line => line !== null).join("\n");
  await send(chatId, text.slice(0, 4000), [[{ text: say(s.lang, "buildTrip"), data: "E:go" }], [{ text: say(s.lang, "changeBudget"), data: "E:budget" }]]);
}

async function buildTrip(chatId: string, s: Session) {
  const d = s.draft as Required<Draft>;
  await typing(chatId);
  // The chat books as the dataset traveller for its language (users + user_preferences), over the mobile_app channel.
  const trip = await trips.createTrip({ origin: d.origin, destination: d.cityId, departDate: d.departDate, returnDate: addDays(d.departDate, d.days), travelers: d.travelers, budgetCap: d.budget, language: d.language, userId: travellerForLanguage(s.lang).userId, channel: "mobile_app" });
  s.tripId = trip.tripId;
  s.wizard = undefined;
  return showTrip(chatId, s, trip);
}

/** Route to the screen for the trip's current stage. */
async function showTrip(chatId: string, s: Session, trip?: TripView) {
  if (!trip) {
    if (!s.tripId) return showMenu(chatId, s, say(s.lang, "noTrip"));
    try { trip = trips.getTrip(s.tripId); } catch { s.tripId = undefined; return showMenu(chatId, s, say(s.lang, "noTrip")); }
  }
  if (trip.status === "select_flight") return showFlights(chatId, s, trip);
  if (trip.status === "negotiate") return showNegotiation(chatId, s, trip);
  if (trip.status === "select_package") return s.wizard ? showStep(chatId, s, trip) : showPackage(chatId, s, trip);
  if (trip.status === "review") return showReview(chatId, s, trip);
  if (trip.status === "awaiting_approval") return send(chatId, say(s.lang, "stillWaiting"), [[{ text: say(s.lang, "btnBrowse"), data: "M:browse" }, { text: say(s.lang, "btnAi"), data: "M:ai" }]]);
  return showConfirmed(chatId, s, trip);
}

async function showFlights(chatId: string, s: Session, trip: TripView) {
  if (!trip.flightOptions.length) return send(chatId, say(s.lang, "noFlights"), [[{ text: say(s.lang, "back"), data: "M:menu" }]]);
  const order = trip.flightOptions.map((flight, index) => ({ flight, index })).sort((a, b) => a.flight.price - b.flight.price).slice(0, 6);
  const stops = (n?: number) => (n ? say(s.lang, "stops", { n }) : say(s.lang, "nonstop"));
  await send(chatId, `${stepTitle(s.lang, 1, "stepFlight")}\n${say(s.lang, "pickFlight")}\n${esc(trip.origin)} → ${esc(trip.destination)} · ${shortDate(trip.departDate, s.lang)}${trip.flightSource === "catalogue" ? `\n${say(s.lang, "catalogueFares")}` : ""}`,
    order.map(({ flight, index }) => [{ text: `${flight.airline} ${flight.depart}${flight.arrive ? `→${flight.arrive}` : ""} · ${stops(flight.stops)} · ${money(flight.price * trip.travelers)}${trip.travelers > 1 ? ` (${trip.travelers}×${money(flight.price)})` : ""}`, data: `F:${index}` }]));
}

function packageSummary(s: Session, trip: TripView, tr: (text: string) => string) {
  const b = trip.priceBreakdown;
  const flight = trip.chosenFlight;
  const lines = [
    `🧳 <b>${esc(tr(trip.package?.name ?? ""))}</b>`,
    `📅 ${shortDate(trip.departDate, s.lang)} → ${shortDate(trip.returnDate, s.lang)} · ${say(s.lang, "daysN", { n: trip.durationDays })} · 👥 ${trip.travelers}`,
    flight ? `✈️ ${esc(flight.airline)} ${esc(flight.id)} ${flight.depart}${flight.arrive ? `→${flight.arrive}` : ""} · ${money(flight.price)}` : "",
    trip.chosenHotel ? `🏨 ${esc(trip.chosenHotel.name)} · ${esc(tr(cleanDetail(trip.chosenHotel.detail)))}` : "",
    ...[trip.chosenGuide, ...(trip.extraGuides ?? [])].filter(Boolean).map(guide => `🧭 ${esc(guide!.name)} (${specName(s.lang, guide!.specialisation)}) · ${guide!.wholeTrip === false ? `${guide!.bookedDates.map(date => shortDate(date, s.lang)).join(", ")} · ` : ""}${money(guide!.totalCost)}`),
    "",
    ...trip.itinerary.map(day => {
      const items = day.items.filter(item => item.kind !== "hotel" && item.kind !== "arrival" && item.kind !== "guide").map(item => tr(item.label));
      return items.length ? `<b>${say(s.lang, "day")} ${day.day}</b> · ${items.map(esc).join(", ")}` : "";
    }).filter(Boolean),
    trip.departureDay ? `<b>${say(s.lang, "day")} ${trip.departureDay.day}</b> · ${trip.departureDay.items.map(item => esc(tr(item.label.replace(/^Check out: .*/, "Check out")))).join(", ")}` : "",
    "",
    `💰 ${say(s.lang, "total")}: <b>${money(b.total)}</b>`,
    say(s.lang, "budgetLine", { budget: money(trip.budgetCap), left: money(Math.max(0, trip.budgetCap - b.total)) }),
  ];
  return lines.filter(line => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

async function tripTranslator(s: Session, trip: TripView) {
  return translator(s.lang, [trip.package?.name ?? "", cleanDetail(trip.chosenHotel?.detail ?? ""), ...trip.itinerary.flatMap(day => day.items.map(item => item.label)), "Check out", "Journey home"]);
}

async function showPackage(chatId: string, s: Session, trip: TripView, lead?: string) {
  const tr = await tripTranslator(s, trip);
  const hasAddOns = trip.packageComponents.some(item => item.optional);
  await send(chatId, `${lead ? `${lead}\n\n` : ""}${packageSummary(s, trip, tr)}`, [
    [{ text: say(s.lang, "btnHotel"), data: "H:list" }, ...(hasAddOns ? [{ text: say(s.lang, "btnAddons"), data: "A:list" }] : [])],
    [trip.chosenGuide ? { text: say(s.lang, "btnRemoveGuide"), data: "GX" } : { text: say(s.lang, "btnGuide"), data: "GD" }, { text: say(s.lang, "btnDays"), data: "ND:list" }],
    [{ text: say(s.lang, "btnReview"), data: "R" }],
  ]);
}

async function showHotels(chatId: string, s: Session, trip: TripView) {
  const current = trip.packageComponents.find(item => item.type === "hotel" && item.included);
  if (!current || !trip.package) return showPackage(chatId, s, trip);
  await send(chatId, say(s.lang, "pickHotel"), [...hotelRows(s, trip, current), [{ text: say(s.lang, "back"), data: "M:trip" }]]);
}

function hotelRows(s: Session, trip: TripView, current: TripView["packageComponents"][number]): Rows {
  const stars = (detail: string) => detail.match(/(\d)★/)?.[1];
  return [
    [{ text: `✓ ${current.label}${stars(current.detail) ? ` · ${stars(current.detail)}★` : ""} (${say(s.lang, "current")})`, data: "x" }],
    ...getAlternatives(trip.package!, current.id).map((item, index) => [{ text: `${item.label}${stars(item.detail) ? ` · ${stars(item.detail)}★` : ""} · ${signed((item.price - current.price) * trip.priceBreakdown.party.rooms * trip.priceBreakdown.nightsFactor)}`, data: `H:${index}` }]),
  ];
}

function addOnRows(s: Session, trip: TripView, tr: (text: string) => string, last: Button[] = [{ text: say(s.lang, "back"), data: "M:trip" }]): Rows {
  return [
    ...trip.packageComponents.map((item, index) => ({ item, index })).filter(({ item }) => item.optional)
      .map(({ item, index }) => [{ text: `${item.included ? "✅" : "➕"} ${tr(item.label)} · ${money(item.price * unitsFor(item.type, trip.priceBreakdown.party))}`, data: `A:${index}` }]),
    last,
  ];
}

function guideRows(s: Session, trip: TripView): Rows {
  return trips.listGuides(trip.tripId).slice(0, 8).map((guide, index) => [{
    text: `${guide.isAvailableForTrip ? "✅" : "⚠️"} ${guide.name} ★${guide.rating} · ${specName(s.lang, guide.specialisation)} · ${guide.isAvailableForTrip ? say(s.lang, "guideAvail") : say(s.lang, "guideBusy", { dates: guide.unavailableDates.slice(0, 2).map(date => shortDate(date, s.lang)).join(", ") })} · ${money(guide.tripCost)}`,
    data: `GS:${index}`,
  }]);
}

async function showGuides(chatId: string, s: Session, trip: TripView) {
  const rows = guideRows(s, trip);
  const langName = GUIDE_LANG_NAMES[trip.language] ?? trip.language;
  if (!rows.length) return send(chatId, say(s.lang, "noGuides", { lang: langName, city: trip.destination }), [[{ text: say(s.lang, "back"), data: "M:trip" }]]);
  await send(chatId, say(s.lang, "pickGuide", { lang: langName }), [...rows, [{ text: say(s.lang, "back"), data: "M:trip" }]]);
}

// ---------------------------------------------------------------------------
// The guided flow: 1 flight → 2 stay → 3 extras → 4 guide → 5 review (each step can still be changed later)
// ---------------------------------------------------------------------------

const stepTitle = (lang: Lang, n: number, name: BotKey) => say(lang, "step", { n, name: say(lang, name) });
const nextButton = (lang: Lang, step: WizardStep | "review"): Button => ({ text: say(lang, "btnNext", { name: say(lang, step === "stay" ? "stepStay" : step === "extras" ? "stepExtras" : step === "guide" ? "stepGuide" : "stepReview") }), data: `W:${step}` });

async function showStep(chatId: string, s: Session, trip: TripView, lead?: string): Promise<unknown> {
  const hasAddOns = trip.packageComponents.some(item => item.optional);
  const hotel = trip.packageComponents.find(item => item.type === "hotel" && item.included);
  // Skip a step the package has nothing for.
  if (s.wizard === "stay" && (!hotel || !trip.package || !getAlternatives(trip.package, hotel.id).length)) s.wizard = "extras";
  if (s.wizard === "extras" && !hasAddOns) s.wizard = "guide";
  const head = (n: number, name: BotKey) => `${lead ? `${lead}\n\n` : ""}${stepTitle(s.lang, n, name)}\n`;
  const total = money(trip.priceBreakdown.total);
  if (s.wizard === "stay") {
    return send(chatId, `${head(2, "stepStay")}${say(s.lang, "stayPrompt", { total })}`, [...hotelRows(s, trip, hotel!), [nextButton(s.lang, hasAddOns ? "extras" : "guide")]]);
  }
  if (s.wizard === "extras") {
    const tr = await translator(s.lang, trip.packageComponents.filter(item => item.optional).map(item => item.label));
    return send(chatId, `${head(3, "stepExtras")}${say(s.lang, "extrasPrompt", { total })}`, addOnRows(s, trip, tr, [nextButton(s.lang, "guide")]));
  }
  const langName = GUIDE_LANG_NAMES[trip.language] ?? trip.language;
  const chosen = [trip.chosenGuide, ...(trip.extraGuides ?? [])].filter(Boolean).map(guide => guide!.name);
  if (chosen.length) {
    return send(chatId, `${head(4, "stepGuide")}${say(s.lang, "guideChosen", { guide: esc(chosen.join(", ")) })}`, [[nextButton(s.lang, "review")], [{ text: say(s.lang, "btnRemoveGuide"), data: "GX" }]]);
  }
  const rows = guideRows(s, trip);
  const intro = rows.length ? say(s.lang, "guidePrompt", { lang: langName }) : say(s.lang, "noGuides", { lang: langName, city: trip.destination });
  return send(chatId, `${head(4, "stepGuide")}${intro}`, [...rows, [{ text: say(s.lang, "btnNoGuide"), data: "W:review" }]]);
}

/** The mandatory guide rule: refuse, name the clashing date, offer same-language same-specialisation substitutes, reprice. */
async function showGuideRefusal(chatId: string, s: Session, trip: TripView) {
  const issue = trip.guideAvailabilityIssue!;
  const options = issue.replacementOptions.slice(0, 2);
  const refusedCost = (option: (typeof options)[number]) => option.totalCost - (option.priceDelta ?? 0);
  // Date strip per guide (✓ free, ✕ busy) so the clash is visible at a glance.
  const strip = (availability: Record<string, boolean>) => issue.requestedDates.map(date => `${new Date(`${date}T00:00:00Z`).getUTCDate()} ${availability[date] === true ? "✅" : "❌"}`).join(" · ");
  const lines = [
    say(s.lang, "refused", { guide: esc(issue.guide.name), dates: issue.conflictingDates.map(date => shortDate(date, s.lang)).join(", ") }),
    [issue.guide, ...options.map(option => option.guide)].map(guide => `<code>${esc(guide.name.padEnd(13))}</code> ${strip(guide.availability)}`).join("\n"),
    ...options.map(option => say(s.lang, "substitute", {
      guide: esc(option.guide.name), spec: specName(s.lang, option.guide.specialisation), where: option.distanceKm < 1 ? say(s.lang, "sameCity") : say(s.lang, "kmAway", { km: Math.round(option.distanceKm) }),
      cost: money(option.totalCost), delta: signed(option.priceDelta), old: money(refusedCost(option)),
    })),
    options.length ? say(s.lang, "newTotal", { old: money(issue.currentTotal), new: money(options[0].newTotal) }) : say(s.lang, "noSubstitute"),
  ];
  const freeDays = issue.requestedDates.filter(date => issue.guide.availability[date] === true);
  await send(chatId, lines.join("\n\n"), [
    ...options.map((option, index) => [{ text: `✅ ${say(s.lang, "takeSub", { guide: option.guide.name })} · ${money(option.newTotal)}`, data: `GR:${index}` }]),
    ...(freeDays.length && freeDays.length < issue.requestedDates.length ? [[{ text: say(s.lang, "bookFreeOnly", { guide: issue.guide.name, dates: freeDays.map(date => shortDate(date, s.lang)).join(", ") }), data: "GF" }]] : []),
    [{ text: say(s.lang, "skipGuide"), data: "M:trip" }],
  ]);
}

async function showNegotiation(chatId: string, s: Session, trip: TripView) {
  const overage = trip.pending?.overage ?? trip.negotiationOptions.find(option => option.choice === "approve_overage")?.amount ?? 0;
  const label: Record<string, BotKey> = { approve_overage: "ngApprove", swap_cheaper: "ngSwap", remove_item: "ngRemove", raise_cap: "ngRaise" };
  // Budget fixes first (priced on the whole plan), then approve / keep as it was / raise the budget.
  const fixes = (trip.pending?.fixes ?? []).slice(0, 4).map((fix, index) => [{ text: `${say(s.lang, `fx_${fix.kind}` as BotKey)} · −${money(fix.saving)}${fix.fits ? ` ✓ ${say(s.lang, "fxFits")}` : ""}`, data: `NF:${index}` }]);
  await send(chatId, `${say(s.lang, "overBudget", { amount: money(overage) })}${fixes.length ? `\n\n${say(s.lang, "fxIntro")}` : ""}`, [...fixes, ...trip.negotiationOptions.map(option => [{ text: say(s.lang, label[option.choice] ?? "ngSwap"), data: `NG:${option.choice}` }])]);
}

async function showReview(chatId: string, s: Session, trip: TripView) {
  const tr = await tripTranslator(s, trip);
  const b = trip.priceBreakdown;
  const breakdown = [
    `${say(s.lang, "flight")}: ${money(b.transport)}`,
    `${say(s.lang, "packageBase")}: ${money(b.packageBase)}`,
    b.adjustment ? `${say(s.lang, b.adjustment < 0 ? "chDiscount" : "chSurcharge")}: ${signed(b.adjustment)}` : "",
    b.components ? `${say(s.lang, "componentsLine")}: ${money(b.components)}` : "",
    b.addOns ? `${say(s.lang, "addOns")}: ${money(b.addOns)}` : "",
    b.guide ? `${say(s.lang, "guide")}: ${money(b.guide)}` : "",
  ].filter(Boolean).join("\n");
  const quote = publicPdfLink(trip.tripId, "quote", s.lang);
  await send(chatId, `${stepTitle(s.lang, 5, "stepReview")}\n<b>${say(s.lang, "review")}</b>\n\n${packageSummary(s, trip, tr)}\n\n${breakdown}`, [
    // With a travel agent's chat the traveller asks for the booking; without one it is booked straight away.
    [approvalRequired() ? { text: say(s.lang, "requestBooking"), data: "Q" } : { text: say(s.lang, "confirm"), data: "K" }],
    ...(quote ? [[{ text: say(s.lang, "pdfLink"), url: quote }]] : []),
    [{ text: say(s.lang, "edit"), data: "BK" }],
  ]);
  await sendTripPdf(chatId, trip, "quote", s.lang, say(s.lang, "quoteCaption"));
}

const tripLine = (trip: TripView, lang: Lang) => `${esc(trip.origin)} → ${esc(trip.destination)} · ${shortDate(trip.departDate, lang)} → ${shortDate(trip.returnDate, lang)}`;

function doneRows(trip: TripView, lang: Lang): Rows {
  const bill = publicPdfLink(trip.tripId, "bill", lang);
  const web = webLink(trip.tripId);
  return [...(bill ? [[{ text: say(lang, "pdfLink"), url: bill }]] : []), ...(web ? [[{ text: say(lang, "openWeb"), url: web }]] : []), [{ text: say(lang, "btnBrowse"), data: "M:browse" }, { text: say(lang, "btnAi"), data: "M:ai" }]];
}

async function showConfirmed(chatId: string, s: Session, trip: TripView) {
  await send(chatId, `${say(s.lang, "confirmed", { pnr: trip.booking?.reference ?? "—" })}\n${tripLine(trip, s.lang)}\n💰 ${say(s.lang, "total")}: <b>${money(trip.runningTotal)}</b>`, doneRows(trip, s.lang));
}

// ---------------------------------------------------------------------------
// Travel agent approval (AGENT_TELEGRAM_CHAT_ID): request → agent taps Approve / Reject → traveller gets the bill or the reason
// ---------------------------------------------------------------------------

async function notifyAgent(trip: TripView, travellerLang: Lang) {
  const agent = agentChat();
  if (!agent || !trip.booking) return;
  const guides = [trip.chosenGuide, ...(trip.extraGuides ?? [])].filter(Boolean).map(guide => `🧭 ${esc(guide!.name)} · ${guide!.bookedDates.map(date => shortDate(date, "en-IN")).join(", ")} · ${money(guide!.totalCost)}`);
  const text = [
    `🛎 <b>New booking request ${esc(trip.booking.reference)}</b>${(trip.approval?.attempt ?? 1) > 1 ? ` (request #${trip.approval!.attempt})` : ""}`,
    `${tripLine(trip, "en-IN")} · 👥 ${trip.travelers}`,
    `🧳 ${esc(trip.package?.name ?? trip.destination)}`,
    trip.chosenFlight ? `✈️ ${esc(trip.chosenFlight.airline)} ${esc(trip.chosenFlight.id)} ${trip.chosenFlight.depart} · ${money(trip.chosenFlight.price)} × ${trip.travelers}` : "",
    trip.chosenHotel ? `🏨 ${esc(trip.chosenHotel.name)}` : "",
    ...guides,
    `💰 Total <b>${money(trip.runningTotal)}</b> (budget ${money(trip.budgetCap)})`,
    `${trip.channel === "web" ? "🌐 Booked on the website" : `🗣 Traveller writes in ${LANGS.find(lang => lang.value === travellerLang)?.native ?? travellerLang}`} · guide dates are held until you decide`,
  ].filter(Boolean).join("\n");
  const quote = publicPdfLink(trip.tripId, "quote", "en-IN");
  const desk = publicBase() && dashboardKey() ? `${publicBase()}/agent?trip=${trip.tripId}` : null;
  await send(agent, text, [
    [{ text: "✅ Approve", data: `AP:${trip.tripId}` }, { text: "❌ Reject", data: `AR:${trip.tripId}` }],
    ...(desk ? [[{ text: "🤝 Counter-offer on the travel desk", url: desk }]] : []),
    ...(quote ? [[{ text: "📄 Quotation PDF", url: quote }]] : []),
  ]);
  await sendTripPdf(agent, trip, "quote", "en-IN", `📄 ${esc(trip.booking.reference)} · quotation`);
}

/** Only the agent chat may approve or reject; a second tap (or a tap after a decision) just reports the outcome. */
async function onAgentDecision(chatId: string, kind: string, value: string, messageId: number | undefined, from?: From) {
  if (!agentChat() || chatId !== agentChat()) return;
  const [tripId, reasonIndex] = value.split(":");
  let trip: TripView;
  try { trip = trips.getTrip(tripId); } catch { return send(chatId, "Trip not found."); }
  const setButtons = (rows: Rows) => messageId ? tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup(rows) }).catch(() => undefined) : undefined;
  if (trip.status !== "awaiting_approval") {
    const outcome = trip.approval?.decision ? `${trip.approval.decision}${trip.approval.decidedBy ? ` by ${trip.approval.decidedBy}` : ""}` : trip.status;
    return send(chatId, `ℹ️ ${esc(tripId)} — already ${esc(outcome)}.`);
  }
  if (kind === "AR") return setButtons([...REJECT_REASONS.map((reason, index) => [{ text: `❌ ${reason}`, data: `RJ:${tripId}:${index}` }]), [{ text: "↩️ Back", data: `AB:${tripId}` }]]);
  if (kind === "AB") return setButtons([[{ text: "✅ Approve", data: `AP:${tripId}` }, { text: "❌ Reject", data: `AR:${tripId}` }]]);
  const who = from?.first_name ? `${from.first_name} (travel agent)` : "travel agent";
  if (kind === "AP") {
    trips.approveBooking(tripId, who);
    await setButtons([[{ text: `✅ Approved by ${who}`, data: "x" }]]);
    return tellTraveller(tripId);
  }
  const reason = REJECT_REASONS[Number(reasonIndex)] ?? REJECT_REASONS[0];
  trips.rejectBooking(tripId, reason, who);
  await setButtons([[{ text: `❌ ${reason}`, data: "x" }]]);
  return tellTraveller(tripId);
}

/** Tell a Telegram traveller where their request stands: approved (bill PDF), rejected (reason), or a counter-offer to answer. */
async function tellTraveller(tripId: string) {
  const trip = trips.getTrip(tripId);
  const chat = trip.approval?.chatId;
  // Booked on the website: an SMS / email with a link back to the trip instead.
  if (!chat) { await notifyWebTraveller(tripId); return; }
  const lang = loadBotSession<Session>(chat)?.lang ?? "en-IN";
  if (trip.status === "confirmed" && trip.approval?.decision === "approved") {
    await send(chat, `${say(lang, "approvedMsg", { pnr: trip.booking?.reference ?? "—", total: money(trip.runningTotal) })}\n${tripLine(trip, lang)}`, doneRows(trip, lang));
    await sendTripPdf(chat, trip, "bill", lang, say(lang, "billCaption"));
    return;
  }
  if (trip.status === "review" && trip.approval?.decision === "rejected") {
    const reason = trip.approval.reason ?? "";
    const tr = await translator(lang, [reason]);
    await send(chat, say(lang, "rejectedMsg", { reason: esc(tr(reason)) }), [[{ text: say(lang, "btnRequestAgain"), data: `Q:${tripId}` }], [{ text: say(lang, "edit"), data: `BK:${tripId}` }]]);
    return;
  }
  const counter = trip.approval?.counter;
  if (trip.status === "awaiting_approval" && counter?.status === "open") {
    const tr = await translator(lang, counter.changes.flatMap(change => [change.from ?? "", change.to ?? ""]).filter(Boolean));
    const lines = counter.changes.map(change => {
      const what = change.kind === "swap" ? say(lang, "chSwap", { from: esc(tr(change.from ?? "")), to: esc(tr(change.to ?? "")) })
        : change.kind === "addon_on" ? say(lang, "chAddOn", { item: esc(tr(change.to ?? "")) })
          : change.kind === "addon_off" ? say(lang, "chRemove", { item: esc(tr(change.to ?? "")) })
            : say(lang, change.delta < 0 ? "chDiscount" : "chSurcharge");
      return `• ${what} · ${signed(change.delta)}`;
    });
    await send(chat, [say(lang, "counterMsg", { total: money(counter.newTotal), old: money(counter.oldTotal) }), ...lines, counter.note ? say(lang, "counterNote", { note: esc(counter.note) }) : ""].filter(Boolean).join("\n"),
      [[{ text: say(lang, "btnAcceptCounter"), data: `CA:${tripId}` }], [{ text: say(lang, "btnDeclineCounter"), data: `CD:${tripId}` }]]);
  }
}

/** The traveller answered a counter-offer: tell the agent's chat. */
async function tellAgentAnswer(tripId: string, answer: "accepted" | "declined") {
  const agent = agentChat();
  if (!agent) return;
  const trip = trips.getTrip(tripId);
  const ref = esc(trip.booking?.reference ?? trip.tripId);
  await send(agent, answer === "accepted"
    ? (trip.status === "confirmed" ? `🤝 ${ref}: the traveller accepted your counter-offer — booked at <b>${money(trip.runningTotal)}</b>.` : `⚠️ ${esc(trip.tripId)}: the traveller accepted, but a guide's dates were taken meanwhile — they're choosing a substitute.`)
    : `↩️ ${ref}: the traveller kept the original request (${money(trip.runningTotal)}) — it's waiting for your Approve / Reject.`);
}

// For the web travel desk and the web app: the same messages, sent outside a chat's queue. No bot token → nothing to send.
const quietly = (job: () => Promise<unknown>) => (token() ? job().catch(error => console.warn("[telegram] notify:", (error as Error).message)) : Promise.resolve());
export const notifyAgentOfRequest = (tripId: string) => quietly(async () => {
  const trip = trips.getTrip(tripId);
  const chat = trip.approval?.chatId;
  await notifyAgent(trip, (chat && loadBotSession<Session>(chat)?.lang) || "en-IN");
});
/** The agent decided (or sent a counter-offer): tell the traveller in Telegram, or by SMS / email for website bookings. */
export const notifyTravellerOfDecision = (tripId: string) => trips.getTrip(tripId).approval?.chatId
  ? quietly(() => tellTraveller(tripId))
  : notifyWebTraveller(tripId).catch(error => console.warn("[notify]", (error as Error).message));
export const notifyAgentOfTravellerAnswer = (tripId: string, answer: "accepted" | "declined") => quietly(() => tellAgentAnswer(tripId, answer));

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function startPlanning(s: Session, cityId: string) {
  const destination = DESTINATIONS.find(item => item.code === cityId);
  s.draft = { ...s.draft, cityId, city: destination?.city, departDate: undefined, days: undefined };
  s.tripId = undefined;
  s.wizard = undefined;
}

async function onCallback(chatId: string, s: Session, data: string, messageId?: number, from?: From): Promise<unknown> {
  const separator = data.indexOf(":");
  const kind = separator < 0 ? data : data.slice(0, separator);
  const value = separator < 0 ? "" : data.slice(separator + 1);
  const trip = () => trips.getTrip(s.tripId!);
  if (["AP", "AR", "AB", "RJ"].includes(kind)) return onAgentDecision(chatId, kind, value, messageId, from);
  if (kind === "CA" || kind === "CD") return onCounterAnswer(chatId, s, kind, value, messageId);
  // "Request again" / "Change the trip" after a rejection name their trip (the traveller may have started another since).
  if ((kind === "Q" || kind === "BK") && value) {
    try { if (trips.getTrip(value).approval?.chatId === chatId) { s.tripId = value; s.wizard = undefined; } } catch { /* stale button */ }
  }
  // Buttons from an old message can arrive after the trip is gone (or before one exists): send them to the menu.
  if (["F", "H", "A", "GD", "GS", "GR", "GX", "GF", "GU", "ND", "NG", "NF", "R", "BK", "K", "Q", "W"].includes(kind) && !s.tripId) return showMenu(chatId, s, say(s.lang, "noTrip"));
  switch (kind) {
    case "x": return;
    case "L": s.lang = (LANGS.find(lang => lang.value === value)?.value ?? "en-IN"); return showMenu(chatId, s, say(s.lang, "langSet"));
    case "M":
      if (value === "browse") return showThemes(chatId, s);
      if (value === "ai") return send(chatId, say(s.lang, "aiPrompt"));
      if (value === "trip") return showTrip(chatId, s);
      if (value === "lang") return showWelcome(chatId);
      if (value === "demo") return startDemo(chatId, s);
      return showMenu(chatId, s);
    case "T": return showPackageList(chatId, s, value);
    case "P": return showPackageCard(chatId, s, value);
    case "B": case "S": {
      const pkg = PACKAGES.find(item => item.id === value);
      if (!pkg) return showThemes(chatId, s);
      startPlanning(s, pkg.cityId);
      return askNext(chatId, s);
    }
    case "O": s.draft.origin = value; s.step = undefined; return askNext(chatId, s);
    case "C": return messageId ? tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup(calendar(s.lang, value)) }).catch(() => undefined) : undefined;
    case "D":
      if (value < todayIso()) return send(chatId, say(s.lang, "pastDate"));
      s.draft.departDate = value;
      if (messageId) await edit(chatId, messageId, `📅 ${shortDate(value, s.lang)}`);
      return askNext(chatId, s);
    case "N": s.draft.days = Number(value); return askNext(chatId, s);
    case "V": s.draft.travelers = Number(value); return askNext(chatId, s);
    case "G":
      if (value === "x") { s.step = "budget"; return send(chatId, say(s.lang, "askBudgetType")); }
      s.draft.budget = Number(value); s.step = undefined; return askNext(chatId, s);
    case "GL": s.draft.language = value; return askNext(chatId, s);
    case "E":
      if (value === "budget") { s.draft.budget = undefined; return askNext(chatId, s); }
      return buildTrip(chatId, s);
    case "F": {
      const flight = trip().flightOptions[Number(value)];
      if (!flight) return showTrip(chatId, s);
      await typing(chatId);
      s.wizard = "stay";
      return showTrip(chatId, s, await trips.selectFlight(s.tripId!, flight.id));
    }
    case "H": {
      const current = trip();
      if (value === "list") return showHotels(chatId, s, current);
      const from = current.packageComponents.find(item => item.type === "hotel" && item.included);
      const target = from && current.package ? getAlternatives(current.package, from.id)[Number(value)] : undefined;
      if (!from || !target) return showHotels(chatId, s, current);
      const next = trips.swapComponent(s.tripId!, from.id, target.id);
      if (next.status === "negotiate") return showNegotiation(chatId, s, next);
      const lead = say(s.lang, "updated", { total: money(next.priceBreakdown.total), delta: signed(next.priceBreakdown.total - current.priceBreakdown.total) });
      return s.wizard ? showStep(chatId, s, next, lead) : showPackage(chatId, s, next, lead);
    }
    case "A": {
      const current = trip();
      const tr = await translator(s.lang, current.packageComponents.filter(item => item.optional).map(item => item.label));
      if (value === "list") return send(chatId, say(s.lang, "pickAddon"), addOnRows(s, current, tr));
      const component = current.packageComponents[Number(value)];
      if (!component?.optional) return;
      const next = trips.toggleAddOn(s.tripId!, component.id, !component.included);
      if (next.status === "negotiate") return showNegotiation(chatId, s, next);
      const updated = say(s.lang, "updated", { total: money(next.priceBreakdown.total), delta: signed(next.priceBreakdown.total - current.priceBreakdown.total) });
      const text = s.wizard === "extras" ? `${stepTitle(s.lang, 3, "stepExtras")}\n${updated}` : `${say(s.lang, "pickAddon")}\n${updated}`;
      const rows = addOnRows(s, next, tr, s.wizard === "extras" ? [nextButton(s.lang, "guide")] : undefined);
      return messageId ? edit(chatId, messageId, text, rows) : send(chatId, text, rows);
    }
    case "GD": return showGuides(chatId, s, trip());
    case "GS": case "GR": {
      const current = trip();
      const guide = kind === "GS" ? trips.listGuides(s.tripId!)[Number(value)] : current.guideAvailabilityIssue?.replacementOptions[Number(value)]?.guide;
      if (!guide) return showGuides(chatId, s, current);
      await typing(chatId);
      const next = trips.selectGuide(s.tripId!, guide.id, current.durationDays);
      if (next.status === "negotiate") return showNegotiation(chatId, s, next);
      if (next.chosenGuide?.id !== guide.id && next.guideAvailabilityIssue?.guide.id === guide.id) return showGuideRefusal(chatId, s, next);
      const lead = say(s.lang, "guideBooked", { guide: esc(guide.name), days: next.chosenGuide?.daysBooked ?? current.durationDays, cost: money(next.chosenGuide?.totalCost ?? 0) });
      if (s.wizard) { s.wizard = "guide"; return showStep(chatId, s, next, lead); }
      return showPackage(chatId, s, next, lead);
    }
    case "GX": {
      const next = trips.removeGuide(s.tripId!);
      return s.wizard ? showStep(chatId, s, next) : showPackage(chatId, s, next);
    }
    case "GF": case "GU": {
      const current = trip();
      const uncovered = current.guidePlan.filter(day => !day.guideId).map(day => day.date);
      const target = kind === "GF"
        ? current.guideAvailabilityIssue && { id: current.guideAvailabilityIssue.guide.id, name: current.guideAvailabilityIssue.guide.name, dates: current.guideAvailabilityIssue.requestedDates.filter(date => current.guideAvailabilityIssue!.guide.availability[date] === true) }
        : (() => { const guide = trips.listGuides(s.tripId!).filter(item => uncovered.every(date => item.availability[date] === true))[Number(value)]; return guide && { id: guide.id, name: guide.name, dates: uncovered }; })();
      if (!target?.dates.length) return showGuides(chatId, s, current);
      const next = trips.bookGuideDays(s.tripId!, target.id, target.dates);
      if (next.status === "negotiate") return showNegotiation(chatId, s, next);
      if (next.guideAvailabilityIssue) return showGuideRefusal(chatId, s, next);
      const booked = [next.chosenGuide, ...(next.extraGuides ?? [])].find(guide => guide?.id === target.id);
      await showPackage(chatId, s, next, say(s.lang, "guideBookedDays", { guide: esc(target.name), dates: target.dates.map(date => shortDate(date, s.lang)).join(", "), cost: money(booked?.totalCost ?? 0) }));
      // Offer guides who are free on every day still without a guide.
      const stillOpen = next.guidePlan.filter(day => !day.guideId).map(day => day.date);
      const helpers = stillOpen.length ? trips.listGuides(s.tripId!).filter(item => stillOpen.every(date => item.availability[date] === true)).slice(0, 4) : [];
      if (helpers.length) await send(chatId, say(s.lang, "coverRest", { dates: stillOpen.map(date => shortDate(date, s.lang)).join(", ") }), helpers.map((guide, index) => [{ text: `🧭 ${guide.name} · ${stillOpen.map(date => shortDate(date, s.lang)).join(", ")} · ${money(stillOpen.reduce((sum, date) => sum + (guide.dayCosts[date] ?? 0), 0))}`, data: `GU:${index}` }]));
      return;
    }
    case "ND":
      if (value === "list") return send(chatId, say(s.lang, "askDays"), [[2, 3, 4, 5], [6, 7, 8, 10]].map(row => row.map(n => ({ text: say(s.lang, "daysN", { n }), data: `ND:${n}` }))));
      {
        const next = trips.setDuration(s.tripId!, Number(value));
        if (next.status === "negotiate") return showNegotiation(chatId, s, next);
        if (next.guideAvailabilityIssue && !next.chosenGuide) { await showPackage(chatId, s, next); return showGuideRefusal(chatId, s, next); }
        return showPackage(chatId, s, next);
      }
    case "NF": {
      const fix = trips.getTrip(s.tripId!).pending?.fixes?.[Number(value)];
      if (!fix) return showTrip(chatId, s);
      return showTrip(chatId, s, await trips.negotiate(s.tripId!, "apply_fix", undefined, fix.id));
    }
    case "NG":
      if (value === "raise_cap") { s.step = "raiseCap"; return send(chatId, say(s.lang, "askNewCap")); }
      return showTrip(chatId, s, await trips.negotiate(s.tripId!, value));
    case "W": {
      if (value === "review") { s.wizard = undefined; return showTrip(chatId, s, trips.continueFromPackage(s.tripId!)); }
      s.wizard = value === "extras" || value === "guide" ? value : "stay";
      return showTrip(chatId, s);
    }
    case "R": s.wizard = undefined; return showTrip(chatId, s, trips.continueFromPackage(s.tripId!));
    case "BK": s.wizard = undefined; return showTrip(chatId, s, trips.goBack(s.tripId!));
    case "K": {
      await typing(chatId);
      const next = await trips.confirmTrip(s.tripId!);
      // Another traveller took the guide's last slot first: show the refusal and substitutes instead of a booking.
      if (next.status !== "confirmed" && next.guideAvailabilityIssue) return showGuideRefusal(chatId, s, next);
      await showTrip(chatId, s, next);
      if (next.status === "confirmed") await sendTripPdf(chatId, next, "bill", s.lang, say(s.lang, "billCaption"));
      return;
    }
    case "Q": {
      if (!approvalRequired()) return onCallback(chatId, s, "K", messageId);
      const current = trip();
      if (current.status === "awaiting_approval" || current.status === "confirmed") return showTrip(chatId, s, current);
      await typing(chatId);
      const next = await trips.requestBooking(s.tripId!, { chatId });
      if (next.status !== "awaiting_approval") return next.guideAvailabilityIssue ? showGuideRefusal(chatId, s, next) : showTrip(chatId, s, next);
      await send(chatId, `${say(s.lang, "awaitingApproval")}\n${tripLine(next, s.lang)} · <b>${money(next.runningTotal)}</b>`);
      return notifyAgent(next, s.lang);
    }
    default: return showMenu(chatId, s);
  }
}

/** The traveller answers a counter-offer from the travel agent (only from the chat that made the request). */
async function onCounterAnswer(chatId: string, s: Session, kind: "CA" | "CD", tripId: string, messageId?: number) {
  let trip: TripView;
  try { trip = trips.getTrip(tripId); } catch { return showMenu(chatId, s, say(s.lang, "noTrip")); }
  if (trip.approval?.chatId !== chatId) return;
  if (messageId) await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  if (trip.approval.counter?.status !== "open") return showTrip(chatId, s, trip);
  s.tripId = tripId;
  s.wizard = undefined;
  await typing(chatId);
  if (kind === "CD") {
    trips.declineCounter(tripId);
    await send(chatId, say(s.lang, "counterDeclinedMsg"));
  } else {
    const next = await trips.acceptCounter(tripId);
    if (next.status === "confirmed") await tellTraveller(tripId);
    else if (next.guideAvailabilityIssue) await showGuideRefusal(chatId, s, next);
    else await showTrip(chatId, s, next);
  }
  await tellAgentAnswer(tripId, kind === "CA" ? "accepted" : "declined");
}

async function onText(chatId: string, s: Session, text: string) {
  const command = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();
  if (command) {
    if (command === "start") { s.draft = {}; s.step = undefined; s.history = []; return showWelcome(chatId); }
    if (command === "language") return showWelcome(chatId);
    if (command === "packages") return showThemes(chatId, s);
    if (command === "demo") return startDemo(chatId, s);
    if (command === "plan") return send(chatId, say(s.lang, "aiPrompt"));
    if (command === "trip") return showTrip(chatId, s);
    if (command === "reset") { s.draft = {}; s.step = undefined; s.tripId = undefined; s.history = []; return showMenu(chatId, s); }
    if (command === "help") return send(chatId, say(s.lang, "help"));
    // For setting AGENT_TELEGRAM_CHAT_ID: the travel agent sends /chatid to the bot once.
    if (command === "chatid") return send(chatId, `Chat id: <code>${esc(chatId)}</code>`);
    return showMenu(chatId, s);
  }

  if (s.step === "origin") {
    const needle = text.trim().toLowerCase();
    const origin = ORIGINS.find(item => item.code.toLowerCase() === needle || item.city.toLowerCase() === needle || item.city.toLowerCase().startsWith(needle));
    if (origin) { s.draft.origin = origin.code; s.step = undefined; return askNext(chatId, s); }
  }
  if (s.step === "budget" || s.step === "raiseCap") {
    const amount = parseBudget(text) ?? (Number(text.replace(/[^\d]/g, "")) || undefined);
    if (!amount || amount < 1000) return send(chatId, say(s.lang, "budgetInvalid"));
    const step = s.step;
    s.step = undefined;
    if (step === "raiseCap") return showTrip(chatId, s, await trips.negotiate(s.tripId!, "raise_cap", amount));
    s.draft.budget = amount;
    return askNext(chatId, s);
  }
  return onFreeText(chatId, s, text);
}

/** Free text → the same agent as the web chat: trip requests, interest-based package picks, trip edits, or grounded answers. */
async function onFreeText(chatId: string, s: Session, text: string) {
  if (takeToken("ai", `tg:${chatId}`)) return send(chatId, say(s.lang, "slowDown"));
  await typing(chatId);
  let current: TripView | undefined;
  try { current = s.tripId ? trips.getTrip(s.tripId) : undefined; } catch { current = undefined; }
  const context = {
    language: s.lang,
    availableOrigins: ORIGINS,
    availableDestinations: DESTINATIONS,
    planner: { budgetCap: s.draft.budget ?? current?.budgetCap, destinationCity: s.draft.city ?? current?.destination, language: s.draft.language ?? current?.language },
    destination: current?.destination,
    currentItinerary: current,
    guideAvailabilityIssue: current?.guideAvailabilityIssue,
  };
  const result = await explainWithFreeOpenRouter([...s.history, { role: "user", content: text }], context) as Awaited<ReturnType<typeof explainWithFreeOpenRouter>> & {
    tripRequest?: { origin?: { code: string }; destination?: { code: string; city: string }; durationDays?: number; departDate?: string; returnDate?: string };
    suggestions?: { packageId: string; name: string; basePrice: number }[];
    command?: { type: "swap_hotel" | "remove_guide"; target?: string };
  };
  s.history = [...s.history, { role: "user" as const, content: text }, { role: "assistant" as const, content: result.text }].slice(-8);

  if (result.command && current && ["select_package", "review"].includes(current.status)) {
    const next = result.command.type === "remove_guide" ? trips.removeGuide(current.tripId) : trips.swapHotel(current.tripId, result.command.target ?? "");
    if (next.status === "negotiate") return showNegotiation(chatId, s, next);
    return showPackage(chatId, s, next, `${richText(result.text)}\n${say(s.lang, "updated", { total: money(next.priceBreakdown.total), delta: signed(next.priceBreakdown.total - current.priceBreakdown.total) })}`);
  }
  if (result.tripRequest?.destination) {
    const request = result.tripRequest;
    startPlanning(s, request.destination!.code);
    if (request.origin?.code) s.draft.origin = ORIGINS.find(item => item.code === request.origin!.code)?.code ?? s.draft.origin;
    if (request.departDate && request.departDate >= todayIso()) s.draft.departDate = request.departDate;
    const days = request.durationDays ?? (request.departDate && request.returnDate ? Math.round((Date.parse(request.returnDate) - Date.parse(request.departDate)) / 86400000) : undefined);
    if (days && days > 0) s.draft.days = days;
    const budget = parseBudget(text);
    if (budget) s.draft.budget = budget;
    const originCity = ORIGINS.find(item => item.code === s.draft.origin)?.city;
    const tr = await translator(s.lang, [s.draft.city ?? "", originCity ?? ""]);
    const summary = [originCity ? `${tr(originCity)} → ${tr(s.draft.city ?? "")}` : tr(s.draft.city ?? ""), s.draft.days ? say(s.lang, "daysN", { n: s.draft.days }) : "", s.draft.departDate ? shortDate(s.draft.departDate, s.lang) : "", s.draft.budget ? money(s.draft.budget) : ""].filter(Boolean).join(" · ");
    await send(chatId, `${say(s.lang, "gotIt")} <b>${esc(summary)}</b>`);
    return askNext(chatId, s);
  }
  if (result.suggestions?.length) {
    const tr = await translator(s.lang, result.suggestions.map(item => item.name));
    return send(chatId, richText(result.text), result.suggestions.map(item => [{ text: `${say(s.lang, "buildSuggestion", { name: tr(item.name) })} · ${money(item.basePrice)}`, data: `S:${item.packageId}` }]));
  }
  return send(chatId, richText(result.text).slice(0, 4000), current ? [[{ text: say(s.lang, "btnTrip"), data: "M:trip" }]] : [[{ text: say(s.lang, "btnBrowse"), data: "M:browse" }]]);
}

/**
 * A voice note in any of the four languages: Sarvam hears it (the words as spoken + their English meaning + the language),
 * the bot switches to that language, shows what it heard, answers exactly as if the English meaning had been typed, and
 * reads the first reply back as a voice note. Without the speech service it asks the traveller to type.
 */
async function onVoice(chatId: string, s: Session, note: VoiceNote) {
  if (!voiceEnabled()) return send(chatId, say(s.lang, "voiceOff"));
  if (note.duration > MAX_VOICE_SECONDS) return send(chatId, say(s.lang, "voiceTooLong"));
  if (takeToken("voiceHear", `tg:${chatId}`)) return send(chatId, say(s.lang, "slowDown"));
  await tg("sendChatAction", { chat_id: chatId, action: "record_voice" }).catch(() => undefined);
  const file = await tg<{ file_path?: string }>("getFile", { file_id: note.file_id });
  if (!file.file_path) return send(chatId, say(s.lang, "voiceNotHeard"));
  const download = await fetch(`https://api.telegram.org/file/bot${token()}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
  const heard = await hear(new Uint8Array(await download.arrayBuffer()), note.mime_type ?? "audio/ogg");
  if (!heard?.english) return send(chatId, say(s.lang, "voiceNotHeard"));
  // Reply in the language the traveller spoke (the app's four languages; others keep the current one).
  if (LANGS.some(lang => lang.value === heard.language)) s.lang = heard.language as Lang;
  await send(chatId, `${say(s.lang, "voiceHeard")} <i>${esc(heard.native)}</i>${heard.native !== heard.english ? `\n<i>(${esc(heard.english)})</i>` : ""}`);
  spokenReplies.set(chatId, { lang: s.lang });
  try {
    await onText(chatId, s, heard.english);
  } finally {
    const audio = await spokenReplies.get(chatId)?.audio;
    spokenReplies.delete(chatId);
    if (audio) {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("voice", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "reply.mp3");
      await tgUpload("sendVoice", form).catch(error => console.warn("[telegram] voice reply failed:", (error as Error).message));
    }
  }
}

/** Process one Telegram update (used by long polling; also callable from a webhook or a test harness). */
export function handleUpdate(update: Update) {
  const callback = update.callback_query;
  const chatId = String(callback?.message?.chat.id ?? update.message?.chat.id ?? "");
  if (!chatId) return Promise.resolve();
  const languageCode = callback?.from?.language_code ?? update.message?.from?.language_code;
  return enqueue(chatId, async () => {
    const { session, fresh } = loadSession(chatId, languageCode);
    try {
      if (callback) {
        void tg("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => undefined);
        await onCallback(chatId, session, callback.data ?? "x", callback.message?.message_id, callback.from);
      } else if (update.message?.voice || update.message?.audio) {
        await onVoice(chatId, session, (update.message.voice ?? update.message.audio)!);
      } else if (update.message?.text) {
        if (fresh && !update.message.text.startsWith("/")) await showWelcome(chatId);
        else await onText(chatId, session, update.message.text.trim());
      }
    } catch (error) {
      console.warn("[telegram] handler error:", (error as Error).message);
      // Planner rule messages ("Can't confirm from 'negotiate'") help the user; internal errors stay in the server log.
      const detail = (error as Error).message;
      const shown = /sqlite|fetch|undefined|null|cannot read|json|timeout|abort/i.test(detail) ? "" : `\n<i>${esc(detail).slice(0, 200)}</i>`;
      await send(chatId, `${say(session.lang, "error")}${shown}`, [[{ text: say(session.lang, "btnTrip"), data: "M:trip" }, { text: "☰", data: "M:menu" }]]).catch(() => undefined);
    } finally {
      saveBotSession(chatId, session);
    }
  });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const COMMANDS: Record<Lang, [string, string][]> = {
  "en-IN": [["demo", "Try the demo trip"], ["start", "Start / choose language"], ["menu", "Main menu"], ["packages", "Browse packages"], ["plan", "Plan with AI"], ["trip", "My trip"], ["language", "Change language"], ["reset", "Start over"]],
  hi: [["demo", "डेमो आज़माएँ"], ["start", "शुरू करें / भाषा चुनें"], ["menu", "मेन्यू"], ["packages", "पैकेज देखें"], ["plan", "AI से प्लान करें"], ["trip", "मेरी यात्रा"], ["language", "भाषा बदलें"], ["reset", "नई शुरुआत"]],
  ta: [["demo", "டெமோ பயணம்"], ["start", "தொடங்கு / மொழி"], ["menu", "மெனு"], ["packages", "தொகுப்புகள்"], ["plan", "AI உடன் திட்டமிடு"], ["trip", "என் பயணம்"], ["language", "மொழியை மாற்று"], ["reset", "புதிதாகத் தொடங்கு"]],
  te: [["demo", "డెమో ప్రయాణం"], ["start", "ప్రారంభించు / భాష"], ["menu", "మెనూ"], ["packages", "ప్యాకేజీలు"], ["plan", "AI తో ప్లాన్"], ["trip", "నా ప్రయాణం"], ["language", "భాష మార్చు"], ["reset", "కొత్తగా ప్రారంభించు"]],
};

let running = false;

/** Start long polling when TELEGRAM_BOT_TOKEN is set (disable with TELEGRAM_BOT_DISABLED=true, e.g. locally once deployed). */
/**
 * Only one process may poll a bot token. The deployed server (NODE_ENV=production, i.e. Railway) polls by default; a local
 * dev server only when TELEGRAM_BOT_DISABLED=false is set explicitly, so running `pnpm dev` never steals the live bot.
 */
function botWanted() {
  const flag = process.env.TELEGRAM_BOT_DISABLED?.trim().toLowerCase();
  if (flag === "true") return false;
  if (flag === "false") return true;
  return process.env.NODE_ENV === "production";
}

export function startTelegramBot() {
  if (running || !token() || process.env.VITEST || !botWanted()) {
    if (!running && token() && !process.env.VITEST) console.log("[telegram] bot not started here (the deployed server runs it; set TELEGRAM_BOT_DISABLED=false to run it locally)");
    return;
  }
  running = true;
  void (async () => {
    try {
      await tg("deleteWebhook", { drop_pending_updates: false });
      for (const [lang, commands] of Object.entries(COMMANDS)) {
        await tg("setMyCommands", { commands: commands.map(([command, description]) => ({ command, description })), ...(lang === "en-IN" ? {} : { language_code: lang }) });
      }
      const me = await tg<{ username: string }>("getMe");
      console.log(`[telegram] @${me.username} is live (long polling)`);
    } catch (error) {
      console.warn("[telegram] setup:", (error as Error).message);
    }
    let offset = 0;
    let warnedConflict = false;
    while (running) {
      try {
        const updates = await tg<Update[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35000);
        for (const update of updates) { offset = update.update_id + 1; void handleUpdate(update); }
        warnedConflict = false;
      } catch (error) {
        const conflict = (error as { code?: number }).code === 409;
        if (!conflict || !warnedConflict) console.warn(`[telegram] ${conflict ? "another instance is polling this bot token (set TELEGRAM_BOT_DISABLED=true on one of them)" : (error as Error).message}`);
        warnedConflict ||= conflict;
        await new Promise(resolve => setTimeout(resolve, conflict ? 15000 : 4000));
      }
    }
  })();
}

export function stopTelegramBot() { running = false; }
