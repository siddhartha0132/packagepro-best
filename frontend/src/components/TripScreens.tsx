import type { ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, ArrowRight, BadgeCheck, BedDouble, Bot, CalendarMinus, Car, Check, CircleAlert, Clock, Compass, Heart, Loader2, MapPin, Plane, Sparkles, Ticket, TrendingUp, Users, UtensilsCrossed, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type CopyKey, type Lang, t } from "@/i18n";
import type { AppRouter } from "../../../backend/src/routers";
import type { TripView } from "./PackageCustomiser";
import { useTr } from "@/lib/translate";

export const slotLabel = (lang: Lang, slot?: string) => (slot && ["morning", "afternoon", "evening", "overnight"].includes(slot) ? t(lang, `slot_${slot}` as CopyKey) : slot ?? "");
export const specLabel = (lang: Lang, spec: string) => t(lang, `spec_${spec}` as CopyKey) || spec;

export type Estimate = inferRouterOutputs<AppRouter>["packagepro"]["estimate"];
type Flight = TripView["flightOptions"][number];

export const money = (value: number | null | undefined) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
export function prettyDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { day: value, rest: "" };
  const parts = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit", weekday: "short", timeZone: "UTC" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return { day: get("day"), rest: `${get("month")}'${get("year")}`, weekday: get("weekday") };
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08),0_8px_24px_rgba(16,24,40,.06)] ${className}`}>{children}</div>;
}

export function SectionTitle({ icon, title, sub, right }: { icon?: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[15px] font-bold text-[#0b1f3a]">{icon}{title}</div>{sub && <p className="mt-0.5 text-xs text-[#5f6b7a]">{sub}</p>}</div>{right}</div>;
}

export function ScreenHeader({ title, sub, onBack, backLabel }: { title: string; sub?: string; onBack?: () => void; backLabel: string }) {
  return <div className="mb-4">
    {onBack && <button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[#0b6bcb] hover:underline"><ArrowLeft className="h-3.5 w-3.5" />{backLabel}</button>}
    <h1 className="text-2xl font-extrabold tracking-tight text-[#0b1f3a] md:text-[28px]">{title}</h1>
    {sub && <p className="mt-1 text-sm text-[#5f6b7a]">{sub}</p>}
  </div>;
}

export function AirlineLogo({ flight }: { flight: Pick<Flight, "logo" | "airline"> }) {
  return flight.logo
    ? <img src={flight.logo} alt="" className="h-9 w-9 rounded-md bg-white object-contain p-0.5 ring-1 ring-[#e6ebf2]" loading="lazy" />
    : <div className="grid h-9 w-9 place-items-center rounded-md bg-[#e8f1fd] text-[11px] font-bold text-[#0b6bcb]">{flight.airline.split(/\s+/).map(word => word[0]).join("").slice(0, 2)}</div>;
}

/** Flight result row in the booking-site layout: carrier · depart — duration — arrive · fare · CTA. */
export function FlightRow({ flight, lang, onSelect, disabled, cheapest, travelers = 1 }: { flight: Flight; lang: Lang; onSelect?: () => void; disabled?: boolean; cheapest?: boolean; travelers?: number }) {
  const copy = (key: CopyKey) => t(lang, key);
  const [from, to] = flight.route.split("→").map(part => part.trim());
  const stops = flight.stops ?? 0;
  return <div className={`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 rounded-xl border p-4 transition sm:grid-cols-[180px_1fr_auto] ${cheapest ? "border-[#0b6bcb]/40 bg-[#f5f9ff]" : "border-[#e6ebf2] bg-white hover:border-[#0b6bcb]/40"}`}>
    <div className="flex items-center gap-3"><AirlineLogo flight={flight} /><div className="min-w-0"><div className="truncate text-sm font-bold text-[#0b1f3a]">{flight.airline}</div><div className="text-[11px] text-[#5f6b7a]">{flight.id}{flight.aircraft ? ` · ${flight.aircraft}` : ""}</div></div></div>
    <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
      <div className="text-right"><div className="text-xl font-extrabold text-[#0b1f3a]">{flight.depart}</div><div className="text-[11px] font-semibold text-[#5f6b7a]">{from}</div></div>
      <div className="flex-1 text-center"><div className="text-[11px] text-[#5f6b7a]">{flight.duration}</div><div className="relative my-1 h-px bg-[#c9d3e0]"><Plane className="absolute -top-2 right-0 h-4 w-4 rotate-45 text-[#9aa7b8]" /></div><div className={`text-[11px] font-semibold ${stops ? "text-[#c2410c]" : "text-[#0e8a5f]"}`}>{stops ? `${stops} ${copy("stops")}${flight.via ? ` · ${flight.via}` : ""}` : copy("nonStop")}</div></div>
      <div><div className="text-xl font-extrabold text-[#0b1f3a]">{flight.arrive || "—"}</div><div className="text-[11px] font-semibold text-[#5f6b7a]">{to}</div></div>
    </div>
    <div className="col-span-2 flex items-center justify-between gap-4 border-t border-dashed border-[#e6ebf2] pt-3 sm:col-span-1 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
      <div className="text-right"><div className="text-xl font-extrabold text-[#0b1f3a]">{money(flight.price)}</div>{travelers > 1 && <div className="text-[11px] text-[#5f6b7a]">{copy("perPerson")} · <strong className="text-[#0b1f3a]">{money(flight.price * travelers)}</strong> ×{travelers}</div>}<div className="text-[10px] text-[#5f6b7a]">{copy(flight.source === "google_flights" ? "srcGoogle" : flight.source === "aviationstack" ? "srcSchedule" : flight.source === "skyscanner" ? "srcSkyscanner" : "srcCatalogue")}</div></div>
      {onSelect && <Button disabled={disabled} onClick={onSelect} className="h-9 rounded-full bg-gradient-to-r from-[#1a8cff] to-[#0b5ed7] px-6 text-xs font-bold uppercase tracking-wide text-white shadow-md hover:opacity-95">{copy("select")}</Button>}
    </div>
  </div>;
}

function RangeBar({ low, typical, high, budget, lang }: { low: number; typical: number; high: number; budget: number; lang: Lang }) {
  const copy = (key: CopyKey) => t(lang, key);
  // Scale from just below the cheapest value (not ₹0) so close figures still spread across the bar.
  const min = Math.min(low, budget) * 0.85;
  const max = Math.max(high, budget) * 1.05;
  const pct = (value: number) => Math.min(100, Math.max(0, ((value - min) / Math.max(1, max - min)) * 100));
  const pos = (value: number) => `${pct(value)}%`;
  // Near-identical low and typical collapse into one label; otherwise labels are pushed at least GAP% apart.
  const GAP = 16;
  const merged = Math.abs(typical - low) / Math.max(1, typical) < 0.03;
  const labels = merged
    ? [{ key: "lt", label: `${copy("low")} ≈ ${copy("typicalEst")}`, value: money(low) === money(typical) ? money(low) : `${money(low)}–${money(typical).slice(1)}`, at: pct(low) }, { key: "high", label: copy("high"), value: money(high), at: pct(high) }]
    : [{ key: "low", label: copy("low"), value: money(low), at: pct(low) }, { key: "typ", label: copy("typicalEst"), value: money(typical), at: pct(typical) }, { key: "high", label: copy("high"), value: money(high), at: pct(high) }];
  for (let i = 1; i < labels.length; i++) labels[i].at = Math.max(labels[i].at, labels[i - 1].at + GAP);
  labels[labels.length - 1].at = Math.min(labels[labels.length - 1].at, 100);
  for (let i = labels.length - 2; i >= 0; i--) labels[i].at = Math.min(labels[i].at, labels[i + 1].at - GAP);
  const align = (at: number) => (at < 8 ? "translate-x-0 text-left" : at > 92 ? "-translate-x-full text-right" : "-translate-x-1/2 text-center");
  const budgetAt = pct(budget);
  return <div className="mt-5">
    <div className="relative mb-1 h-5 text-[10px] font-bold text-[#0b1f3a]"><span className={`absolute whitespace-nowrap rounded bg-[#0b1f3a] px-1.5 py-0.5 text-white ${align(budgetAt)}`} style={{ left: `${budgetAt}%` }}>{copy("yourBudget")} {money(budget)}</span></div>
    <div className="relative h-3 rounded-full bg-[#eef2f7]">
      <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#34c38f] via-[#f5b83d] to-[#ef6a4c]" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
      {[low, typical].map((value, index) => <div key={index} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#0b1f3a]/70" style={{ left: pos(value) }} />)}
      <div className="absolute -top-1.5 h-6 w-1 -translate-x-1/2 rounded bg-[#0b1f3a]" style={{ left: `${budgetAt}%` }} />
    </div>
    <div className="relative mt-2 h-10 text-[11px] text-[#5f6b7a]">
      {labels.map(item => <div key={item.key} className={`absolute whitespace-nowrap ${align(item.at)}`} style={{ left: `${Math.max(0, item.at)}%` }}><div className="font-bold text-[#0b1f3a]">{item.value}</div>{item.label}</div>)}
    </div>
  </div>;
}

/** Live estimate: range vs budget, live flights, package, hotel tiers, guides, what past travellers liked, AI insight. */
export function EstimateView({ estimate, loading, lang, onContinue, continuing, onFixParty }: { estimate?: Estimate; loading: boolean; lang: Lang; onContinue: (travelers?: number) => void; continuing: boolean; onFixParty?: (travelers: number) => void }) {
  const copy = (key: CopyKey) => t(lang, key);
  const tr = useTr(lang);
  if (loading || !estimate) return <Panel className="grid place-items-center p-16 text-sm text-[#5f6b7a]"><Loader2 className="mb-3 h-7 w-7 animate-spin text-[#0b6bcb]" />{copy("searching")}</Panel>;
  const e = estimate;
  const groupRange = e.groupSize.min === e.groupSize.max ? `${e.groupSize.min}` : `${e.groupSize.min}–${e.groupSize.max}`;
  const fixedParty = Math.min(e.groupSize.max, Math.max(e.groupSize.min, e.party.pax));
  const tone = e.verdict === "comfortable" ? "bg-[#e7f8f0] text-[#0e8a5f]" : e.verdict === "tight" ? "bg-[#fff4e0] text-[#b45309]" : "bg-[#fdecea] text-[#c0392b]";
  const pop = e.popularity;
  return <div className="space-y-4">
    <Panel className="overflow-hidden">
      <div className="relative h-40 bg-[#0b1f3a] md:h-48">
        <img src={e.insight.image || e.package.image} alt={e.destination} className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#061428]/90 via-[#061428]/30 to-transparent" />
        <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-3 text-white">
          <div><div className="text-[11px] font-bold uppercase tracking-[.2em] text-white/75">{tr(e.package.theme)} · {e.days} {copy("days")}</div><div className="text-2xl font-extrabold md:text-3xl">{tr(e.destination)}</div><div className="text-xs text-white/80">{tr(e.package.name)}</div></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{copy(e.verdict as CopyKey)}</span>
        </div>
      </div>
      <div className="p-5">
        <SectionTitle icon={<TrendingUp className="h-4 w-4 text-[#0b6bcb]" />} title={copy("estimateTitle")} sub={copy("estimateSub")} />
        <RangeBar low={e.low} typical={e.typical} high={e.high} budget={e.budget} lang={lang} />
      </div>
    </Panel>

    <Panel className="p-5">
      <SectionTitle icon={<Plane className="h-4 w-4 text-[#0b6bcb]" />} title={copy("liveFlights")} sub={e.flights.note ? tr(e.flights.note) : `${e.flights.source === "serpapi" ? copy("srcGoogle") : e.flights.source} · ${e.dates[0]}`}
        right={e.flights.insights?.typicalRange && <div className="text-right text-[11px] text-[#5f6b7a]">{copy("typicalFare")}<div className="text-sm font-bold text-[#0b1f3a]">{money(e.flights.insights.typicalRange[0])}–{money(e.flights.insights.typicalRange[1])}</div>{e.flights.insights.priceLevel && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${e.flights.insights.priceLevel === "low" ? "bg-[#e7f8f0] text-[#0e8a5f]" : e.flights.insights.priceLevel === "high" ? "bg-[#fdecea] text-[#c0392b]" : "bg-[#fff4e0] text-[#b45309]"}`}>{copy("priceLevel")}: {e.flights.insights.priceLevel}</span>}</div>} />
      <div className="mt-4 space-y-2">{e.flights.options.slice(0, 3).map((flight, index) => <FlightRow key={flight.id} flight={flight} lang={lang} cheapest={index === 0} travelers={e.party.pax} />)}</div>
    </Panel>

    <div className="grid gap-4 md:grid-cols-2">
      <Panel className="p-5">
        <SectionTitle icon={<BedDouble className="h-4 w-4 text-[#0b6bcb]" />} title={copy("hotelTiers")} sub={`${tr(e.package.name)} · ${money(e.package.forTrip)}`} />
        <div className="mt-3 space-y-2">{e.hotels.options.slice(0, 4).map(hotel => <div key={hotel.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f6f8fb] px-3 py-2"><div className="min-w-0"><div className="truncate text-sm font-semibold text-[#0b1f3a]">{tr(hotel.name)}{hotel.isDefault && <BadgeCheck className="ml-1 inline h-3.5 w-3.5 text-[#0b6bcb]" />}</div><div className="truncate text-[11px] text-[#5f6b7a]">{tr(hotel.detail)}</div></div><span className={`shrink-0 text-xs font-bold ${hotel.delta > 0 ? "text-[#c0392b]" : hotel.delta < 0 ? "text-[#0e8a5f]" : "text-[#5f6b7a]"}`}>{hotel.isDefault ? copy("included") : `${hotel.delta >= 0 ? "+" : "−"}${money(Math.abs(hotel.delta))}`}</span></div>)}</div>
      </Panel>
      <Panel className="p-5">
        <SectionTitle icon={<Compass className="h-4 w-4 text-[#0b6bcb]" />} title={copy("guidesInLanguage")} sub={e.dates.join(" · ")} />
        <div className="mt-3 space-y-2">
          {e.guides.length === 0 && <div className="rounded-lg bg-[#f6f8fb] p-3 text-xs text-[#5f6b7a]">{copy("noGuides")}</div>}
          {e.guides.map(guide => <div key={guide.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f6f8fb] px-3 py-2"><div className="min-w-0"><div className="text-sm font-semibold text-[#0b1f3a]">{guide.name} <span className="text-[11px] font-normal text-[#5f6b7a]">★ {guide.rating}</span></div><div className={`text-[11px] ${guide.available ? "text-[#0e8a5f]" : "text-[#c0392b]"}`}>{specLabel(lang, guide.specialisation)} · {guide.available ? copy("availableAllDates") : `${copy("blockedDates")} ${guide.unavailableDates.slice(0, 2).join(", ")}`}</div></div><span className="shrink-0 text-xs font-bold text-[#0b1f3a]">{money(guide.tripCost)}</span></div>)}
        </div>
      </Panel>
    </div>

    <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
      <Panel className="p-5">
        <SectionTitle icon={<Heart className="h-4 w-4 text-[#e0457b]" />} title={copy("travellersLove")} sub={`${pop.trips} ${copy("pastTrips")} · ${pop.confirmedBookings} ${copy("bookedBy")}${pop.avgBookingInr ? ` · ${copy("avgSpend")} ${money(pop.avgBookingInr)}` : ""}`} />
        {pop.topPlaces.length > 0 && <><div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-[#5f6b7a]">{copy("mostVisited")}</div><div className="mt-2 space-y-1.5">{pop.topPlaces.slice(0, 4).map(place => <div key={place.title} className="flex items-center gap-2 text-sm"><MapPin className="h-3.5 w-3.5 shrink-0 text-[#0b6bcb]" /><span className="flex-1 truncate">{tr(place.title)}</span><div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#eef2f7]"><div className="h-full rounded-full bg-[#0b6bcb]" style={{ width: `${(place.count / pop.topPlaces[0].count) * 100}%` }} /></div></div>)}</div></>}
        {pop.topInterests.length > 0 && <><div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-[#5f6b7a]">{copy("cameFor")}</div><div className="mt-2 flex flex-wrap gap-1.5">{pop.topInterests.map(item => <span key={item.interest} className="rounded-full bg-[#fdf0f5] px-2.5 py-1 text-[11px] font-semibold text-[#b8325f]">{tr(item.interest)}</span>)}{pop.tripTypes.slice(0, 3).map(item => <span key={item.type} className="rounded-full bg-[#eef2f7] px-2.5 py-1 text-[11px] font-semibold text-[#334155]"><Users className="mr-1 inline h-3 w-3" />{tr(item.type)}</span>)}</div></>}
      </Panel>
      <Panel className="border border-[#d7c9ff] bg-gradient-to-br from-[#f7f3ff] to-white p-5">
        <SectionTitle icon={e.ai.source === "llm" ? <Sparkles className="h-4 w-4 text-[#7c3aed]" /> : <Bot className="h-4 w-4 text-[#7c3aed]" />} title={e.ai.source === "llm" ? copy("aiInsight") : copy("rulesInsight")} sub={e.ai.source === "llm" ? (e.ai.model.startsWith("sarvam") ? copy("llmBy") : e.ai.model) : copy("noLlm")} />
        <div className="mt-3 whitespace-pre-line text-[13px] leading-6 text-[#2d3748]">{e.ai.source === "llm" ? e.ai.text : e.ai.text.split("\n").map(line => tr(line)).join("\n")}</div>
      </Panel>
    </div>

    {!e.groupSize.ok && <Panel className="flex flex-wrap items-center gap-3 border border-[#f3c1b8] bg-[#fff6f4] p-4 text-sm text-[#7a3b2e]"><CircleAlert className="h-4 w-4 shrink-0 text-[#c0392b]" /><span className="flex-1">{copy("groupSizeLabel")} <strong>{groupRange}</strong> {copy("travellersWord")}.</span>{onFixParty && <Button size="sm" onClick={() => onFixParty(fixedParty)} className="rounded-full bg-[#0b1f3a] text-white">{copy("useParty")} {fixedParty} {copy("travellersWord")}</Button>}</Panel>}
    {/* Never a dead end: with a party outside the package's group size, one click applies the nearest legal party and continues (the backend enforces the same rule). */}
    <Button disabled={continuing} onClick={() => onContinue(e.groupSize.ok ? undefined : fixedParty)} className="h-12 w-full rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-sm font-extrabold uppercase tracking-wider text-white shadow-lg hover:opacity-95">{continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : e.groupSize.ok ? copy("continueFlights") : `${copy("continueFlights")} · ${fixedParty} ${copy("travellersWord")}`}</Button>
  </div>;
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return <div className="flex items-center gap-1 overflow-x-auto">{steps.map((step, index) => <div key={step} className="flex shrink-0 items-center gap-1">
    <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${index < current ? "text-[#0e8a5f]" : index === current ? "bg-[#0b6bcb] text-white" : "text-[#9aa7b8]"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${index < current ? "bg-[#e7f8f0]" : index === current ? "bg-white/25" : "bg-[#eef2f7]"}`}>{index < current ? <Check className="h-3 w-3" /> : index + 1}</span>{step}
    </div>
    {index < steps.length - 1 && <div className={`h-px w-6 ${index < current ? "bg-[#0e8a5f]" : "bg-[#dde3ec]"}`} />}
  </div>)}</div>;
}

type BudgetFix = NonNullable<TripView["pending"]>["fixes"][number];
const FIX_ICON: Record<string, ReactNode> = {
  auto: <Wand2 className="h-4 w-4" />, flight: <Plane className="h-4 w-4" />, hotel: <BedDouble className="h-4 w-4" />, experience: <Sparkles className="h-4 w-4" />,
  transfer: <Car className="h-4 w-4" />, meal: <UtensilsCrossed className="h-4 w-4" />, entry_ticket: <Ticket className="h-4 w-4" />, addon: <X className="h-4 w-4" />,
  guide: <Compass className="h-4 w-4" />, days: <CalendarMinus className="h-4 w-4" />,
};

/**
 * Over budget: the engine prices concrete fixes on the whole plan (cheaper flight, stay, activity or transfer, dropping an
 * add-on or guide, one day less, or a combined "fit my budget" plan). One tap applies a fix; the plan is re-priced and, if still
 * over, fresh options appear. Approving the extra, declining or raising the budget remain available.
 */
export function NegotiationPanel({ trip, lang, busy, newCap, setNewCap, onChoose, onFix, onRaise }: { trip: TripView; lang: Lang; busy: boolean; newCap: string; setNewCap: (value: string) => void; onChoose: (choice: "approve_overage" | "swap_cheaper" | "remove_item") => void; onFix: (fixId: string) => void; onRaise: () => void }) {
  const copy = (key: CopyKey) => t(lang, key);
  const tr = useTr(lang);
  const pending = trip.pending;
  const fixes = pending?.fixes ?? [];
  const total = pending?.total ?? trip.runningTotal + (pending?.amount ?? 0);
  const overage = pending?.overage ?? Math.max(0, total - trip.budgetCap);
  const fillPct = Math.min(100, (trip.budgetCap / Math.max(1, total)) * 100);
  const decline = trip.negotiationOptions.find(option => option.choice === "swap_cheaper");
  const change = (fix: { from?: string; to?: string; kind: string }) => fix.kind === "days" ? `${fix.from} → ${fix.to} ${copy("days").toLowerCase()}` : fix.to ? <>{tr(fix.from ?? "")} <ArrowRight className="inline h-3 w-3" /> {tr(fix.to)}</> : tr(fix.from ?? "");
  const card = (fix: BudgetFix) => <button key={fix.id} disabled={busy} onClick={() => onFix(fix.id)} className={`group flex w-full flex-col rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 ${fix.kind === "auto" ? "border-[#7c3aed] bg-[#f7f3ff]" : fix.fits ? "border-[#b7ebd3] bg-white" : "border-[#e6ebf2] bg-white"}`}>
    <div className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-2 text-sm font-extrabold ${fix.kind === "auto" ? "text-[#6d28d9]" : "text-[#0b1f3a]"}`}><span className={`grid h-7 w-7 place-items-center rounded-lg ${fix.kind === "auto" ? "bg-[#7c3aed] text-white" : "bg-[#eef3fa] text-[#0b6bcb]"}`}>{FIX_ICON[fix.kind]}</span>{copy(`fix_${fix.kind}` as CopyKey)}</span>
      {fix.kind === "auto" ? <span className="rounded-full bg-[#7c3aed] px-2 py-0.5 text-[10px] font-bold text-white">{copy("recommendedFix")}</span> : fix.fits && <span className="flex items-center gap-1 rounded-full bg-[#e7f8f0] px-2 py-0.5 text-[10px] font-bold text-[#0e8a5f]"><Check className="h-3 w-3" />{copy("fixFits")}</span>}
    </div>
    <div className="mt-2 text-xs leading-5 text-[#5f6b7a]">{fix.kind === "auto" ? (fix.steps ?? []).map((step, index) => <div key={index} className="flex items-center gap-1.5"><span className="text-[#7c3aed]">{FIX_ICON[step.kind]}</span><span>{change(step)}</span></div>) : change(fix)}</div>
    <div className="mt-3 flex items-end justify-between gap-2 border-t border-[#eef2f7] pt-2">
      <span className="text-xs text-[#5f6b7a]">{copy("fixSaves")} <b className="text-sm text-[#0e8a5f]">{money(fix.saving)}</b></span>
      <span className="text-right text-xs text-[#5f6b7a]">{copy("fixNewTotal")} <b className="text-sm text-[#0b1f3a]">{money(fix.newTotal)}</b>{!fix.fits && <span className="block text-[10px] text-[#b45309]">{copy("fixStillOver")} {money(fix.newTotal - trip.budgetCap)}</span>}</span>
    </div>
  </button>;
  return <Panel className="border border-[#f3c1b8] p-5">
    <SectionTitle icon={<CircleAlert className="h-4 w-4 text-[#c0392b]" />} title={copy("overBudget")} sub={copy("overBudgetSub")} />
    {/* Budget vs the plan with this change */}
    <div className="mt-4 rounded-xl bg-[#fff6f4] p-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#7a3b2e]">{tr(pending?.label ?? "")}</div><div className="mt-1 text-2xl font-black text-[#0b1f3a]">{money(total)} <span className="text-sm font-semibold text-[#5f6b7a]">{copy("of")} {money(trip.budgetCap)}</span></div></div><div className="rounded-full bg-[#c0392b] px-3 py-1 text-xs font-extrabold text-white">+{money(overage)} {copy("overBudgetBy")}</div></div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#f3c1b8]"><div className="h-full rounded-full bg-[#0b6bcb]" style={{ width: `${fillPct}%` }} /></div>
    </div>
    {fixes.length > 0 && <div className="mt-5">
      <div className="text-sm font-extrabold text-[#0b1f3a]">{copy("fitWays")}</div>
      <p className="mt-0.5 text-xs text-[#5f6b7a]">{copy("fitWaysSub")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{fixes.map(card)}</div>
    </div>}
    <div className="mt-5 text-[10px] font-bold uppercase tracking-[.16em] text-[#5f6b7a]">{copy("orDecide")}</div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <button disabled={busy} onClick={() => onChoose("approve_overage")} className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-3 text-left text-sm font-semibold text-[#0b1f3a] hover:border-[#0b6bcb]">{copy("ngApproveExtra")} {money(overage)}</button>
      {decline && <button disabled={busy} onClick={() => onChoose("swap_cheaper")} className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-3 text-left text-sm font-semibold text-[#0b1f3a] hover:border-[#0b6bcb]">{copy(pending?.retryStatus === "select_flight" ? "ngDeclineFlight" : "ngDeclineKeep")}</button>}
    </div>
    <div className="mt-2 flex gap-2"><input type="number" placeholder={copy("newCap")} value={newCap} onChange={event => setNewCap(event.target.value)} className="h-11 flex-1 rounded-xl border border-[#e6ebf2] px-3 text-sm" /><Button disabled={busy || !newCap || Number(newCap) <= trip.budgetCap} onClick={onRaise} className="h-11 rounded-xl bg-[#0b1f3a] px-5 text-white">{copy("set")}</Button></div>
    {Number(newCap) > 0 && Number(newCap) <= trip.budgetCap && <p className="mt-1 text-[11px] text-[#b45309]">{copy("newCap")} &gt; {money(trip.budgetCap)}</p>}
  </Panel>;
}

export function ReviewPanel({ trip, lang, busy, email, phone, setEmail, setPhone, onConfirm, onEdit, onWhatsApp, onStartOver }: { trip: TripView; lang: Lang; busy: boolean; email: string; phone: string; setEmail: (v: string) => void; setPhone: (v: string) => void; onConfirm: () => void; onEdit: () => void; onWhatsApp: () => void; onStartOver: () => void }) {
  const copy = (key: CopyKey) => t(lang, key);
  const tr = useTr(lang);
  const confirmed = trip.status === "confirmed";
  const leg = trip.chosenFlight;
  return <div className="space-y-4">
    {confirmed && <Panel className="flex items-center gap-3 border border-[#b7ebd3] bg-[#e7f8f0] p-5 text-[#0e8a5f]"><Check className="h-6 w-6" /><div className="flex-1"><div className="font-extrabold">{copy("confirmed")}</div><div className="text-xs">{copy("final")} {money(trip.runningTotal)} {copy("of")} {money(trip.budgetCap)}</div></div>{trip.booking && <div className="rounded-xl bg-white px-4 py-2 text-right"><div className="text-[10px] font-bold uppercase tracking-wider text-[#5f6b7a]">PNR</div><div className="font-mono text-lg font-black text-[#0b1f3a]">{trip.booking.reference}</div></div>}</Panel>}
    {leg && <Panel className="p-5"><SectionTitle icon={<Plane className="h-4 w-4 text-[#0b6bcb]" />} title={copy("flight")} sub={trip.departDate} /><div className="mt-3"><FlightRow flight={leg} lang={lang} travelers={trip.travelers} /></div></Panel>}
    {trip.chosenTransport && <Panel className="p-5"><SectionTitle icon={<Clock className="h-4 w-4 text-[#0b6bcb]" />} title={trip.chosenTransport.operator} sub={`${trip.chosenTransport.route} · ${trip.chosenTransport.depart} · ${trip.chosenTransport.duration}`} right={<span className="font-bold">{money(trip.chosenTransport.price)}</span>} /></Panel>}
    <Panel className="p-5">
      <SectionTitle icon={<MapPin className="h-4 w-4 text-[#0b6bcb]" />} title={trip.package ? tr(trip.package.name) : copy("yourPackage")} sub={`${trip.departDate} → ${trip.returnDate} · ${trip.durationDays} ${copy("days")}`} right={<span className="text-lg font-extrabold">{money(trip.priceBreakdown.packageTotal)}</span>} />
      <div className="mt-4 space-y-3">{trip.itinerary.map(day => <div key={day.date} className="flex gap-3"><div className="w-14 shrink-0 text-center"><div className="rounded-lg bg-[#e8f1fd] py-1 text-[10px] font-bold uppercase text-[#0b6bcb]">{copy("day")} {day.day}</div><div className="mt-1 text-[10px] text-[#5f6b7a]">{day.date.slice(5)}</div></div><div className="flex-1 space-y-1 border-l-2 border-dashed border-[#dde3ec] pl-3">{day.items.map((item, index) => <div key={index} className="text-sm"><span className="mr-2 text-[10px] font-bold uppercase text-[#9aa7b8]">{slotLabel(lang, item.slot)}</span>{tr(item.label)}</div>)}</div></div>)}</div>
    </Panel>
    {trip.chosenGuide && <Panel className="p-5"><SectionTitle icon={<Compass className="h-4 w-4 text-[#0b6bcb]" />} title={`${copy("guide")}: ${trip.chosenGuide.name}`} sub={`${specLabel(lang, trip.chosenGuide.specialisation)} · ${trip.chosenGuide.languages.join(", ")} · ${trip.chosenGuide.bookedDates.join(", ")}`} right={<span className="font-bold">{money(trip.chosenGuide.totalCost)}</span>} /></Panel>}
    {!confirmed ? <Panel className="p-5">
      <div className="grid gap-3 sm:grid-cols-2"><input placeholder={copy("email")} value={email} onChange={event => setEmail(event.target.value)} type="email" className="h-11 rounded-xl border border-[#e6ebf2] px-3 text-sm" /><input placeholder={copy("phone")} value={phone} onChange={event => setPhone(event.target.value)} className="h-11 rounded-xl border border-[#e6ebf2] px-3 text-sm" /></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Button variant="outline" className="h-12 rounded-full" disabled={busy} onClick={onEdit}>{copy("editPackage")}</Button>
        <Button variant="outline" className="h-12 rounded-full border-[#25d366] text-[#128c4a]" onClick={onWhatsApp}>{copy("whatsapp")}</Button>
        <Button disabled={busy} onClick={onConfirm} className="h-12 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-sm font-extrabold uppercase tracking-wider text-white shadow-lg">{copy("confirmTrip")}</Button>
      </div>
    </Panel> : <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="h-12 rounded-full border-[#25d366] text-[#128c4a]" onClick={onWhatsApp}>{copy("whatsapp")}</Button><Button variant="outline" className="h-12 rounded-full" onClick={onStartOver}>{copy("another")}</Button></div>}
  </div>;
}
