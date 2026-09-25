import { type ReactNode, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeftRight, ArrowRight, BedDouble, CalendarMinus, CalendarPlus, Car, Check, Minus, Plus, RotateCcw, Sparkles, Star, Ticket, Undo2, UtensilsCrossed, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { type CopyKey, type Lang, LANGS, t } from "@/i18n";
import type { AppRouter } from "../../../backend/src/routers";
import { useTr } from "@/lib/translate";
import { slotLabel } from "./TripScreens";
import { GuidePlanner } from "./GuidePlanner";

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
  const refresh = { onSuccess: () => { setOpenSwap(null); utils.trip.get.invalidate(); utils.trip.guides.invalidate(); }, onError: (error: { message: string }) => toast.error(error.message) };
  const swap = trpc.trip.swap.useMutation(refresh);
  const toggleAddOn = trpc.trip.toggleAddOn.useMutation(refresh);
  const setDuration = trpc.trip.setDuration.useMutation(refresh);
  const removeGuide = trpc.trip.removeGuide.useMutation(refresh);
  const applySuggestion = trpc.trip.applySuggestion.useMutation(refresh);
  const undo = trpc.trip.undo.useMutation({ ...refresh, onSuccess: () => { refresh.onSuccess(); toast.success(copy("undone")); } });
  const discard = trpc.trip.discardChanges.useMutation({ ...refresh, onSuccess: () => { refresh.onSuccess(); toast.success(copy("changesDiscarded")); } });
  const loading = busy || swap.isPending || toggleAddOn.isPending || setDuration.isPending || removeGuide.isPending || applySuggestion.isPending || undo.isPending || discard.isPending;
  const suggestions = trip.suggestions ?? [];
  const overCap = trip.runningTotal > trip.budgetCap;
  const SUGGESTION_ICON: Record<string, ReactNode> = {
    auto: <Wand2 className="h-4 w-4" />, flight: <ArrowRight className="h-4 w-4" />, hotel: <BedDouble className="h-4 w-4" />, experience: <Sparkles className="h-4 w-4" />,
    transfer: <Car className="h-4 w-4" />, meal: <UtensilsCrossed className="h-4 w-4" />, entry_ticket: <Ticket className="h-4 w-4" />, guide: <X className="h-4 w-4" />,
  };
  const icon = (kind: string, direction: string) => kind === "addon" ? (direction === "upgrade" ? <Plus className="h-4 w-4" /> : <X className="h-4 w-4" />) : kind === "days" ? (direction === "upgrade" ? <CalendarPlus className="h-4 w-4" /> : <CalendarMinus className="h-4 w-4" />) : SUGGESTION_ICON[kind];
  const changeText = (item: { kind: string; from?: string; to?: string }) => item.kind === "days" ? `${item.from} → ${item.to} ${copy("days").toLowerCase()}` : item.from && item.to ? `${tr(item.from)} → ${tr(item.to)}` : tr(item.to ?? item.from ?? "");
  const pkg = trip.package!;
  const alternativesFor = (componentId: string) => {
    const current = pkg.components.find(item => item.id === componentId);
    return current?.swapGroup ? pkg.components.filter(item => item.swapGroup === current.swapGroup && item.id !== componentId) : [];
  };
  const addOns = trip.packageComponents.filter(item => item.optional);
  // Unit prices scale with the party: per room for hotels (2 per room), per vehicle for transfers (4 each), per person otherwise; guides per group.
  const party = trip.priceBreakdown.party;
  const unitsOf = (type?: string) => (type === "hotel" ? party.rooms : type === "transfer" ? party.vehicles : type === "guide" ? 1 : party.pax);
  // What a component adds to the total: units × (hotel) the share of the package's nights stayed — same as the server.
  const factorOf = (type?: string) => unitsOf(type) * (type === "hotel" ? trip.priceBreakdown.nightsFactor : 1);
  const stars = (detail?: string) => Number(detail?.match(/(\d)★/)?.[1] || 0);

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
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" disabled={loading || !trip.canUndo} onClick={() => undo.mutate({ tripId: trip.tripId })}><Undo2 className="mr-1 h-3.5 w-3.5" />{copy("undo")}</Button>
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs text-[#ad4738]" disabled={loading || !trip.canUndo} onClick={() => { if (window.confirm(copy("discardConfirm"))) discard.mutate({ tripId: trip.tripId }); }}><RotateCcw className="mr-1 h-3.5 w-3.5" />{copy("discardChanges")}</Button>
          </div>
        </div>
      </div>
    </div>

    {/* Recommendations: over budget, the best ways back in; within budget, upgrades that still fit. One tap applies (Undo reverts). */}
    {suggestions.length > 0 && <div className={`rounded-xl border p-4 ${overCap ? "border-[#f3c1b8] bg-[#fff6f4]" : "border-[#dcd0fb] bg-[#f7f3ff]"}`}>
      <div className="flex items-center gap-2 text-sm font-extrabold text-[#0b1f3a]"><Sparkles className="h-4 w-4 text-[#7c3aed]" />{copy("recoTitle")}</div>
      <p className="mt-0.5 text-xs text-[#5f6b7a]">{copy(overCap ? "recoSubOver" : "recoSubUnder")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {suggestions.map(item => {
          const delta = item.newTotal - trip.runningTotal;
          return <div key={item.id} className="flex flex-col rounded-lg border border-white bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,.06)]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-bold"><span className={`grid h-7 w-7 place-items-center rounded-lg ${item.kind === "auto" ? "bg-[#7c3aed] text-white" : item.direction === "save" ? "bg-[#e7f8f0] text-[#0e8a5f]" : "bg-[#efe8ff] text-[#6d28d9]"}`}>{icon(item.kind, item.direction)}</span>{copy(`${item.direction === "save" ? "fix" : "up"}_${item.kind}` as CopyKey)}</span>
              {item.fits && <span className="flex items-center gap-0.5 rounded-full bg-[#e7f8f0] px-2 py-0.5 text-[10px] font-bold text-[#0e8a5f]"><Check className="h-3 w-3" />{copy("fitsBudget")}</span>}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[#5f6b7a]">{item.kind === "auto" ? (item.steps ?? []).map((step, index) => <div key={index}>{changeText(step)}</div>) : changeText(item)}</div>
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#eef2f7] pt-2 text-xs">
              <span><b className={delta > 0 ? "text-[#6d28d9]" : "text-[#0e8a5f]"}>{signed(delta)}</b> <span className="text-[#5f6b7a]">→ {money(item.newTotal)}</span></span>
              <Button size="sm" disabled={loading} onClick={() => applySuggestion.mutate({ tripId: trip.tripId, suggestionId: item.id })} className="h-7 rounded-full bg-[#0b1f3a] px-3 text-xs text-white">{copy("applyReco")}</Button>
            </div>
          </div>;
        })}
      </div>
    </div>}

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
                    {item.price != null && <span className="text-sm">{item.price < 0 ? signed(item.price) : money(item.price)}{unitsOf(item.kind) > 1 && <span className="ml-1 text-[10px] text-[#5f6b7a]">×{unitsOf(item.kind)}</span>}</span>}
                    {swappable.length > 0 && current && (() => {
                      const bestSaving = Math.max(0, ...swappable.map(option => (current.price - option.price) * factorOf(option.type)));
                      return <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${openSwap === key ? "bg-[#e8f1fd] text-[#0b6bcb]" : "text-[#0b6bcb]"}`} onClick={() => setOpenSwap(openSwap === key ? null : key)}><ArrowLeftRight className="mr-1 h-3 w-3" />{copy("swap")}{bestSaving > 0 && <span className="ml-1 rounded bg-[#e7f8f0] px-1 text-[10px] font-bold text-[#0e8a5f]">−{money(bestSaving)}</span>}</Button>;
                    })()}
                    {item.kind === "guide" && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#ad4738]" disabled={loading} onClick={() => removeGuide.mutate({ tripId: trip.tripId, guideId: item.guideId })}><X className="mr-1 h-3 w-3" />{copy("remove")}</Button>}
                  </div>
                </div>
                {openSwap === key && current && (() => {
                  // Current choice + alternatives, cheapest first, each priced on the whole trip against the budget.
                  const options = [current, ...swappable].sort((a, b) => a.price - b.price);
                  const cheapestId = options[0]?.id;
                  const topRated = item.kind === "hotel" ? [...options].sort((a, b) => stars(b.detail) - stars(a.detail))[0] : undefined;
                  return <div className="mt-3 grid gap-2 rounded-lg bg-[#f6f8fb] p-2 sm:grid-cols-2">
                    {options.map(option => {
                      const isCurrent = option.id === current.id;
                      const delta = (option.price - current.price) * factorOf(option.type);
                      const newTotal = trip.runningTotal + delta;
                      const fits = newTotal <= trip.budgetCap;
                      return <button key={option.id} disabled={loading || isCurrent} onClick={() => swap.mutate({ tripId: trip.tripId, fromId: current.id, toId: option.id })} className={`flex flex-col rounded-lg border p-3 text-left text-sm transition ${isCurrent ? "border-[#0b6bcb] bg-[#e8f1fd]/60" : "border-[#e6ebf2] bg-white hover:-translate-y-0.5 hover:border-[#0b6bcb] hover:shadow-sm"} disabled:cursor-default`}>
                        <div className="flex flex-wrap items-center gap-1">
                          {isCurrent && <span className="rounded bg-[#0b6bcb] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{copy("swapCurrent")}</span>}
                          {option.id === cheapestId && !isCurrent && <span className="rounded bg-[#e7f8f0] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0e8a5f]">{copy("swapCheapest")}</span>}
                          {topRated && option.id === topRated.id && stars(option.detail) > 0 && <span className="flex items-center gap-0.5 rounded bg-[#fff4e0] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#b45309]"><Star className="h-2.5 w-2.5" />{copy("swapTopRated")}</span>}
                        </div>
                        <span className="mt-1 font-semibold">{tr(option.label)}</span>
                        <span className="text-xs text-[#5f6b7a]">{tr(option.detail)}</span>
                        <span className="mt-2 flex items-end justify-between gap-2 border-t border-[#eef2f7] pt-2 text-xs">
                          <span>{option.price < 0 ? signed(option.price * factorOf(option.type)) : money(option.price * factorOf(option.type))}{!isCurrent && <span className={`ml-1 font-bold ${delta > 0 ? "text-[#ad4738]" : "text-[#0e8a5f]"}`}>{signed(delta)}</span>}</span>
                          {!isCurrent && <span className="text-right text-[#5f6b7a]">{copy("total")} <b className="text-[#0b1f3a]">{money(newTotal)}</b> <span className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-bold ${fits ? "bg-[#e7f8f0] text-[#0e8a5f]" : "bg-[#fff4e0] text-[#b45309]"}`}>{fits ? <><Check className="h-2.5 w-2.5" />{copy("fitsBudget")}</> : <>+{money(newTotal - trip.budgetCap)} {copy("overBudgetBy")}</>}</span></span>}
                        </span>
                      </button>;
                    })}
                  </div>;
                })()}
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

    {/* Guide: live availability grid — whole trip or day by day */}
    <GuidePlanner trip={trip} lang={lang} busy={loading} />

    <Button className="w-full bg-[#0b1f3a] text-[#ffffff] hover:bg-[#13325e]" disabled={loading} onClick={onContinue}>{copy("continueReview")}</Button>
  </div>;
}

/** Live price breakdown for the side rail. */
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
      {b.components !== 0 && line(copy("componentsLine"), b.components)}
      {b.addOns !== 0 && line(copy("addOnsLine"), b.addOns)}
      {b.guide !== 0 && line(copy("guide"), b.guide)}
      <div className="mt-1 flex justify-between border-t border-[#e6ebf2] pt-2 text-sm font-semibold"><span>{copy("total")}</span><span>{money(b.total)}</span></div>
    </div>}
  </div>;
}
