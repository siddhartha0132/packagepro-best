import { useEffect, useState } from "react";
import { TripQuote } from "@/components/QuoteDocument";
import { type Lang, LANGS } from "@/i18n";
import { translationsSettled } from "@/lib/translate";
import { trpc } from "@/lib/trpc";

/**
 * /print?trip=trp_…&lang=ta&kind=quote|bill — the quotation (or bill) alone, for the server to turn into a PDF with headless
 * Chrome (backend/src/pdf.ts). Once every translation has arrived and every image has loaded it sets
 * <html data-print-ready="1">, which is what the renderer waits for.
 */
export default function PrintQuote() {
  const params = new URLSearchParams(window.location.search);
  const tripId = params.get("trip") ?? "";
  const lang = (LANGS.some(item => item.value === params.get("lang")) ? params.get("lang") : "en-IN") as Lang;
  const kind = params.get("kind") === "bill" ? "bill" : "quote";
  const trip = trpc.trip.get.useQuery({ tripId }, { enabled: Boolean(tripId), retry: false });
  const packages = trpc.packagepro.list.useQuery({ language: lang });
  const [ready, setReady] = useState(false);
  const image = packages.data?.find(item => item.id === trip.data?.package?.id)?.image;

  useEffect(() => {
    if (!trip.data || !packages.data || ready) return;
    let cancelled = false;
    void (async () => {
      await new Promise(resolve => setTimeout(resolve, 300)); // let the document render and queue its translations
      await translationsSettled(lang);
      const images = Array.from(document.querySelectorAll<HTMLImageElement>("#print-root img"));
      await Promise.race([Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = img.onerror = resolve; }))), new Promise(resolve => setTimeout(resolve, 8000))]);
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [trip.data, packages.data, lang, ready]);

  useEffect(() => { if (ready) document.documentElement.dataset.printReady = "1"; }, [ready]);
  useEffect(() => { if (trip.error) document.documentElement.dataset.printReady = "error"; }, [trip.error]);

  if (!trip.data) return <div style={{ padding: 32, fontFamily: "sans-serif" }}>{trip.error ? "Trip not found" : "Preparing…"}</div>;
  return <>
    <div style={{ padding: 32, fontFamily: "sans-serif", color: "#5f6b7a" }}>{ready ? "Ready to print" : "Preparing…"}</div>
    {kind === "bill" || trip.data.package ? <TripQuote trip={trip.data} lang={lang} image={image} kind={kind} /> : null}
  </>;
}

