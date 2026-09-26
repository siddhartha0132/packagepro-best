import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowRight, BedDouble, Check, CircleAlert, Clock, Compass, Globe, Hourglass, KeyRound, Loader2, LogOut, MessageCircle, Minus, Plus, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ItineraryDays } from "@/components/Itinerary";
import { PriceBreakdown } from "@/components/PackageCustomiser";
import { Panel, money } from "@/components/TripScreens";
import { trpc } from "@/lib/trpc";
import { packageTitle } from "@/lib/itinerary";
import type { AppRouter } from "../../../backend/src/routers";

// The travel desk: every booking request from the website and Telegram, oldest first. The agent reads the full plan and
// approves, rejects with a reason, or sends a counter-offer (swap a line, add/remove an add-on, a discount or surcharge, a
// note) priced live on the whole trip. The traveller answers on the web page or in Telegram. Opens with AGENT_DASHBOARD_KEY.

type Desk = inferRouterOutputs<AppRouter>["agent"];
type Summary = Desk["list"]["waiting"][number];
type Detail = Desk["get"];
type CounterInput = { swaps: { fromId: string; toId: string }[]; addOns: { componentId: string; include: boolean }[]; adjustment?: number; note?: string };

const KEY = "packagepro.agentKey";
const NAME = "packagepro.agentName";
const read = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
const write = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private mode */ } };
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
function ago(iso?: string | null) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
}

