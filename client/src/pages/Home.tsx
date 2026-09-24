import { useMemo, useState } from "react";
import { Check, ChevronRight, CircleAlert, Heart, Languages, MapPin, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const STEPS = [
  { key: "intake", label: "Trip" },
  { key: "reality", label: "Reality check" },
  { key: "select_flight", label: "Flight" },
  { key: "select_hotel", label: "Hotel" },
  { key: "select_package", label: "Package" },
  { key: "select_guide", label: "Guide" },
  { key: "review", label: "Confirm" },
];
const DESTINATIONS = [
  { code: "BLR", city: "Thanjavur", label: "Thanjavur / Chola trail" },
  { code: "JAI", city: "Jaipur", label: "Jaipur" },
  { code: "GOI", city: "Goa", label: "Goa" },
  { code: "VNS", city: "Varanasi", label: "Varanasi" },
];

type FormState = { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests: string };

export default function Home() {
  const [form, setForm] = useState<FormState>({ origin: "DEL", destination: "BLR", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 50000, language: "ta", interests: "heritage, local food, living culture" });
  const [screen, setScreen] = useState("intake");
  const [tripId, setTripId] = useState<string | null>(null);
  const [openSwap, setOpenSwap] = useState<string | null>(null);
  const [newCap, setNewCap] = useState("");
  const [guideDays, setGuideDays] = useState(3);
  const utils = trpc.useUtils();

  const tripQuery = trpc.trip.get.useQuery({ tripId: tripId || "" }, { enabled: Boolean(tripId) });
  const trip = tripQuery.data;
  const duration = Math.max(1, Math.round((Date.parse(`${form.returnDate}T00:00:00Z`) - Date.parse(`${form.departDate}T00:00:00Z`)) / 86400000));
  const reality = trpc.packagepro.reality.useQuery({ destination: DESTINATIONS.find(item => item.code === form.destination)?.city || form.destination, budget: form.budgetCap, duration }, { enabled: screen === "reality" });
  const guides = trpc.trip.guides.useQuery({ tripId: tripId || "" }, { enabled: trip?.status === "select_guide" });
  const alternatives = trpc.packagepro.alternatives.useQuery({ packageId: trip?.package?.id || "", componentId: openSwap || "none" }, { enabled: Boolean(openSwap && trip?.package?.id) });

  const createTrip = trpc.trip.create.useMutation({ onSuccess: data => { setTripId(data.tripId); setScreen("trip"); toast.success("Trip started"); } });
  const selectFlight = trpc.trip.selectFlight.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const selectHotel = trpc.trip.selectHotel.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const swap = trpc.trip.swap.useMutation({ onSuccess: () => { setOpenSwap(null); utils.trip.get.invalidate(); } });
  const continuePackage = trpc.trip.continuePackage.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const selectGuide = trpc.trip.selectGuide.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const skipGuide = trpc.trip.skipGuide.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const negotiate = trpc.trip.negotiate.useMutation({ onSuccess: () => { setNewCap(""); utils.trip.get.invalidate(); } });
  const confirm = trpc.trip.confirm.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const loading = createTrip.isPending || selectFlight.isPending || selectHotel.isPending || swap.isPending || continuePackage.isPending || selectGuide.isPending || skipGuide.isPending || negotiate.isPending || confirm.isPending;

  const currentStep = screen === "trip" ? (trip?.status === "confirmed" ? "review" : trip?.status === "negotiate" ? "review" : trip?.status || "select_flight") : screen;
  const stepIndex = STEPS.findIndex(step => step.key === currentStep);
  const pct = trip ? Math.min(100, (trip.runningTotal / trip.budgetCap) * 100) : 0;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(current => ({ ...current, [key]: value })); }
  function startOver() { setTripId(null); setScreen("intake"); setOpenSwap(null); }

  return (
    <div className="min-h-screen bg-[#f7f5ef] text-[#17231f]">
      <header className="mx-auto max-w-[1240px] px-5 pb-4 pt-7 lg:px-10">
        <div className="flex items-center justify-between border-b border-[#d8d7cd] pb-5">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#17231f] font-serif text-lg text-[#f7f5ef]">P<span className="text-[#ecd8b4]">+</span></div><div><div className="font-serif text-xl font-semibold tracking-tight">PackagePro</div><div className="text-[10px] uppercase tracking-[.18em] text-[#68736c]">dynamic tour packages</div></div></div>
          <div className="flex items-center gap-3">{trip && <div className="hidden items-center gap-2 rounded-full bg-[#e1efea] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#286c62] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#286c62]" /> live plan</div>}<select value={form.language} onChange={event => setField("language", event.target.value)} className="rounded-md border border-[#d8d7cd] bg-transparent px-3 py-2 text-xs"><option value="en-IN">English</option><option value="ta">தமிழ்</option><option value="hi">हिन्दी</option><option value="te">తెలుగు</option></select></div>
        </div>
        <div className="mt-5 overflow-x-auto"><div className="flex min-w-[680px] items-center justify-between">{STEPS.map((step, index) => <div key={step.key} className="flex flex-1 items-center"><div className="flex flex-col items-center gap-2"><div className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${index < stepIndex ? "bg-[#286c62] text-white" : index === stepIndex ? "bg-[#b6762a] text-white" : "border border-[#d8d7cd] text-[#9ba19b]"}`}>{index < stepIndex ? "✓" : String(index + 1).padStart(2, "0")}</div><span className={`whitespace-nowrap text-[10px] uppercase tracking-wider ${index === stepIndex ? "font-semibold text-[#17231f]" : "text-[#9ba19b]"}`}>{step.label}</span></div>{index < STEPS.length - 1 && <div className={`mb-5 h-px flex-1 ${index < stepIndex ? "bg-[#286c62]" : "bg-[#d8d7cd]"}`} />}</div>)}</div></div>
      </header>

      <main className="mx-auto grid max-w-[1240px] gap-8 px-5 pb-24 pt-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-10">
        <section className="min-w-0">
          {screen === "intake" && <div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#286c62]">PACKAGEPRO / SMART ROUTES</div><h1 className="mt-3 max-w-3xl font-serif text-5xl font-medium leading-[.95] tracking-[-.05em] md:text-7xl">Plan the trip you actually want to take.</h1><p className="mt-5 max-w-xl text-[#68736c]">Start with dates and a budget. Then choose a flight, hotel, package, and optional guide — one honest step at a time.</p><Card className="mt-8 border-[#d8d7cd] bg-white/70 shadow-none"><CardContent className="p-6"><div className="mb-5 flex justify-between text-[10px] uppercase tracking-[.16em] text-[#68736c]"><span>01 / trip brief</span><span className="text-[#286c62]">free to adjust</span></div><form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); setScreen("reality"); }}><Field label="From" hint="airport code"><Input value={form.origin} maxLength={3} onChange={event => setField("origin", event.target.value.toUpperCase())} required /></Field><Field label="To" hint="destination"><select value={form.destination} onChange={event => setField("destination", event.target.value)} className="w-full rounded-md border border-[#d8d7cd] bg-[#fbfaf6] px-3 py-2">{DESTINATIONS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field><Field label="Depart"><Input type="date" value={form.departDate} onChange={event => setField("departDate", event.target.value)} required /></Field><Field label="Return"><Input type="date" value={form.returnDate} onChange={event => setField("returnDate", event.target.value)} required /></Field><Field label="Travelers"><Input type="number" min={1} max={20} value={form.travelers} onChange={event => setField("travelers", Number(event.target.value))} required /></Field><Field label="Language"><select value={form.language} onChange={event => setField("language", event.target.value)} className="w-full rounded-md border border-[#d8d7cd] bg-[#fbfaf6] px-3 py-2"><option value="en-IN">English</option><option value="ta">தமிழ்</option><option value="hi">हिन्दी</option><option value="te">తెలుగు</option></select></Field><div className="sm:col-span-2"><Field label="What should this trip feel like?" hint="used for grounded recommendations"><Textarea value={form.interests} onChange={event => setField("interests", event.target.value)} className="min-h-20 bg-[#fbfaf6]" /></Field></div><div className="sm:col-span-2"><Field label="Budget cap (₹, total for the trip)" hint="inclusive, for the whole trip"><Input type="number" min={1000} step={500} value={form.budgetCap} onChange={event => setField("budgetCap", Number(event.target.value))} required /></Field></div><div className="sm:col-span-2"><Button type="submit" className="w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]">Check my budget <ChevronRight className="ml-1 h-4 w-4" /></Button></div></form></CardContent></Card></div>}

          {screen === "reality" && <Card className="border-[#d8d7cd] bg-white/70 shadow-none"><CardContent className="p-6"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">Reality check</div><h2 className="mt-3 font-serif text-3xl">Is {money(form.budgetCap)} realistic here?</h2>{reality.data && <div className="mt-6"><Badge className={`${reality.data.verdict === "comfortable" ? "bg-[#e1efea] text-[#286c62]" : reality.data.verdict === "tight" ? "bg-[#fbf3e4] text-[#b6762a]" : "bg-[#f5e3df] text-[#ad4738]"}`}>{reality.data.verdict}</Badge><p className="mt-4 text-sm text-[#68736c]">Typical range for {reality.data.destination}: {money(reality.data.typical)}. Closest real package: {reality.data.closestPackage}.</p></div>}<div className="mt-8 flex gap-3"><Button variant="outline" onClick={() => setScreen("intake")}>← Adjust</Button><Button className="bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={createTrip.isPending} onClick={() => createTrip.mutate({ ...form, destination: form.destination })}>{createTrip.isPending ? "Starting…" : "Continue with this budget →"}</Button></div></CardContent></Card>}

          {trip && trip.status === "negotiate" && <Card className="border-[#ad4738] bg-[#f5e3df] shadow-none"><CardContent className="p-6"><h2 className="font-serif text-2xl text-[#ad4738]">This would go over budget</h2><p className="mt-2 text-sm text-[#68736c]">Nothing has been added. Pick how you'd like to handle it.</p><div className="mt-5 space-y-2">{trip.negotiationOptions.map(option => <div key={option.choice}>{option.choice !== "raise_cap" ? <Button variant="outline" disabled={loading} className="w-full justify-start bg-white/70" onClick={() => negotiate.mutate({ tripId: trip.tripId, choice: option.choice as "approve_overage" | "swap_cheaper" | "remove_item" })}>{option.label}</Button> : <div className="flex gap-2"><Input type="number" placeholder="New total budget (₹)" value={newCap} onChange={event => setNewCap(event.target.value)} /><Button disabled={loading || !newCap} className="bg-[#17231f] text-[#f7f5ef]" onClick={() => negotiate.mutate({ tripId: trip.tripId, choice: "raise_cap", newCap: Number(newCap) })}>Set</Button></div>}</div>)}</div></CardContent></Card>}

          {trip && trip.status === "select_flight" && <Stage title="Choose a flight" subtitle="Sorted cheapest first.">{[...trip.flightOptions].sort((a, b) => a.price - b.price).map(flight => <Choice key={flight.id} disabled={loading} onClick={() => selectFlight.mutate({ tripId: trip.tripId, flightId: flight.id })} title={`${flight.airline} · ${flight.id}`} detail={`${flight.route} · ${flight.depart} · ${flight.duration}`} amount={flight.price} meta={`${Math.round(flight.confidence * 100)}% confidence`} />)}</Stage>}

          {trip && trip.status === "select_hotel" && <Stage title="Choose a hotel" subtitle="Total for your whole stay.">{trip.hotelOptions.map(hotel => <Choice key={hotel.id} disabled={loading} onClick={() => selectHotel.mutate({ tripId: trip.tripId, hotelId: hotel.id })} title={hotel.name} detail={`★ ${hotel.rating} · ${hotel.detail}`} amount={hotel.total} />)}</Stage>}

          {trip && trip.status === "select_package" && trip.package && <Stage title="Your package" subtitle="Swap anything with a swap tag — the total updates live and re-checks your budget." extra={<div className="mb-4 rounded-md bg-[#e1efea] px-3 py-2 text-sm text-[#286c62]">{trip.package.name} · {trip.package.city}</div>}>{trip.packageComponents.map(component => <div key={component.id} className="rounded-md border border-[#d8d7cd] bg-white/60 p-4"><div className="flex items-center justify-between gap-4"><div><div className="font-medium">{component.label}</div><div className="mt-1 text-xs text-[#68736c]">{component.detail}</div></div><div className="flex items-center gap-3"><span className="text-sm">{money(component.price)}</span>{component.swapGroup && <Button variant="ghost" className="text-xs text-[#286c62]" onClick={() => setOpenSwap(openSwap === component.id ? null : component.id)}>swap</Button>}</div></div>{openSwap === component.id && <div className="mt-3 border-t border-[#d8d7cd] pt-3">{alternatives.data?.map(option => <button key={option.id} className="flex w-full items-center justify-between rounded px-1 py-2 text-left text-sm hover:bg-[#f7f5ef]" onClick={() => swap.mutate({ tripId: trip.tripId, fromId: component.id, toId: option.id })}><span>{option.label}</span><span>{money(option.price)}</span></button>)}</div>}</div>)}<Button className="mt-5 w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={loading} onClick={() => continuePackage.mutate({ tripId: trip.tripId })}>Continue to guide →</Button></Stage>}

          {trip && trip.status === "select_guide" && <Stage title="Add a local guide?" subtitle="Matched by language and specialisation. Optional." extra={trip.guideAvailabilityIssue && <div className="mb-4 rounded-md border border-[#ad4738] bg-[#f5e3df] p-4"><div className="flex items-start gap-2 font-semibold text-[#ad4738]"><CircleAlert className="mt-0.5 h-4 w-4" /> {trip.guideAvailabilityIssue.guide.name} is unavailable on {trip.guideAvailabilityIssue.conflictingDates.join(", ")}.</div>{trip.guideAvailabilityIssue.replacement && <Button className="mt-3 bg-white text-[#17231f] hover:bg-[#f7f5ef]" disabled={loading} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: trip.guideAvailabilityIssue!.replacement!.id, days: guideDays })}>Use {trip.guideAvailabilityIssue.replacement.name} · {money(trip.guideAvailabilityIssue.replacementTotalCost || 0)} ({trip.guideAvailabilityIssue.priceDelta && trip.guideAvailabilityIssue.priceDelta > 0 ? "+" : ""}{money(trip.guideAvailabilityIssue.priceDelta || 0)})</Button>}</div>}><label className="mb-4 flex items-center gap-3 text-sm">Days: <Input type="number" min={1} max={trip.durationDays} value={guideDays} onChange={event => setGuideDays(Number(event.target.value))} className="w-20" /></label>{guides.data?.map(guide => <Choice key={guide.id} disabled={loading} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: guide.id, days: guideDays })} title={guide.name} detail={`${guide.specialisation} · speaks ${guide.languages.join(", ")}`} amount={guide.dayRate} meta={`★ ${guide.rating}`} />)}<Button variant="ghost" className="mt-4" disabled={loading} onClick={() => skipGuide.mutate({ tripId: trip.tripId })}>Skip guide, continue →</Button></Stage>}

          {trip && (trip.status === "review" || trip.status === "confirmed") && <Card className="border-[#d8d7cd] bg-white/70 shadow-none"><CardContent className="p-6">{trip.status === "confirmed" ? <><div className="font-semibold text-[#286c62]">✓ Confirmed</div><h2 className="mt-2 font-serif text-3xl">Trip locked in</h2><p className="mt-2 text-sm text-[#68736c]">Final total {money(trip.runningTotal)} of your {money(trip.budgetCap)} cap — never crossed.</p></> : <><h2 className="font-serif text-3xl">Review & confirm</h2><p className="mt-2 text-sm text-[#68736c]">Nothing is booked until you confirm.</p></>}<div className="mt-6 space-y-3 text-sm"><Row label="Flight" value={trip.chosenFlight ? `${trip.chosenFlight.airline} ${trip.chosenFlight.id}` : "—"} amount={trip.chosenFlight?.price} /><Row label="Hotel" value={trip.chosenHotel?.name || "—"} amount={trip.chosenHotel?.total} /><Row label="Guide" value={trip.chosenGuide ? `${trip.chosenGuide.name} (${trip.chosenGuide.daysBooked}d)` : "Not booked"} amount={trip.chosenGuide?.totalCost} /></div>{trip.status !== "confirmed" && <Button className="mt-6 w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={loading} onClick={() => confirm.mutate({ tripId: trip.tripId })}>Confirm trip →</Button>}{trip.status === "confirmed" && <Button variant="ghost" className="mt-6" onClick={startOver}>Plan another trip</Button>}</CardContent></Card>}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {trip ? <><Card className="border-[#d8d7cd] border-t-[3px] border-t-[#286c62] bg-white/70 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">LIVE BUDGET</div><div className="mt-3 font-serif text-3xl">{money(trip.runningTotal)} <span className="text-sm text-[#68736c]">of {money(trip.budgetCap)}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ece9df]"><div className="h-full rounded-full bg-[#286c62]" style={{ width: `${pct}%` }} /></div><div className="mt-2 flex justify-between text-xs text-[#68736c]"><span>{trip.remaining >= 0 ? `${money(trip.remaining)} remaining` : `${money(Math.abs(trip.remaining))} over`}</span><span>{Math.round(pct)}%</span></div></CardContent></Card><Card className="border-[#d8d7cd] bg-white/50 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">TRIP BRIEF</div><RailRow label="Dates" value={`${form.departDate}\n${form.returnDate}`} /><RailRow label="Party" value={`${trip.travelers} traveller${trip.travelers === 1 ? "" : "s"}`} /><RailRow label="Language" value={trip.language} /><RailRow label="Package pieces" value={String(trip.packageComponents.length || "—")} /></CardContent></Card><div className="flex items-start gap-2 text-xs text-[#68736c]"><Sparkles className="mt-0.5 h-4 w-4 text-[#b6762a]" />Every price is checked against your cap as you customise. No silent overages.</div></> : <><Card className="border-[#d8d7cd] border-t-[3px] border-t-[#17231f] bg-white/50 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">THE PACKAGEPRO PROMISE</div><h3 className="mt-3 font-serif text-2xl">Real data. Flexible choices. Clear trade-offs.</h3><p className="mt-3 text-sm text-[#68736c]">Choose a curated route, then make it yours. Hotels, activities, transfers and local guides can all change before you commit.</p></CardContent></Card><RailStep n="01" title="Build" detail="Tell us where and when" /><RailStep n="02" title="Shape" detail="Swap the details that matter" /><RailStep n="03" title="Confirm" detail="See the honest final total" /></>}
        </aside>
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold"><span className="mb-2 flex justify-between"><span>{label}</span>{hint && <small className="font-normal text-[#68736c]">{hint}</small>}</span>{children}</label>;
}
function Stage({ title, subtitle, extra, children }: { title: string; subtitle: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return <Card className="border-[#d8d7cd] bg-white/70 shadow-none"><CardContent className="p-6"><h2 className="font-serif text-3xl">{title}</h2><p className="mt-2 text-sm text-[#68736c]">{subtitle}</p><div className="mt-6">{extra}<div className="space-y-3">{children}</div></div></CardContent></Card>;
}
function Choice({ title, detail, amount, meta, onClick, disabled }: { title: string; detail: string; amount: number; meta?: string; onClick: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between rounded-md border border-[#d8d7cd] bg-white/70 p-4 text-left hover:border-[#286c62] disabled:opacity-50"><div><div className="font-medium">{title}</div><div className="mt-1 text-xs text-[#68736c]">{detail}</div></div><div className="text-right"><div className="font-serif text-lg">{money(amount)}</div>{meta && <div className="text-[11px] text-[#68736c]">{meta}</div>}</div></button>;
}
function Row({ label, value, amount }: { label: string; value: string; amount?: number }) {
  return <div className="flex items-start justify-between border-b border-[#d8d7cd] py-2"><div><div className="text-[11px] uppercase tracking-wider text-[#68736c]">{label}</div><div>{value}</div></div>{amount != null && <span>{money(amount)}</span>}</div>;
}
function RailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-[#d8d7cd] py-3 text-xs text-[#68736c]"><span>{label}</span><strong className="whitespace-pre-line text-right text-[#17231f]">{value}</strong></div>;
}
function RailStep({ n, title, detail }: { n: string; title: string; detail: string }) {
  return <div className="flex items-center gap-3 border-b border-[#d8d7cd] py-3"><span className="font-serif text-2xl text-[#b6762a]">{n}</span><div><div className="text-sm font-semibold">{title}</div><div className="text-xs text-[#68736c]">{detail}</div></div></div>;
}
