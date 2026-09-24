import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeftRight, CircleAlert, Minus, Plus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { type CopyKey, type Lang, LANGS, t } from "@/i18n";
import type { AppRouter } from "../../../server/routers";
import { useTr } from "@/lib/translate";
import { slotLabel, specLabel } from "./TripScreens";

export type TripView = inferRouterOutputs<AppRouter>["trip"]["get"];

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const langName = (tag: string) => LANGS.find(item => item.value === tag)?.native ?? tag;
const KIND_TONE: Record<string, string> = {
  arrival: "bg-[#eef2f7] text-[#0b1f3a]", hotel: "bg-[#e6edf5] text-[#2b4f7d]", experience: "bg-[#e8f1fd] text-[#0b6bcb]",
  transfer: "bg-[#f3ece0] text-[#8a5a2b]", guide: "bg-[#fbf3e4] text-[#b6762a]", meal: "bg-[#f5e3df] text-[#ad4738]", entry_ticket: "bg-[#efe8f5] text-[#6b4a8a]",
};

/** Live package customiser: day-by-day itinerary, component swaps, add-ons, duration and the availability-checked guide. */
export function PackageCustomiser({ trip, lang, onContinue, busy }: { trip: TripView; lang: Lang; onContinue: () => void; busy: boolean }) {
  const copy = (key: CopyKey) => t(lang, key);
  const tr = useTr(lang);
  const utils = trpc.useUtils();
  const [openSwap, setOpenSwap] = useState<string | null>(null);
  const [guideDays, setGuideDays] = useState(trip.durationDays);
  const [specFilter, setSpecFilter] = useState<string | null>(null);
  const refresh = { onSuccess: () => { setOpenSwap(null); utils.trip.get.invalidate(); utils.trip.guides.invalidate(); }, onError: (error: { message: string }) => toast.error(error.message) };
  const swap = trpc.trip.swap.useMutation(refresh);
  const toggleAddOn = trpc.trip.toggleAddOn.useMutation(refresh);
  const setDuration = trpc.trip.setDuration.useMutation(refresh);
  const selectGuide = trpc.trip.selectGuide.useMutation(refresh);
  const removeGuide = trpc.trip.removeGuide.useMutation(refresh);
  const guides = trpc.trip.guides.useQuery({ tripId: trip.tripId });
  const loading = busy || swap.isPending || toggleAddOn.isPending || setDuration.isPending || selectGuide.isPending || removeGuide.isPending;
  const pkg = trip.package!;
  const issue = trip.guideAvailabilityIssue;
  const days = Math.min(Math.max(1, guideDays), trip.durationDays);
  const alternativesFor = (componentId: string) => {
    const current = pkg.components.find(item => item.id === componentId);
    return current?.swapGroup ? pkg.components.filter(item => item.swapGroup === current.swapGroup && item.id !== componentId) : [];
  };
  const addOns = trip.packageComponents.filter(item => item.optional);
  // Unit prices scale with the party: per room for hotels (2 per room), per vehicle for transfers (4 each), per person otherwise; guides per group.
  const party = trip.priceBreakdown.party;
  const unitsOf = (type?: string) => (type === "hotel" ? party.rooms : type === "transfer" ? party.vehicles : type === "guide" ? 1 : party.pax);
  const specialisations = Array.from(new Set((guides.data || []).map(guide => guide.specialisation)));
  const visibleGuides = (guides.data || []).filter(guide => !specFilter || guide.specialisation === specFilter);

  return <div className="space-y-6">
    {/* Package header + duration */}
    <div className="rounded-md border border-[#e6ebf2] bg-[#f6f8fb] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5"><Badge variant="outline" className="text-[10px] uppercase tracking-wider">{tr(pkg.theme)}</Badge><Badge variant="outline" className="text-[10px] uppercase tracking-wider">{copy(`tier_${pkg.tier}` as CopyKey)}</Badge><Badge variant="outline" className="text-[10px] uppercase tracking-wider">{copy(`diff_${pkg.difficulty}` as CopyKey)}</Badge></div>
          <h3 className="mt-2 font-extrabold text-2xl">{tr(pkg.name)}</h3>
          <p className="mt-1 text-xs leading-5 text-[#5f6b7a]">{tr(pkg.inclusions)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#5f6b7a]">{copy("offeredIn")}: {pkg.languagesOffered.map(tag => <span key={tag} className={`rounded-full px-2 py-0.5 ${tag === trip.language ? "bg-[#0b6bcb] text-white" : "bg-[#eef2f7]"}`}>{langName(tag)}</span>)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[.16em] text-[#5f6b7a]">{copy("duration")}</div>
          <div className="mt-1 flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={loading || trip.durationDays <= 1} onClick={() => setDuration.mutate({ tripId: trip.tripId, days: trip.durationDays - 1 })}><Minus className="h-3 w-3" /></Button>
            <span className="min-w-16 font-extrabold text-xl">{trip.durationDays} {copy("days")}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={loading || trip.durationDays >= 21} onClick={() => setDuration.mutate({ tripId: trip.tripId, days: trip.durationDays + 1 })}><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="mt-1 text-[11px] text-[#5f6b7a]">{trip.departDate} → {trip.returnDate}</div>
        </div>
      </div>
    </div>

    {/* Itinerary */}
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">{copy("itinerary")}</div>
      <div className="mt-3 space-y-3">
        {trip.itinerary.map(day => <div key={day.date} className="rounded-md border border-[#e6ebf2] bg-white/60">
          <div className="flex items-center justify-between border-b border-[#e6ebf2] px-4 py-2 text-xs"><span className="font-semibold">{copy("day")} {day.day}</span><span className="text-[#5f6b7a]">{day.date}</span></div>
          <div className="divide-y divide-[#eef2f7]">
            {day.items.map((item, index) => {
              const swappable = item.componentId && (item.kind !== "hotel" || day.day === 1) ? alternativesFor(item.componentId) : [];
              const key = `${day.day}-${index}`;
              const current = trip.packageComponents.find(component => component.id === item.componentId);
              return <div key={key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${KIND_TONE[item.kind] ?? "bg-[#eef2f7]"}`}>{slotLabel(lang, item.slot)}</span>
                    <div className="min-w-0"><div className="text-sm font-medium">{tr(item.label)}</div><div className="mt-0.5 text-xs text-[#5f6b7a]">{tr(item.detail)}</div></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.price != null && <span className="text-sm">{money(item.price * unitsOf(item.kind))}{unitsOf(item.kind) > 1 && <span className="ml-1 text-[10px] text-[#5f6b7a]">×{unitsOf(item.kind)}</span>}</span>}
                    {swappable.length > 0 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#0b6bcb]" onClick={() => setOpenSwap(openSwap === key ? null : key)}><ArrowLeftRight className="mr-1 h-3 w-3" />{copy("swap")}</Button>}
                    {item.kind === "guide" && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#ad4738]" disabled={loading} onClick={() => removeGuide.mutate({ tripId: trip.tripId })}><X className="mr-1 h-3 w-3" />{copy("remove")}</Button>}
                  </div>
                </div>
                {openSwap === key && current && <div className="mt-3 space-y-1 rounded-md bg-[#f6f8fb] p-2">
                  {swappable.map(option => <button key={option.id} disabled={loading} onClick={() => swap.mutate({ tripId: trip.tripId, fromId: current.id, toId: option.id })} className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm hover:bg-white disabled:opacity-50">
                    <span className="min-w-0"><span className="block">{tr(option.label)}</span><span className="block text-xs text-[#5f6b7a]">{tr(option.detail)}</span></span>
                    <span className="shrink-0 text-right"><span className="block">{money(option.price * unitsOf(option.type))}</span><span className={`block text-xs ${option.price - current.price > 0 ? "text-[#ad4738]" : "text-[#0b6bcb]"}`}>{signed((option.price - current.price) * unitsOf(option.type))}</span></span>
                  </button>)}
                </div>}
              </div>;
            })}
          </div>
        </div>)}
      </div>
    </div>

    {/* Add-ons */}
    {addOns.length > 0 && <div>
      <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">{copy("addOns")}</div>
      <p className="mt-1 text-xs text-[#5f6b7a]">{copy("addOnsSub")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {addOns.map(item => <div key={item.id} className={`flex items-center justify-between gap-3 rounded-md border p-3 ${item.included ? "border-[#0b6bcb] bg-[#e8f1fd]/50" : "border-[#e6ebf2] bg-white/60"}`}>
          <div className="min-w-0"><div className="text-sm font-medium">{tr(item.label)}</div><div className="text-xs text-[#5f6b7a]">{copy("day")} {Math.min(item.dayIndex ?? 1, trip.durationDays)} · {slotLabel(lang, item.slot)}</div></div>
          <Button size="sm" variant={item.included ? "outline" : "default"} disabled={loading} className={item.included ? "" : "bg-[#0b1f3a] text-[#ffffff]"} onClick={() => toggleAddOn.mutate({ tripId: trip.tripId, componentId: item.id, include: !item.included })}>{item.included ? copy("remove") : `${copy("add")} +${money(item.price * unitsOf(item.type))}`}</Button>
        </div>)}
      </div>
    </div>}

    {/* Guide */}
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">{copy("addGuide")}</div>
      <p className="mt-1 text-xs text-[#5f6b7a]">{copy("guideSub")} · {copy("availabilityRule")}</p>

      {trip.chosenGuide && <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[#0b6bcb] bg-[#e8f1fd]/60 p-3">
        <div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-[#0b6bcb]" /><div><div className="text-sm font-semibold">{copy("bookedGuide")}: {trip.chosenGuide.name}</div><div className="text-xs text-[#5f6b7a]">{specLabel(lang, trip.chosenGuide.specialisation)} · {trip.chosenGuide.languages.map(langName).join(", ")} · {trip.chosenGuide.daysBooked} {copy("days")} · {money(trip.chosenGuide.totalCost)}</div></div></div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => removeGuide.mutate({ tripId: trip.tripId })}>{copy("remove")}</Button>
      </div>}

      {issue && <div className="mt-3 rounded-md border border-[#ad4738] bg-[#f5e3df] p-4">
        <div className="flex items-start gap-2 text-sm font-semibold text-[#ad4738]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{copy("guideRefused")}: {issue.guide.name} {copy("unavailable")} {issue.conflictingDates.join(", ")}</span></div>
        <div className="mt-1 pl-6 text-xs text-[#7a3b2e]">{copy("strictAvailability")}: {issue.requestedDates.join(", ")}</div>
        <div className="mt-2 pl-6"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#7a3b2e]">{issue.guide.name} · {copy("guideCalendar")}</div><DateStrip availability={issue.guide.availability} dates={issue.requestedDates} lang={lang} /></div>
        {issue.replacementOptions.length > 0 ? <div className="mt-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#7a3b2e]">{copy("substitute")} · {specLabel(lang, issue.guide.specialisation)} · {langName(trip.language)}</div>
          {issue.replacementOptions.slice(0, 3).map((option, index) => <button key={option.guide.id} disabled={loading} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: option.guide.id, days })} className={`flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left disabled:opacity-50 ${index === 0 ? "border-[#0b1f3a] bg-white" : "border-[#e6ebf2] bg-white/70"}`}>
            <span className="min-w-0"><span className="block text-sm font-semibold">{copy("use")} {option.guide.name}</span><span className="block text-xs text-[#5f6b7a]">{tr(option.guide.city)}{option.distanceKm ? ` · ${option.distanceKm} km` : ""} · ★ {option.guide.rating} · {option.guide.languages.map(langName).join(", ")}</span><DateStrip availability={option.guide.availability} dates={issue.requestedDates} lang={lang} /></span>
            <span className="shrink-0 text-right text-xs"><span className="block font-semibold">{signed(option.priceDelta)} <span className="font-normal text-[#5f6b7a]">{copy("vs")} {issue.guide.name}</span></span><span className="block text-[#5f6b7a]">{copy("total")} {money(issue.currentTotal)} → <strong className="text-[#0b1f3a]">{money(option.newTotal)}</strong></span></span>
          </button>)}
        </div> : <div className="mt-2 pl-6 text-xs text-[#7a3b2e]">{copy("noGuides")}</div>}
      </div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {specialisations.length > 1 && [null, ...specialisations].map(spec => <button key={spec ?? "all"} onClick={() => setSpecFilter(spec)} className={`rounded-full px-2.5 py-1 text-[11px] ${specFilter === spec ? "bg-[#0b1f3a] text-[#ffffff]" : "bg-[#eef2f7]"}`}>{spec ? specLabel(lang, spec) : copy("allSpecs")}</button>)}
        <label className="ml-auto flex items-center gap-2 text-xs">{copy("days")} <Input type="number" min={1} max={trip.durationDays} value={days} onChange={event => setGuideDays(Number(event.target.value))} className="h-8 w-16" /></label>
      </div>
      <div className="mt-2 space-y-2">
        {visibleGuides.length === 0 && guides.isFetched && <div className="rounded-md border border-dashed border-[#e6ebf2] p-3 text-xs text-[#5f6b7a]">{copy("noGuides")} ({langName(trip.language)})</div>}
        {visibleGuides.map(guide => <button key={guide.id} disabled={loading || trip.chosenGuide?.id === guide.id} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: guide.id, days })} className="flex w-full items-center justify-between gap-3 rounded-md border border-[#e6ebf2] bg-white/70 p-3 text-left transition hover:border-[#0b6bcb] disabled:opacity-50">
          <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium">{guide.name}{guide.matchesPackage && <Badge variant="outline" className="border-[#0b6bcb]/40 text-[9px] text-[#0b6bcb]">{tr(pkg.theme)}</Badge>}{guide.certified && <Badge variant="outline" className="text-[9px]">{copy("certified")}</Badge>}</span>
            <span className="block text-xs text-[#5f6b7a]">{specLabel(lang, guide.specialisation)} · {guide.languages.map(langName).join(", ")} · ★ {guide.rating} · {guide.yearsExperience}y</span>
            <span className={`block text-[11px] ${guide.isAvailableForTrip ? "text-[#0b6bcb]" : "text-[#ad4738]"}`}>{guide.isAvailableForTrip ? copy("availableAllDates") : `${copy("blockedDates")} ${guide.unavailableDates.join(", ")}`}</span><DateStrip availability={guide.availability} dates={guide.requestedDates} lang={lang} /></span>
          <span className="shrink-0 text-right"><span className="block font-extrabold text-lg">{money(guide.tripCost)}</span><span className="block text-[11px] text-[#5f6b7a]">{money(guide.dayRate)}/{copy("day").toLowerCase()}</span></span>
        </button>)}
      </div>
    </div>

    <Button className="w-full bg-[#0b1f3a] text-[#ffffff] hover:bg-[#13325e]" disabled={loading} onClick={onContinue}>{copy("continueReview")}</Button>
  </div>;
}

/** Live price breakdown for the side rail. */
/** Trip dates as chips: green ✓ when the guide is available, red ✕ when not — makes the availability rule visible at a glance. */
function DateStrip({ availability, dates, lang }: { availability: Record<string, boolean>; dates: string[]; lang: Lang }) {
  const locale = lang === "en-IN" ? "en-IN" : `${lang}-IN`;
  return <span className="mt-1.5 flex flex-wrap gap-1">{dates.map(date => {
    const ok = availability[date] === true;
    const when = new Date(`${date}T00:00:00Z`);
    return <span key={date} className={`inline-flex min-w-[46px] flex-col items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ring-1 ${ok ? "bg-[#e7f8f0] text-[#0e8a5f] ring-[#b7ebd3]" : "bg-[#fdecea] text-[#c0392b] ring-[#f3c1b8]"}`}>
      <span className="font-medium opacity-80">{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(when)}</span>
      <span>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(when)} {ok ? "✓" : "✕"}</span>
    </span>;
  })}</span>;
}

export function PriceBreakdown({ trip, lang }: { trip: TripView; lang: Lang }) {
  const copy = (key: CopyKey) => t(lang, key);
  const b = trip.priceBreakdown;
  const pct = Math.min(100, (trip.runningTotal / Math.max(1, trip.budgetCap)) * 100);
  const line = (label: string, value: number, isSigned = false) => <div className="flex justify-between py-1 text-xs text-[#5f6b7a]"><span>{label}</span><span className="text-[#0b1f3a]">{isSigned ? signed(value) : money(value)}</span></div>;
  return <div>
    <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">{copy("liveBudget")}</div>
    <div className="mt-3 font-extrabold text-3xl">{money(trip.runningTotal)} <span className="text-sm text-[#5f6b7a]">{copy("of")} {money(trip.budgetCap)}</span></div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eef2f7]"><div className="h-full rounded-full bg-[#0b6bcb] transition-all" style={{ width: `${pct}%` }} /></div>
    <div className="mt-2 flex justify-between text-xs text-[#5f6b7a]"><span>{trip.remaining >= 0 ? `${money(trip.remaining)} ${copy("remaining")}` : `${money(Math.abs(trip.remaining))} ${copy("over")}`}</span><span>{Math.round(pct)}%</span></div>
    {trip.package && <div className="mt-4 border-t border-[#e6ebf2] pt-3">
      <div className="mb-1 text-[10px] uppercase tracking-[.16em] text-[#5f6b7a]">{copy("breakdown")}</div>
      {b.party.pax > 1 && <div className="flex justify-between py-1 text-xs text-[#5f6b7a]"><span>👥 {b.party.pax} {copy("travelers").toLowerCase()}</span><span>{b.party.rooms} {copy("roomsLabel")}</span></div>}
      {line(`${copy("transport")}${b.party.pax > 1 ? ` × ${b.party.pax}` : ""}`, b.transport)}
      {line(`${copy("packageBase")} (${trip.durationDays}/${trip.package.duration} ${copy("days").toLowerCase()})${b.party.pax > 1 ? ` × ${b.party.pax}` : ""}`, b.packageBase)}
      {b.swapAdjustments !== 0 && line(copy("swaps"), b.swapAdjustments, true)}
      {b.addOns !== 0 && line(copy("addOnsLine"), b.addOns)}
      {b.guide !== 0 && line(copy("guide"), b.guide)}
      <div className="mt-1 flex justify-between border-t border-[#e6ebf2] pt-2 text-sm font-semibold"><span>{copy("total")}</span><span>{money(b.total)}</span></div>
    </div>}
  </div>;
}
