import { useState } from "react";
import { CalendarDays, Check, CircleAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { type CopyKey, type Lang, LANGS, t } from "@/i18n";
import { useTr } from "@/lib/translate";
import type { TripView } from "./PackageCustomiser";
import { specLabel } from "./TripScreens";

// Guide planner: a live availability grid (guides × trip dates). Book one guide for the whole trip — checked on every date,
// refused with the clashing date named and a same-language substitute offered — or build a plan day by day, e.g. the one
// day a favourite guide is free, with another guide on the other days.

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const langName = (tag: string) => LANGS.find(item => item.value === tag)?.native ?? tag;
const initials = (name: string) => name.split(" ").map(part => part[0]).join("").slice(0, 2);
const AVATAR = ["from-[#53b2fe] to-[#065af3]", "from-[#f9a8d4] to-[#db2777]", "from-[#7dd3a8] to-[#16a37a]", "from-[#fbbf24] to-[#d97706]", "from-[#a5b4fc] to-[#6366f1]"];

function dateParts(iso: string, lang: Lang) {
  const locale = lang === "en-IN" ? "en-IN" : `${lang}-IN`;
  const when = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(when),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(when),
  };
}

export function GuidePlanner({ trip, lang, busy }: { trip: TripView; lang: Lang; busy: boolean }) {
  const copy = (key: CopyKey) => t(lang, key);
  const tr = useTr(lang);
  const utils = trpc.useUtils();
  const [specFilter, setSpecFilter] = useState<string | null>(null);
  const refresh = { onSuccess: () => { utils.trip.get.invalidate(); utils.trip.guides.invalidate(); }, onError: (error: { message: string }) => toast.error(error.message) };
  const selectGuide = trpc.trip.selectGuide.useMutation(refresh);
  const bookDays = trpc.trip.bookGuideDays.useMutation(refresh);
  const removeGuide = trpc.trip.removeGuide.useMutation(refresh);
  const guides = trpc.trip.guides.useQuery({ tripId: trip.tripId });
  const loading = busy || selectGuide.isPending || bookDays.isPending || removeGuide.isPending;

  const dates = trip.guidePlan.map(day => day.date);
  const assignedTo = new Map(trip.guidePlan.filter(day => day.guideId).map(day => [day.date, day.guideId!]));
  const onPlan = new Set(trip.guidePlan.map(day => day.guideId).filter(Boolean));
  const colour = new Map((guides.data ?? []).map((guide, index) => [guide.id, AVATAR[index % AVATAR.length]]));
  const specialisations = Array.from(new Set((guides.data ?? []).map(guide => guide.specialisation)));
  const visible = (guides.data ?? []).filter(guide => !specFilter || guide.specialisation === specFilter);
  const issue = trip.guideAvailabilityIssue;
  const issueFreeDays = issue ? issue.requestedDates.filter(date => issue.guide.availability[date] === true) : [];
  const wholeTripRequest = issue ? issue.requestedDates.length === trip.durationDays : false;

  const bookWhole = (guideId: string) => selectGuide.mutate({ tripId: trip.tripId, guideId, days: trip.durationDays });
  const bookOn = (guideId: string, onDates: string[]) => bookDays.mutate({ tripId: trip.tripId, guideId, dates: onDates });

  return <div className="rounded-2xl border border-[#dbe6f5] bg-gradient-to-b from-[#f5f9ff] to-white p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]"><CalendarDays className="h-3.5 w-3.5" />{copy("addGuide")}</div>
        <h3 className="mt-1 text-lg font-black text-[#0b1f3a]">{copy("guidePlanTitle")}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#5f6b7a]">{copy("guidePlanSub")}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-bold">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f8f0] px-2 py-1 text-[#0e8a5f] ring-1 ring-[#b7ebd3]"><Check className="h-3 w-3" />{copy("legendFree")}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#fdecea] px-2 py-1 text-[#c0392b] ring-1 ring-[#f3c1b8]"><X className="h-3 w-3" />{copy("legendBusy")}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#0b6bcb] px-2 py-1 text-white"><Check className="h-3 w-3" />{copy("legendBooked")}</span>
      </div>
    </div>

    {/* Your guide plan: one card per trip date */}
    <div className="mt-4 rounded-xl bg-[#0b1f3a] p-3 text-white">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.16em] text-white/70"><span>{copy("guidePlanLabel")}</span><span>{copy("guideTotal")}: <span className="text-sm text-white">{money(trip.priceBreakdown.guide)}</span></span></div>
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(dates.length, 7)}, minmax(0, 1fr))` }}>
        {trip.guidePlan.map(day => {
          const parts = dateParts(day.date, lang);
          return <div key={day.date} className={`rounded-lg p-2 ${day.guideId ? "bg-white/12 ring-1 ring-white/25" : "border border-dashed border-white/25"}`}>
            <div className="text-[10px] font-semibold text-white/60">{parts.weekday} · {parts.day}</div>
            {day.guideId ? <>
              <div className="mt-1 flex items-center gap-1.5"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br text-[9px] font-black ${colour.get(day.guideId) ?? AVATAR[0]}`}>{initials(day.guideName ?? "")}</span><span className="truncate text-xs font-bold">{day.guideName}</span></div>
              <div className="text-[10px] text-white/70">{money(day.cost)}</div>
            </> : <div className="mt-1 text-xs text-white/50">{copy("noGuideDay")}</div>}
          </div>;
        })}
      </div>
      {onPlan.size > 0 && <div className="mt-2 flex flex-wrap gap-2">{Array.from(onPlan).map(id => {
        const name = trip.guidePlan.find(day => day.guideId === id)?.guideName;
        return <button key={id} disabled={loading} onClick={() => removeGuide.mutate({ tripId: trip.tripId, guideId: id! })} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-semibold ring-1 ring-white/20 hover:bg-white/20 disabled:opacity-50"><X className="h-3 w-3" /><span className="text-[11px]">{copy("remove")} {name}</span></button>;
      })}</div>}
    </div>

    {/* Refusal: the mandatory rule — named dates, same-language substitutes, repriced; plus "only the free days" */}
    {issue && <div className="mt-4 rounded-xl border border-[#f3c1b8] bg-[#fff6f4] p-4">
      <div className="flex items-start gap-2 text-sm font-bold text-[#b42318]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{copy("guideRefused")}: {issue.guide.name} {copy("unavailable")} {issue.conflictingDates.map(date => dateParts(date, lang).day).join(", ")}</span></div>
      <div className="mt-1 pl-6 text-xs text-[#7a3b2e]">{copy("strictAvailability")}: {issue.requestedDates.map(date => dateParts(date, lang).day).join(", ")}</div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {issue.replacementOptions.slice(0, 2).map(option => <button key={option.guide.id} disabled={loading} onClick={() => wholeTripRequest ? bookWhole(option.guide.id) : bookOn(option.guide.id, issue.requestedDates)} className="rounded-xl border border-[#0b1f3a]/15 bg-white p-3 text-left shadow-sm transition hover:border-[#0b6bcb] disabled:opacity-50">
          <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#0e8a5f]">{copy("substitute")} · {specLabel(lang, issue.guide.specialisation)} · {langName(trip.language)}</div>
          <div className="mt-1 text-sm font-extrabold text-[#0b1f3a]">{copy("use")} {option.guide.name} <span className="font-normal text-[#5f6b7a]">★ {option.guide.rating}</span></div>
          <div className="mt-1 text-xs text-[#5f6b7a]">{signed(option.priceDelta)} {copy("vs")} {issue.guide.name} · {copy("total")} {money(issue.currentTotal)} → <strong className="text-[#0b1f3a]">{money(option.newTotal)}</strong></div>
        </button>)}
        {issueFreeDays.length > 0 && issueFreeDays.length < issue.requestedDates.length && <button disabled={loading} onClick={() => bookOn(issue.guide.id, issueFreeDays)} className="rounded-xl border border-dashed border-[#0b6bcb] bg-[#eef6ff] p-3 text-left transition hover:bg-[#e2efff] disabled:opacity-50">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.14em] text-[#0b6bcb]"><Sparkles className="h-3 w-3" />{copy("bookOnlyFree")}</div>
          <div className="mt-1 text-sm font-extrabold text-[#0b1f3a]">{issue.guide.name} · {issueFreeDays.map(date => dateParts(date, lang).day).join(", ")}</div>
          <div className="mt-1 text-xs text-[#5f6b7a]">{copy("noGuideDay")}: {issue.conflictingDates.map(date => dateParts(date, lang).day).join(", ")} — {copy("tapToAddHint")}</div>
        </button>}
      </div>
      {issue.replacementOptions.length === 0 && issueFreeDays.length === 0 && <div className="mt-2 pl-6 text-xs text-[#7a3b2e]">{copy("noGuides")}</div>}
    </div>}

    {/* Filters */}
    {specialisations.length > 1 && <div className="mt-4 flex flex-wrap gap-2">{[null, ...specialisations].map(spec => <button key={spec ?? "all"} onClick={() => setSpecFilter(spec)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${specFilter === spec ? "bg-[#0b1f3a] text-white shadow" : "bg-white text-[#0b1f3a] ring-1 ring-[#e6ebf2] hover:ring-[#0b6bcb]"}`}>{spec ? specLabel(lang, spec) : copy("allSpecs")}</button>)}</div>}

    {/* Planner grid: guides × dates */}
    <div className="mt-3 overflow-x-auto rounded-xl border border-[#e6ebf2] bg-white">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead><tr className="border-b border-[#e6ebf2] bg-[#f8fafc]">
          <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#5f6b7a]">{copy("guide")}</th>
          {dates.map(date => { const parts = dateParts(date, lang); return <th key={date} className="px-1.5 py-2 text-center text-[10px] font-bold uppercase text-[#5f6b7a]">{parts.weekday}<div className="text-xs normal-case text-[#0b1f3a]">{parts.day}</div></th>; })}
          <th className="px-3 py-2" />
        </tr></thead>
        <tbody>
          {visible.length === 0 && guides.isFetched && <tr><td colSpan={dates.length + 2} className="p-4 text-center text-xs text-[#5f6b7a]">{copy("noGuides")} ({langName(trip.language)})</td></tr>}
          {visible.map(guide => {
            const freeDays = dates.filter(date => guide.availability[date] === true);
            const freeCost = freeDays.reduce((sum, date) => sum + (guide.dayCosts[date] ?? 0), 0);
            const mine = onPlan.has(guide.id);
            return <tr key={guide.id} className={`border-b border-[#f0f3f7] last:border-0 ${mine ? "bg-[#f3f8ff]" : ""}`}>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-black text-white ${colour.get(guide.id)}`}>{initials(guide.name)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-extrabold text-[#0b1f3a]">{guide.name}{guide.certified && <span className="rounded-full border border-[#0b1f3a]/20 px-1.5 text-[9px] font-bold">{copy("certified")}</span>}{guide.matchesPackage && <span className="rounded-full bg-[#eef6ff] px-1.5 text-[9px] font-bold text-[#0b6bcb]">{tr(trip.package?.theme ?? "")}</span>}</div>
                    <div className="text-[11px] text-[#5f6b7a]">{specLabel(lang, guide.specialisation)} · {guide.languages.map(langName).join(", ")} · ★ {guide.rating} · {guide.yearsExperience}y</div>
                  </div>
                </div>
              </td>
              {dates.map(date => {
                const free = guide.availability[date] === true;
                const booked = assignedTo.get(date) === guide.id;
                const cost = guide.dayCosts[date] ?? 0;
                if (booked) return <td key={date} className="px-1.5 py-2"><div className="rounded-lg bg-[#0b6bcb] px-1 py-1.5 text-center text-white shadow-sm"><div className="flex items-center justify-center gap-0.5 text-[11px] font-extrabold"><Check className="h-3 w-3" />{copy("bookedTag")}</div><div className="text-[10px] opacity-85">{money(cost)}</div></div></td>;
                if (!free) return <td key={date} className="px-1.5 py-2"><div className="rounded-lg bg-[repeating-linear-gradient(135deg,#fdecea_0,#fdecea_6px,#fbdcd8_6px,#fbdcd8_12px)] px-1 py-1.5 text-center text-[#c0392b] ring-1 ring-[#f3c1b8]"><div className="flex items-center justify-center gap-0.5 text-[11px] font-extrabold"><X className="h-3 w-3" />{copy("busyTag")}</div><div className="text-[10px] line-through opacity-70">{money(cost)}</div></div></td>;
                return <td key={date} className="px-1.5 py-2"><button disabled={loading} onClick={() => bookOn(guide.id, [date])} className="w-full rounded-lg bg-[#e7f8f0] px-1 py-1.5 text-center text-[#0e8a5f] ring-1 ring-[#b7ebd3] transition hover:bg-[#d3f3e4] hover:ring-[#0e8a5f] disabled:opacity-50"><div className="text-[11px] font-extrabold">+ {copy("addDay")}</div><div className="text-[10px]">{money(cost)}</div></button></td>;
              })}
              <td className="px-3 py-2">
                <div className="flex min-w-[132px] flex-col gap-1.5">
                  <button disabled={loading} onClick={() => bookWhole(guide.id)} className="rounded-lg bg-[#0b1f3a] px-2.5 py-1.5 text-left font-bold text-white hover:bg-[#13325e] disabled:opacity-50"><span className="text-[11px]">{copy("wholeTrip")} · {money(guide.tripCost)}</span></button>
                  {freeDays.length > 0 && freeDays.length < dates.length && <button disabled={loading} onClick={() => bookOn(guide.id, freeDays)} className="rounded-lg border border-[#0e8a5f]/40 px-2.5 py-1.5 text-left font-bold text-[#0e8a5f] hover:bg-[#e7f8f0] disabled:opacity-50"><span className="text-[11px]">{copy("freeDaysOnly")} ({freeDays.length}) · {money(freeCost)}</span></button>}
                  {mine && <button disabled={loading} onClick={() => removeGuide.mutate({ tripId: trip.tripId, guideId: guide.id })} className="rounded-lg px-2.5 py-1 text-left font-semibold text-[#c0392b] hover:bg-[#fdecea] disabled:opacity-50"><span className="text-[11px]">✕ {copy("remove")}</span></button>}
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}
