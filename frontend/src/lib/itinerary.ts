import type { Lang } from "@/i18n";
import { useTr } from "@/lib/translate";
import { QUOTE_COPY, QUOTE_EN } from "@/lib/quoteCopy";

// Shared by the web itinerary, the travel desk and the PDF: fixed wording is hand-written (QUOTE_COPY), dataset content
// (activities, hotels) goes through live translation, and proper nouns (hotel, guide, flight) are never translated.

/** Fixed words from hand-written copy; everything else through live translation. */
export function useFixedTr(lang: Lang) {
  const tr = useTr(lang);
  return (text: string) => QUOTE_COPY[lang]?.[text] ?? (QUOTE_EN[text] ? tr(QUOTE_EN[text]) : tr(text));
}

/** "Thanjavur Honeymoon — 6 Days" → "Thanjavur Honeymoon": the trip's own length is shown next to it. */
export const packageTitle = (name: string) => name.replace(/\s*[—-]\s*\d+\s*Days?$/i, "");

/** "Day 2 · morning · Brihadeeswarar temple" → "Brihadeeswarar temple". */
export const cleanDetail = (detail: string) => detail.replace(/^Day \d+ · \w+( · )?/, "");

/** Itinerary lines keep proper nouns intact and translate only the words around them. */
export function itemLabel(label: string, tr: (text: string) => string) {
  const named = label.match(/^(Guide:|Check in:|Check out:|Stay:) (.+)$/);
  if (named) return `${tr(named[1])} ${named[2]}`;
  const arrival = label.match(/^(Arrive on|Arrive by) (.+)$/);
  if (arrival) return `${tr(arrival[1])} ${arrival[2]}`;
  return tr(label);
}

export const KIND_TAG: Record<string, string> = {
  arrival: "Flight", experience: "Activity", transfer: "Transfer", meal: "Meal", entry_ticket: "Ticket", guide: "Guide", hotel: "Stay",
  leisure: "Free time", checkout: "Stay", departure: "Return trip",
};

const locale = (lang: Lang) => (lang === "en-IN" ? "en-IN" : `${lang}-IN`);

export function longDate(iso: string, lang: Lang) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { weekday: "", short: "", label: iso, full: iso };
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(lang), { ...options, timeZone: "UTC" }).format(date);
  return { weekday: format({ weekday: "long" }), short: format({ weekday: "short" }), label: format({ day: "numeric", month: "short" }), full: format({ day: "numeric", month: "long", year: "numeric" }) };
}