function StatusChip({ item }: { item: Summary }) {
  const counter = item.counter?.status;
  const [tone, text] = item.status === "awaiting_approval"
    ? counter === "open" ? ["bg-[#efe8ff] text-[#6d28d9]", "Counter-offer sent"] : counter === "declined" ? ["bg-[#fff4e0] text-[#b45309]", "Counter declined"] : ["bg-[#fff4e0] text-[#b45309]", "Waiting"]
    : item.decision === "approved" ? ["bg-[#e7f8f0] text-[#0e8a5f]", counter === "accepted" ? "Booked (counter)" : "Approved"]
      : item.decision === "rejected" ? ["bg-[#fdecea] text-[#c0392b]", "Rejected"] : ["bg-[#eef2f7] text-[#334155]", item.status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{text}</span>;
}

function RequestCard({ item, active, onOpen }: { item: Summary; active: boolean; onOpen: () => void }) {
  const over = item.total > item.budget;
  return <button onClick={onOpen} className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-[#0b6bcb] bg-[#f5f9ff] shadow-sm" : "border-[#e6ebf2] bg-white hover:border-[#9fc3ee]"}`}>
    <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-bold text-[#0b1f3a]">{item.reference ?? item.tripId}</span><StatusChip item={item} /></div>
    <div className="mt-1 text-sm font-bold text-[#0b1f3a]">{item.origin} → {item.destination}</div>
    <div className="text-xs text-[#5f6b7a]">{shortDate(item.departDate)} → {shortDate(item.returnDate)} · {item.travelers} pax · {item.channel === "web" ? "Website" : "Telegram"}</div>
    <div className="mt-2 flex items-end justify-between gap-2"><span className="text-[11px] text-[#5f6b7a]">{item.traveller ?? "Traveller"} · {ago(item.requestedAt)}{item.attempt > 1 ? ` · request #${item.attempt}` : ""}</span><span className={`text-sm font-black ${over ? "text-[#b45309]" : "text-[#0b1f3a]"}`}>{money(item.total)}</span></div>
  </button>;
}

function SignIn({ onSignIn, failed }: { onSignIn: (key: string, name: string) => void; failed: boolean }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState(read(NAME));
  return <div className="grid min-h-screen place-items-center bg-[#f2f5f9] px-4">
    <Panel className="w-full max-w-sm p-6">
      <div className="flex items-center gap-2 text-lg font-extrabold text-[#0b1f3a]"><KeyRound className="h-5 w-5 text-[#0b6bcb]" />Travel desk</div>
      <p className="mt-1 text-xs leading-5 text-[#5f6b7a]">Approve, reject or counter booking requests from the website and Telegram.</p>
      <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (key.trim()) onSignIn(key.trim(), name.trim()); }}>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Your name (shown to travellers)" className="h-11 w-full rounded-xl border border-[#e6ebf2] px-3 text-sm" />
        <input value={key} onChange={event => setKey(event.target.value)} type="password" placeholder="Desk key" autoComplete="current-password" className="h-11 w-full rounded-xl border border-[#e6ebf2] px-3 text-sm" />
        {failed && <p className="text-xs font-semibold text-[#c0392b]">That key didn't work.</p>}
        <Button type="submit" className="h-11 w-full rounded-full bg-[#0b1f3a] font-bold text-white">Open the desk</Button>
      </form>
    </Panel>
  </div>;
}

/** Build a counter-offer: swap any swappable line, toggle add-ons, discount or surcharge, a note — priced live before sending. */
function CounterBuilder({ detail, agentName, onSent }: { detail: Detail; agentName: string; onSent: () => void }) {
  const choices = detail.choices!;
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [addOns, setAddOns] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState(true);
  const [note, setNote] = useState("");
  const counter: CounterInput = useMemo(() => ({
    swaps: Object.entries(swaps).filter(([, toId]) => toId).map(([fromId, toId]) => ({ fromId, toId })),
    addOns: choices.addOns.filter(item => addOns[item.componentId] !== undefined && addOns[item.componentId] !== item.included).map(item => ({ componentId: item.componentId, include: addOns[item.componentId] })),
    adjustment: Number(amount) > 0 ? (discount ? -1 : 1) * Number(amount) : undefined,
    note: note.trim() || undefined,
  }), [swaps, addOns, amount, discount, note, choices.addOns]);
  const deferred = useDeferredValue(counter);
  const hasChanges = deferred.swaps.length + deferred.addOns.length > 0 || Boolean(deferred.adjustment);
  const preview = trpc.agent.preview.useQuery({ tripId: detail.trip.tripId, counter: { ...deferred, note: undefined } }, { enabled: hasChanges, retry: false });
  const utils = trpc.useUtils();
  const send = trpc.agent.counter.useMutation({
    onSuccess: () => { toast.success("Counter-offer sent to the traveller"); setSwaps({}); setAddOns({}); setAmount(""); setNote(""); void utils.agent.invalidate(); onSent(); },
    onError: error => toast.error(error.message),
  });
  return <div className="rounded-xl border border-[#d7c9ff] bg-[#fbf9ff] p-4">
    <div className="flex items-center gap-2 text-sm font-extrabold text-[#6d28d9]"><Sparkles className="h-4 w-4" />Counter-offer</div>
    <p className="mt-0.5 text-xs text-[#5f6b7a]">Change the plan and price; the traveller accepts (booked at once) or keeps the original request.</p>
    {choices.swaps.length > 0 && <div className="mt-3 space-y-2">{choices.swaps.map(line => <label key={line.componentId} className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#5f6b7a]">{line.type === "hotel" ? "Stay" : `Day ${line.dayIndex} · ${line.type.replace("_", " ")}`}</span>
      <select value={swaps[line.componentId] ?? ""} onChange={event => setSwaps(current => ({ ...current, [line.componentId]: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[#e6ebf2] bg-white px-2 text-sm">
        <option value="">Keep: {line.label}</option>
        {line.options.map(option => <option key={option.id} value={option.id}>{option.label} ({signed(option.delta)})</option>)}
      </select>
    </label>)}</div>}
    {choices.addOns.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{choices.addOns.map(item => {
      const on = addOns[item.componentId] ?? item.included;
      return <button key={item.componentId} type="button" onClick={() => setAddOns(current => ({ ...current, [item.componentId]: !on }))} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? "border-[#7c3aed] bg-[#f3edff] text-[#6d28d9]" : "border-[#e6ebf2] bg-white text-[#0b1f3a]"}`}>{on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{item.label} <span className="font-bold">{on === item.included ? (on ? "" : `+${money(item.delta)}`) : signed(item.delta)}</span></button>;
    })}</div>}
    <div className="mt-3 flex gap-2">
      <div className="flex overflow-hidden rounded-lg border border-[#e6ebf2] bg-white text-xs font-bold">
        <button type="button" onClick={() => setDiscount(true)} className={`flex items-center gap-1 px-3 ${discount ? "bg-[#e7f8f0] text-[#0e8a5f]" : "text-[#5f6b7a]"}`}><Minus className="h-3 w-3" />Discount</button>
        <button type="button" onClick={() => setDiscount(false)} className={`flex items-center gap-1 px-3 ${!discount ? "bg-[#fff4e0] text-[#b45309]" : "text-[#5f6b7a]"}`}><Plus className="h-3 w-3" />Surcharge</button>
      </div>
      <input value={amount} onChange={event => setAmount(event.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="₹ amount" className="h-10 min-w-0 flex-1 rounded-lg border border-[#e6ebf2] bg-white px-3 text-sm" />
    </div>
    <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={2} placeholder="Note to the traveller, e.g. “The homestay is full on the 29th — the Kothi is similar and I've taken ₹2,000 off.”" className="mt-2 w-full rounded-lg border border-[#e6ebf2] bg-white px-3 py-2 text-sm" />
    {hasChanges && <div className="mt-2 rounded-lg bg-white p-3 text-sm">
      {preview.isLoading ? <div className="flex items-center gap-2 text-xs text-[#5f6b7a]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Pricing…</div>
        : preview.error ? <div className="text-xs font-semibold text-[#c0392b]">{preview.error.message}</div>
          : preview.data && <>
            <ul className="space-y-1">{preview.data.changes.map((change, index) => <li key={index} className="flex justify-between gap-3 text-xs"><span className="text-[#334155]">{change.kind === "swap" ? <>{change.from} <ArrowRight className="inline h-3 w-3" /> <b>{change.to}</b></> : change.kind === "addon_on" ? <>Add <b>{change.to}</b></> : change.kind === "addon_off" ? <>Remove <b>{change.to}</b></> : <b>{change.delta < 0 ? "Discount" : "Surcharge"}</b>}</span><span className={`font-bold ${change.delta > 0 ? "text-[#ad4738]" : "text-[#0e8a5f]"}`}>{signed(change.delta)}</span></li>)}</ul>
            <div className="mt-2 flex items-end justify-between border-t border-[#eef2f7] pt-2"><span className="text-xs text-[#5f6b7a]">{money(preview.data.oldTotal)} →</span><span className="text-xl font-black text-[#0b1f3a]">{money(preview.data.newTotal)}</span></div>
          </>}
    </div>}
    <Button disabled={!hasChanges || !preview.data || send.isPending} onClick={() => send.mutate({ tripId: detail.trip.tripId, counter, agentName: agentName || undefined })} className="mt-3 h-10 w-full rounded-full bg-[#6d28d9] font-bold text-white hover:bg-[#5b21b6]"><Send className="mr-1.5 h-4 w-4" />Send counter-offer</Button>
  </div>;
}

function Decide({ detail, agentName, reasons }: { detail: Detail; agentName: string; reasons: string[] }) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const done = (text: string) => ({ onSuccess: () => { toast.success(text); void utils.agent.invalidate(); }, onError: (error: { message: string }) => toast.error(error.message) });
  const approve = trpc.agent.approve.useMutation(done("Approved — the traveller gets the bill"));
  const reject = trpc.agent.reject.useMutation(done("Rejected — the traveller has been told why"));
  const busy = approve.isPending || reject.isPending;
  const finalReason = reason === "other" ? custom.trim() : reason;
  return <div className="space-y-3">
    <Button disabled={busy} onClick={() => approve.mutate({ tripId: detail.trip.tripId, agentName: agentName || undefined })} className="h-12 w-full rounded-full bg-gradient-to-r from-[#34c38f] to-[#0e8a5f] text-sm font-extrabold uppercase tracking-wider text-white shadow-md"><Check className="mr-1.5 h-4 w-4" />Approve as requested · {money(detail.trip.runningTotal)}</Button>
    <div className="rounded-xl border border-[#f3c1b8] bg-[#fffafa] p-3">
      <select value={reason} onChange={event => setReason(event.target.value)} className="h-10 w-full rounded-lg border border-[#e6ebf2] bg-white px-2 text-sm">
        <option value="">Reject — choose a reason…</option>
        {reasons.map(item => <option key={item} value={item}>{item}</option>)}
        <option value="other">Other (write it)</option>
      </select>
      {reason === "other" && <input value={custom} onChange={event => setCustom(event.target.value)} maxLength={300} placeholder="Reason the traveller will see" className="mt-2 h-10 w-full rounded-lg border border-[#e6ebf2] bg-white px-3 text-sm" />}
      <Button disabled={busy || finalReason.length < 3} onClick={() => reject.mutate({ tripId: detail.trip.tripId, reason: finalReason, agentName: agentName || undefined })} variant="outline" className="mt-2 h-10 w-full rounded-full border-[#f3c1b8] text-[#c0392b]"><X className="mr-1 h-4 w-4" />Reject</Button>
    </div>
    {detail.choices && <CounterBuilder key={detail.trip.approval?.counter?.id ?? "new"} detail={detail} agentName={agentName} onSent={() => undefined} />}
  </div>;
}

function RequestDetail({ tripId, agentName, reasons }: { tripId: string; agentName: string; reasons: string[] }) {
  const detail = trpc.agent.get.useQuery({ tripId }, { refetchInterval: 5000 });
  if (detail.isLoading) return <Panel className="grid place-items-center p-16"><Loader2 className="h-6 w-6 animate-spin text-[#0b6bcb]" /></Panel>;
  if (!detail.data) return <Panel className="p-6 text-sm text-[#c0392b]">{detail.error?.message ?? "Not found"}</Panel>;
  const { trip, summary } = detail.data;
  const counter = trip.approval?.counter;
  const guides = [trip.chosenGuide, ...(trip.extraGuides ?? [])].filter((guide): guide is NonNullable<typeof guide> => Boolean(guide));
  const waiting = trip.status === "awaiting_approval";
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="min-w-0 space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><span className="font-mono text-sm font-black text-[#0b1f3a]">{summary.reference ?? trip.tripId}</span><StatusChip item={summary} /></div>
            <h2 className="mt-1 text-xl font-extrabold text-[#0b1f3a]">{trip.origin} → {trip.destination} <span className="text-sm font-semibold text-[#5f6b7a]">· {packageTitle(trip.package?.name ?? "")}</span></h2>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#5f6b7a]">
              <span>{shortDate(trip.departDate)} → {shortDate(trip.returnDate)} · {trip.durationDays} nights</span>
              <span>{trip.travelers} travellers · {trip.priceBreakdown.party.rooms} rooms</span>
              <span className="flex items-center gap-1">{trip.channel === "web" ? <Globe className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}{summary.traveller ?? "Traveller"} · {trip.channel === "web" ? "website" : "Telegram"} · guide language {trip.language}</span>
              {trip.approval?.contact?.email && <span>{trip.approval.contact.email}</span>}{trip.approval?.contact?.phone && <span>{trip.approval.contact.phone}</span>}
            </div>
          </div>
          <div className="text-right"><div className="text-2xl font-black text-[#0b1f3a]">{money(trip.runningTotal)}</div><div className={`text-xs font-bold ${trip.runningTotal > trip.budgetCap ? "text-[#b45309]" : "text-[#0e8a5f]"}`}>budget {money(trip.budgetCap)}</div><div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#5f6b7a]"><Clock className="h-3 w-3" />requested {ago(trip.approval?.requestedAt)}</div></div>
        </div>
        {counter && <div className={`mt-4 rounded-lg px-3 py-2 text-xs ${counter.status === "open" ? "bg-[#f3edff] text-[#5b21b6]" : counter.status === "declined" ? "bg-[#fff4e0] text-[#7a4a0b]" : "bg-[#eef2f7] text-[#334155]"}`}>
          <b>Counter-offer {counter.status === "open" ? "waiting for the traveller" : counter.status}</b> · {money(counter.oldTotal)} → {money(counter.newTotal)} · {counter.changes.length} change{counter.changes.length > 1 ? "s" : ""}{counter.note ? ` · “${counter.note}”` : ""}
        </div>}
        {!waiting && <div className={`mt-4 rounded-lg px-3 py-2 text-xs ${trip.approval?.decision === "approved" ? "bg-[#e7f8f0] text-[#0e8a5f]" : "bg-[#fdecea] text-[#c0392b]"}`}><b>{trip.approval?.decision === "approved" ? "Approved" : trip.approval?.decision === "rejected" ? "Rejected" : trip.status}</b>{trip.approval?.decidedBy ? ` by ${trip.approval.decidedBy}` : ""}{trip.approval?.reason ? ` — ${trip.approval.reason}` : ""}</div>}
      </Panel>
      {guides.length > 0 && <Panel className="p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-[#0b1f3a]"><Compass className="h-4 w-4 text-[#0b6bcb]" />Guides {waiting ? "— dates held until you decide" : ""}</div>
        <div className="mt-2 space-y-1.5">{guides.map(guide => <div key={guide.id} className="flex justify-between gap-3 text-sm"><span>{guide.name} <span className="text-xs text-[#5f6b7a]">★{guide.rating} · {guide.specialisation} · {guide.languages.join(", ")} · {guide.bookedDates.map(shortDate).join(", ")}</span></span><b>{money(guide.totalCost)}</b></div>)}</div>
      </Panel>}
      <Panel className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#0b1f3a]"><BedDouble className="h-4 w-4 text-[#0b6bcb]" />Day by day</div>
        <ItineraryDays trip={trip} lang="en-IN" />
      </Panel>
    </div>
    <div className="space-y-4">
      <Panel className="p-5"><PriceBreakdown trip={trip} lang="en-IN" /></Panel>
      {waiting ? <Decide detail={detail.data} agentName={agentName} reasons={reasons} /> : <Panel className="p-4 text-xs text-[#5f6b7a]">This request is closed. A new request from the traveller will appear under Waiting.</Panel>}
    </div>
  </div>;
}

export default function AgentDesk() {
  const [key, setKey] = useState(read(KEY));
  const [agentName, setAgentName] = useState(read(NAME));
  const [tab, setTab] = useState<"waiting" | "decided">("waiting");
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("trip"));
  const mode = trpc.agent.mode.useQuery();
  const list = trpc.agent.list.useQuery(undefined, { enabled: Boolean(key), refetchInterval: 5000, retry: false });
  const unauthorised = list.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => { document.title = "PackagePro · Travel desk"; }, []);
  // Open the oldest waiting request when nothing is selected.
  useEffect(() => { if (!selected && list.data?.waiting[0]) setSelected(list.data.waiting[0].tripId); }, [selected, list.data]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("trip", selected); else url.searchParams.delete("trip");
    window.history.replaceState(null, "", url);
  }, [selected]);

  if (mode.data && !mode.data.dashboard) return <div className="grid min-h-screen place-items-center bg-[#f2f5f9] px-4"><Panel className="max-w-md p-6 text-sm text-[#334155]"><div className="flex items-center gap-2 font-extrabold text-[#0b1f3a]"><CircleAlert className="h-4 w-4 text-[#b45309]" />The travel desk is off</div><p className="mt-2 leading-6">Set <code className="rounded bg-[#eef2f7] px-1">AGENT_DASHBOARD_KEY</code> on the server to turn it on. Bookings then go to a travel agent for approval, on the website and in Telegram.</p></Panel></div>;
  if (!key || unauthorised) return <SignIn failed={unauthorised} onSignIn={(nextKey, name) => { write(KEY, nextKey); write(NAME, name); setAgentName(name); setKey(nextKey); setTimeout(() => void list.refetch(), 0); }} />;

  const items = (tab === "waiting" ? list.data?.waiting : list.data?.decided) ?? [];
  return <div className="min-h-screen bg-[#f2f5f9] text-[#0b1f3a]">
    <header className="sticky top-0 z-10 border-b border-[#e6ebf2] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b6bcb] text-sm font-black text-white">P</span><div><div className="text-sm font-extrabold">PackagePro · Travel desk</div><div className="text-[11px] text-[#5f6b7a]">{list.data ? `${list.data.waiting.length} waiting` : "Loading…"}</div></div></div>
        <div className="flex items-center gap-2 text-xs"><span className="hidden text-[#5f6b7a] sm:inline">{agentName || "Travel agent"}</span><Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => { write(KEY, ""); setKey(""); }}><LogOut className="mr-1 h-3.5 w-3.5" />Sign out</Button></div>
      </div>
    </header>
    <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 md:px-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 text-xs font-bold shadow-sm">
          {(["waiting", "decided"] as const).map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full py-2 ${tab === name ? "bg-[#0b1f3a] text-white" : "text-[#5f6b7a]"}`}>{name === "waiting" ? <><Hourglass className="mr-1 inline h-3 w-3" />Waiting ({list.data?.waiting.length ?? 0})</> : "Decided"}</button>)}
        </div>
        {list.isLoading && <div className="grid place-items-center p-8"><Loader2 className="h-5 w-5 animate-spin text-[#0b6bcb]" /></div>}
        {!list.isLoading && !items.length && <Panel className="p-5 text-center text-xs leading-5 text-[#5f6b7a]">{tab === "waiting" ? "No requests waiting. New ones from the website and Telegram appear here by themselves." : "No decisions yet."}</Panel>}
        <div className="space-y-2">{items.map(item => <RequestCard key={item.tripId} item={item} active={item.tripId === selected} onOpen={() => setSelected(item.tripId)} />)}</div>
      </aside>
      <section className="min-w-0">{selected ? <RequestDetail key={selected} tripId={selected} agentName={agentName} reasons={mode.data?.reasons ?? []} /> : <Panel className="p-10 text-center text-sm text-[#5f6b7a]">Pick a request on the left.</Panel>}</section>
    </main>
  </div>;
}
