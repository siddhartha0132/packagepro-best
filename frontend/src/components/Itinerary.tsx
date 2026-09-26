import type { ReactNode } from "react";
import { BedDouble, Car, Compass, Home, LogOut, Plane, Sparkles, Sun, Ticket, TrainFront, UtensilsCrossed } from "lucide-react";
import { type Lang, t } from "@/i18n";
import { cleanDetail, itemLabel, longDate, useFixedTr } from "@/lib/itinerary";
import type { TripView } from "./PackageCustomiser";
import { money, slotLabel, specLabel } from "./TripScreens";

type Day = TripView["itinerary"][number];
type Item = Day["items"][number];

const ICON: Record<string, ReactNode> = {
  arrival: <Plane className="h-3.5 w-3.5" />, transfer: <Car className="h-3.5 w-3.5" />, experience: <Sparkles className="h-3.5 w-3.5" />,
  meal: <UtensilsCrossed className="h-3.5 w-3.5" />, entry_ticket: <Ticket className="h-3.5 w-3.5" />, guide: <Compass className="h-3.5 w-3.5" />,
  hotel: <BedDouble className="h-3.5 w-3.5" />, leisure: <Sun className="h-3.5 w-3.5" />, checkout: <LogOut className="h-3.5 w-3.5" />, departure: <Home className="h-3.5 w-3.5" />,
};
const TONE: Record<string, string> = {
  arrival: "bg-[#e8f1fd] text-[#0b6bcb]", transfer: "bg-[#f3ece0] text-[#8a5a2b]", experience: "bg-[#efe8ff] text-[#6d28d9]", meal: "bg-[#f5e3df] text-[#ad4738]",
  entry_ticket: "bg-[#efe8f5] text-[#6b4a8a]", guide: "bg-[#fbf3e4] text-[#b6762a]", hotel: "bg-[#e6edf5] text-[#2b4f7d]", leisure: "bg-[#e7f8f0] text-[#0e8a5f]",
  checkout: "bg-[#e6edf5] text-[#2b4f7d]", departure: "bg-[#eef2f7] text-[#334155]",
};

/** "Day 3 · Wed, 30 Sept" — the day number with its real date in the reader's language. */
export function DayHeading({ day, date, lang, tag }: { day: number; date: string; lang: Lang; tag?: string }) {
  const when = longDate(date, lang);
  return <div className="flex items-baseline justify-between gap-2">
    <span className="text-sm font-extrabold text-[#0b1f3a]">{t(lang, "day")} {day}{tag && <span className="ml-2 rounded-full bg-[#eef2f7] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#5f6b7a]">{tag}</span>}</span>
    <span className="text-xs font-semibold text-[#5f6b7a]">{when.short}, {when.label}</span>
  </div>;
}

function Row({ item, lang, tr, trip, showPrices }: { item: Item; lang: Lang; tr: (text: string) => string; trip: TripView; showPrices: boolean }) {
  const flight = trip.chosenFlight;
  const detail = item.kind === "arrival"
    ? [item.detail, flight ? `${flight.depart} → ${flight.arrive ?? item.time ?? ""}` : item.time ? `${tr("Lands")} ${item.time}` : ""].filter(Boolean).join(" · ")
    : item.kind === "guide" ? (() => { const [spec, ...rest] = item.detail.split(" · "); return [specLabel(lang, spec), ...rest].join(" · "); })()
      : item.kind === "hotel" || item.kind === "checkout" ? tr(cleanDetail(item.detail)).split(" · ")[0]
        : item.detail ? tr(cleanDetail(item.detail)) : "";
  const icon = item.kind === "arrival" && trip.chosenTransport ? <TrainFront className="h-3.5 w-3.5" /> : ICON[item.kind];
  return <div className="flex items-start gap-3 py-2">
    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TONE[item.kind] ?? "bg-[#eef2f7] text-[#334155]"}`}>{icon}</span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#9aa7b8]">{item.time && item.kind === "arrival" ? item.time : slotLabel(lang, item.slot)}</span>
        <span className="text-sm font-semibold text-[#0b1f3a]">{itemLabel(item.label, tr)}</span>
      </div>
      {detail && <div className="mt-0.5 text-xs leading-5 text-[#5f6b7a]">{detail}</div>}
    </div>
    {showPrices && item.price != null && item.price !== 0 && <span className="shrink-0 text-xs font-bold text-[#0b1f3a]">{money(item.price)}</span>}
  </div>;
}

/**
 * The trip day by day, in the order it happens: land, get to the hotel, the day's plans (or free time), the night's stay —
 * and a last day for check-out. Read-only; the customiser has its own editable version.
 */
export function ItineraryDays({ trip, lang, showPrices = true }: { trip: TripView; lang: Lang; showPrices?: boolean }) {
  const tr = useFixedTr(lang);
  const days = [...trip.itinerary, ...(trip.departureDay ? [trip.departureDay] : [])];
  return <ol className="relative space-y-3">
    {days.map((day, index) => {
      const last = trip.departureDay != null && index === days.length - 1;
      return <li key={day.date} className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-3">
        <DayHeading day={day.day} date={day.date} lang={lang} tag={last ? tr("Check out:").replace(/:$/, "") : undefined} />
        <div className="mt-1 divide-y divide-[#f0f3f7]">{day.items.map((item, itemIndex) => <Row key={itemIndex} item={item} lang={lang} tr={tr} trip={trip} showPrices={showPrices} />)}</div>
      </li>;
    })}
  </ol>;
}
