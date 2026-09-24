import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Languages, MapPin, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { LANGS, type CopyKey, type Lang, t } from "@/i18n";
import AgentTransparencyChat from "@/components/AgentTransparencyChat";

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const heroImage = "/manus-storage/travel-hero_878cc2d0.jpg";
function isoDateFromToday(offset: number) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
const STAGES = ["intake", "reality", "select_flight", "select_hotel", "select_package", "select_guide", "review"] as const;
const stageLabel: Record<string, CopyKey> = { intake: "stepTrip", reality: "stepReality", select_flight: "stepFlight", select_hotel: "stepHotel", select_package: "stepPackage", select_guide: "stepGuide", review: "stepConfirm" };

type FormState = { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: Lang; interests: string };

export default function Home() {
  const [form, setForm] = useState<FormState>({ origin: "", destination: "", departDate: isoDateFromToday(7), returnDate: isoDateFromToday(10), travelers: 1, budgetCap: 0, language: "en-IN", interests: "" });
  const [screen, setScreen] = useState<"intake" | "reality" | "trip">("intake");
  const [tripId, setTripId] = useState<string | null>(null);
  const [openSwap, setOpenSwap] = useState<string | null>(null);
  const [newCap, setNewCap] = useState("");
  const [guideDays, setGuideDays] = useState(3);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const utils = trpc.useUtils();
  const copy = (key: CopyKey) => t(form.language, key);
  useEffect(() => {
    const saved = localStorage.getItem("packagepro-draft");
    if (saved) { try { const draft = JSON.parse(saved); if (draft.form) setForm(draft.form); if (draft.screen) setScreen(draft.screen); if (draft.tripId) setTripId(draft.tripId); } catch { /* ignore a malformed local draft */ } }
    const encoded = window.location.hash.startsWith("#plan=") ? window.location.hash.slice(6) : "";
    if (encoded) { try { const shared = JSON.parse(decodeURIComponent(encoded)); if (shared.origin) setForm(current => ({ ...current, ...shared })); toast.success(t("en-IN", "sharedLoaded")); } catch { /* ignore a malformed shared plan */ } }
  }, []);

  const cities = trpc.packagepro.cities.useQuery();
  const packages = trpc.packagepro.list.useQuery({});
  useEffect(() => {
    if (defaultsReady || !cities.data?.origins.length || !cities.data?.destinations.length || !packages.data?.length) return;
    setForm(current => ({ ...current, origin: current.origin || cities.data!.origins[0].code, destination: current.destination || cities.data!.destinations[0].code, budgetCap: current.budgetCap || packages.data![0].basePrice + 20000, interests: current.interests || "heritage, local food, living culture" }));
    setDefaultsReady(true);
  }, [cities.data, packages.data, defaultsReady]);
  const tripQuery = trpc.trip.get.useQuery({ tripId: tripId || "" }, { enabled: Boolean(tripId) });
  const trip = tripQuery.data;
  const duration = Math.max(1, Math.round((Date.parse(`${form.returnDate}T00:00:00Z`) - Date.parse(`${form.departDate}T00:00:00Z`)) / 86400000));
  const destinationCity = cities.data?.destinations.find(item => item.code === form.destination)?.city || "Thanjavur";
  const recommendations = trpc.packagepro.recommend.useQuery({ query: form.interests, language: form.language, destination: destinationCity, budget: form.budgetCap || undefined });
  const reality = trpc.packagepro.reality.useQuery({ destination: destinationCity, budget: form.budgetCap, duration }, { enabled: screen === "reality" });
  const guides = trpc.trip.guides.useQuery({ tripId: tripId || "" }, { enabled: trip?.status === "select_guide" });
  const alternatives = trpc.packagepro.alternatives.useQuery({ packageId: trip?.package?.id || "", componentId: openSwap || "none" }, { enabled: Boolean(openSwap && trip?.package?.id) });

  const createTrip = trpc.trip.create.useMutation({ onSuccess: data => { setTripId(data.tripId); setScreen("trip"); toast.success(copy("started")); }, onError: error => toast.error(error.message) });
  const autoBuild = trpc.trip.autoBuild.useMutation({ onSuccess: data => { setTripId(data.tripId); setScreen("trip"); toast.success(copy("packageReady")); }, onError: error => toast.error(error.message) });
  const selectFlight = trpc.trip.selectFlight.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const selectHotel = trpc.trip.selectHotel.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const swap = trpc.trip.swap.useMutation({ onSuccess: () => { setOpenSwap(null); utils.trip.get.invalidate(); }, onError: error => toast.error(error.message) });
  const continuePackage = trpc.trip.continuePackage.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const selectGuide = trpc.trip.selectGuide.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const skipGuide = trpc.trip.skipGuide.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const negotiate = trpc.trip.negotiate.useMutation({ onSuccess: () => { setNewCap(""); utils.trip.get.invalidate(); }, onError: error => toast.error(error.message) });
  const goBack = trpc.trip.goBack.useMutation({ onSuccess: () => { setOpenSwap(null); utils.trip.get.invalidate(); }, onError: error => toast.error(error.message) });
  const setLanguage = trpc.trip.setLanguage.useMutation({ onSuccess: () => utils.trip.get.invalidate() });
  const confirm = trpc.trip.confirm.useMutation({ onSuccess: () => utils.trip.get.invalidate(), onError: error => toast.error(error.message) });
  const loading = createTrip.isPending || autoBuild.isPending || selectFlight.isPending || selectHotel.isPending || swap.isPending || continuePackage.isPending || selectGuide.isPending || skipGuide.isPending || negotiate.isPending || goBack.isPending || confirm.isPending;

  const status = trip?.status === "confirmed" ? "review" : trip?.status === "negotiate" ? "review" : trip?.status || "intake";
  const stepIndex = Math.max(0, STAGES.indexOf(status as typeof STAGES[number]));
  const pct = trip ? Math.min(100, (trip.runningTotal / Math.max(1, trip.budgetCap)) * 100) : 0;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(current => ({ ...current, [key]: value })); }
  function changeLanguage(value: Lang) { update("language", value); if (tripId) setLanguage.mutate({ tripId, language: value }); }
  function applyTripRequest(request: any) {
    const durationDays = Math.max(1, Number(request.durationDays || 2));
    const departDate = request.departDate || isoDateFromToday(7);
    const end = new Date(`${departDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + durationDays - 1);
    setForm(current => ({ ...current, origin: request.origin?.code || current.origin, destination: request.destination?.code || current.destination, departDate, returnDate: request.returnDate || end.toISOString().slice(0, 10) }));
    setTripId(null);
    setScreen("intake");
    setDefaultsReady(true);
    toast.success(copy("requestApplied"));
  }
  function buildTripRequest(request: any) {
    const durationDays = Math.max(1, Number(request.durationDays || 2));
    const departDate = request.departDate || isoDateFromToday(1);
    const end = new Date(`${departDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + durationDays - 1);
    autoBuild.mutate({ origin: request.origin?.code || form.origin, destination: request.destination?.code || form.destination, departDate, returnDate: request.returnDate || end.toISOString().slice(0, 10), travelers: form.travelers, budgetCap: form.budgetCap > 0 ? form.budgetCap : undefined, language: form.language, interests: form.interests });
  }
  function startOver() { setTripId(null); setScreen("intake"); setOpenSwap(null); }
  function saveDraft() { localStorage.setItem("packagepro-draft", JSON.stringify({ form, tripId, screen })); setDraftSaved(true); toast.success(copy("saved")); }
  async function sharePlan() { const encoded = encodeURIComponent(JSON.stringify(form)); const url = `${window.location.origin}${window.location.pathname}#plan=${encoded}`; window.history.replaceState(null, "", `#plan=${encoded}`); await navigator.clipboard?.writeText(url); toast.success(copy("copied")); }
  function back() {
    if (screen === "reality") setScreen("intake");
    else if (trip?.status === "select_flight") {
      setTripId(null);
      setScreen("intake");
      toast.success(copy("adjust"));
    } else if (tripId) goBack.mutate({ tripId });
  }

  return <div className="min-h-screen bg-[#f7f5ef] text-[#17231f]">
    <header className="mx-auto max-w-[1320px] px-5 pb-4 pt-7 lg:px-10">
      <div className="flex items-center justify-between border-b border-[#d8d7cd] pb-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#17231f] font-serif text-lg text-[#f7f5ef]">P<span className="text-[#ecd8b4]">+</span></div><div><div className="font-serif text-xl font-semibold tracking-tight">{copy("brand")}</div><div className="text-[10px] uppercase tracking-[.18em] text-[#68736c]">{copy("tag")}</div></div></div><div className="flex items-center gap-3"><Languages className="hidden h-4 w-4 text-[#286c62] sm:block" />{trip && <div className="hidden items-center gap-2 rounded-full bg-[#e1efea] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#286c62] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#286c62]" /> {copy("live")}</div>}<select value={form.language} onChange={event => changeLanguage(event.target.value as Lang)} className="rounded-md border border-[#d8d7cd] bg-transparent px-3 py-2 text-xs">{LANGS.map(lang => <option key={lang.value} value={lang.value}>{lang.native}</option>)}</select></div></div>
      <div className="mt-5 overflow-x-auto"><div className="flex min-w-[700px] items-center justify-between">{STAGES.map((stage, index) => <div key={stage} className="flex flex-1 items-center"><div className="flex flex-col items-center gap-2"><div className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${index < stepIndex ? "bg-[#286c62] text-white" : index === stepIndex ? "bg-[#b6762a] text-white" : "border border-[#d8d7cd] text-[#9ba19b]"}`}>{index < stepIndex ? "✓" : String(index + 1).padStart(2, "0")}</div><span className={`whitespace-nowrap text-[10px] uppercase tracking-wider ${index === stepIndex ? "font-semibold text-[#17231f]" : "text-[#9ba19b]"}`}>{copy(stageLabel[stage])}</span></div>{index < STAGES.length - 1 && <div className={`mb-5 h-px flex-1 ${index < stepIndex ? "bg-[#286c62]" : "bg-[#d8d7cd]"}`} />}</div>)}</div></div>
    </header>

    <main className="mx-auto grid max-w-[1320px] gap-8 px-5 pb-24 pt-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-10">
      <section className="min-w-0">
        {screen === "intake" && <div className="landing-page"><div className="hero-spotlight"><img src={heroImage} alt="Curated India travel landscape" /><div className="hero-spotlight-shade" /><div className="hero-spotlight-meta"><span>{copy("curated")}</span><span><i />{copy("live")}</span></div><div className="hero-spotlight-caption">{copy("heroSub")}</div></div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#286c62]">{copy("kicker")}</div><h1 className="mt-3 max-w-4xl font-serif text-5xl font-medium leading-[.95] tracking-[-.05em] md:text-7xl">{copy("hero")}</h1><p className="mt-5 max-w-2xl text-base leading-7 text-[#68736c]">{copy("heroSub")}</p><Card className="mt-8 border-[#d8d7cd] bg-white/70 shadow-none"><CardContent className="p-6"><div className="mb-5 flex justify-between text-[10px] uppercase tracking-[.16em] text-[#68736c]"><span>{copy("brief")}</span><span className="text-[#286c62]">{copy("adjustable")}</span></div><form id="trip-brief" className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); setScreen("reality"); }}><Field label={copy("from")} hint={copy("airport")}><select value={form.origin} onChange={event => update("origin", event.target.value)} className="w-full rounded-md border border-[#d8d7cd] bg-[#fbfaf6] px-3 py-2">{(cities.data?.origins || []).map(item => <option key={item.code} value={item.code}>{item.city} ({item.code})</option>)}</select></Field><Field label={copy("to")} hint={copy("destination")}><select value={form.destination} onChange={event => update("destination", event.target.value)} className="w-full rounded-md border border-[#d8d7cd] bg-[#fbfaf6] px-3 py-2">{(cities.data?.destinations || []).map(item => <option key={`${item.code}-${item.city}`} value={item.code}>{item.label}</option>)}</select></Field><Field label={copy("depart")}><Input type="date" value={form.departDate} onChange={event => update("departDate", event.target.value)} required /></Field><Field label={copy("return")}><Input type="date" value={form.returnDate} onChange={event => update("returnDate", event.target.value)} required /></Field><Field label={copy("travelers")}><Input type="number" min={1} max={20} value={form.travelers} onChange={event => update("travelers", Number(event.target.value))} required /></Field><Field label={copy("language")}><select value={form.language} onChange={event => changeLanguage(event.target.value as Lang)} className="w-full rounded-md border border-[#d8d7cd] bg-[#fbfaf6] px-3 py-2">{LANGS.map(lang => <option key={lang.value} value={lang.value}>{lang.native}</option>)}</select></Field><div className="sm:col-span-2"><Field label={copy("feel")} hint={copy("feelHint")}><div className="mb-2 flex flex-wrap gap-1.5">{["Heritage & living temples", "Coastal & slow seafood", "Pilgrimage & dawn ghats", "Culinary trails & street food", "Boutique havelis & craft"].map(mood => <button key={mood} type="button" onClick={() => update("interests", mood)} className={`rounded-full px-2.5 py-1 text-[11px] transition ${form.interests === mood ? "bg-[#17231f] text-[#f7f5ef]" : "bg-[#ece8dc] text-[#17231f] hover:bg-[#ded9cb]"}`}>+ {mood}</button>)}</div><Textarea value={form.interests} onChange={event => update("interests", event.target.value)} className="min-h-20 bg-[#fbfaf6]" /></Field></div><div className="sm:col-span-2"><Field label={copy("budget")} hint={copy("budgetHint")}><Input type="number" min={1000} step={500} value={form.budgetCap} onChange={event => update("budgetCap", Number(event.target.value))} required /></Field></div><div className="sm:col-span-2"><Button type="submit" className="w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]">{copy("checkBudget")} <ArrowRight className="ml-2 h-4 w-4" /></Button></div></form></CardContent></Card><CuratedPackages packages={packages.data || []} recommendations={recommendations.data?.packages || []} recommendedGuides={recommendations.data?.guides || []} selectedPackageId={selectedPackageId} onSelectPackage={setSelectedPackageId} lang={form.language} onChoose={(city, id) => { setSelectedPackageId(id); const match = cities.data?.destinations.find(item => item.city === city); if (match) update("destination", match.code); document.getElementById("trip-brief")?.scrollIntoView({ behavior: "smooth" }); }} /></div>}

        {screen === "reality" && <Stage title={copy("reality")} subtitle={copy("realistic")} onBack={back} backLabel={copy("back")}><h2 className="font-serif text-3xl">{money(form.budgetCap)}</h2>{reality.data && <div className="mt-6"><Badge className={`${reality.data.verdict === "comfortable" ? "bg-[#e1efea] text-[#286c62]" : reality.data.verdict === "tight" ? "bg-[#fbf3e4] text-[#b6762a]" : "bg-[#f5e3df] text-[#ad4738]"}`}>{copy(reality.data.verdict as CopyKey)}</Badge><p className="mt-4 text-sm text-[#68736c]">{copy("typical")} {reality.data.destination}: <strong className="text-[#17231f]">{money(reality.data.typical)}</strong>. {copy("closest")}: {reality.data.closestPackage}.</p></div>}<div className="mt-8 flex gap-3"><Button variant="outline" onClick={back}><ArrowLeft className="mr-2 h-4 w-4" />{copy("adjust")}</Button><Button className="bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={createTrip.isPending} onClick={() => createTrip.mutate({ ...form, destination: form.destination })}>{createTrip.isPending ? copy("starting") : copy("continueBudget")} <ChevronRight className="ml-2 h-4 w-4" /></Button></div></Stage>}

          {trip && screen === "trip" && <>{trip.status === "negotiate" && <Stage title={copy("overBudget")} subtitle={copy("overBudgetSub")} onBack={back} backLabel={copy("back")} danger><div className="mt-4 space-y-2">{trip.negotiationOptions.map(option => <div key={option.choice}>{option.choice !== "raise_cap" ? <Button variant="outline" disabled={loading} className="w-full justify-start bg-white/70" onClick={() => negotiate.mutate({ tripId: trip.tripId, choice: option.choice as "approve_overage" | "swap_cheaper" | "remove_item" })}>{option.label}</Button> : <div className="flex gap-2"><Input type="number" placeholder={copy("newCap")} value={newCap} onChange={event => setNewCap(event.target.value)} /><Button disabled={loading || !newCap} className="bg-[#17231f] text-[#f7f5ef]" onClick={() => negotiate.mutate({ tripId: trip.tripId, choice: "raise_cap", newCap: Number(newCap) })}>{copy("set")}</Button></div>}</div>)}</div></Stage>}
          {trip.status === "select_flight" && <Stage title={copy("chooseFlight")} subtitle={`${copy("flightSub")} · ${copy("liveVia")} ${trip.flightSource === "catalogue" ? copy("catalogue") : trip.flightSource}`} onBack={back} backLabel={copy("back")}>{[...trip.flightOptions].sort((a, b) => a.price - b.price).map(flight => <Choice key={flight.id} disabled={loading} onClick={() => selectFlight.mutate({ tripId: trip.tripId, flightId: flight.id })} title={`${flight.airline} · ${flight.id}`} detail={`${flight.route} · ${flight.depart} · ${flight.duration}`} amount={flight.price} meta={`${Math.round(flight.confidence * 100)}% ${copy("confidence")}`} />)}</Stage>}
          {trip.status === "select_hotel" && <Stage title={copy("chooseHotel")} subtitle={`${copy("hotelSub")} · ${copy("liveVia")} ${trip.hotelSource === "catalogue" ? copy("catalogue") : trip.hotelSource}`} onBack={back} backLabel={copy("back")}>{trip.hotelOptions.map(hotel => <Choice key={hotel.id} disabled={loading} onClick={() => selectHotel.mutate({ tripId: trip.tripId, hotelId: hotel.id })} title={hotel.name} detail={`★ ${hotel.rating} · ${hotel.detail}`} amount={hotel.total} />)}</Stage>}
          {trip.status === "select_package" && trip.package && <Stage title={copy("yourPackage")} subtitle={copy("packageSub")} onBack={back} backLabel={copy("back")} extra={<div className="mb-4 rounded-md bg-[#e1efea] px-3 py-2 text-sm text-[#286c62]"><MapPin className="mr-1 inline h-4 w-4" />{trip.package.name} · {trip.package.city} · {money(trip.packagePrice)} / {trip.durationDays} {copy("days")}</div>}>{trip.packageComponents.map(component => <div key={component.id} className="rounded-md border border-[#d8d7cd] bg-white/60 p-4"><div className="flex items-center justify-between gap-4"><div><div className="font-medium">{component.label}</div><div className="mt-1 text-xs text-[#68736c]">{component.detail}</div></div><div className="flex items-center gap-3"><span className="text-sm">{money(component.price)}</span>{component.swapGroup && <Button variant="ghost" className="text-xs text-[#286c62]" onClick={() => setOpenSwap(openSwap === component.id ? null : component.id)}>{copy("swap")}</Button>}</div></div>{openSwap === component.id && <div className="mt-3 border-t border-[#d8d7cd] pt-3">{alternatives.data?.map(option => <button key={option.id} className="flex w-full items-center justify-between rounded px-1 py-2 text-left text-sm hover:bg-[#f7f5ef]" onClick={() => swap.mutate({ tripId: trip.tripId, fromId: component.id, toId: option.id })}><span>{option.label}</span><span>{money(option.price)} <span className="ml-2 text-xs text-[#68736c]">({option.price - component.price >= 0 ? "+" : ""}{money(option.price - component.price)})</span></span></button>)}</div>}</div>)}<Button className="mt-5 w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={loading} onClick={() => continuePackage.mutate({ tripId: trip.tripId })}>{copy("continueGuide")} <ChevronRight className="ml-2 h-4 w-4" /></Button></Stage>}
          {trip.status === "select_guide" && <Stage title={copy("addGuide")} subtitle={copy("guideSub")} onBack={back} backLabel={copy("back")} extra={trip.guideAvailabilityIssue && <div className="mb-4 rounded-md border border-[#ad4738] bg-[#f5e3df] p-4"><div className="flex items-start gap-2 font-semibold text-[#ad4738]"><CircleAlert className="mt-0.5 h-4 w-4" />{trip.guideAvailabilityIssue.guide.name} {copy("unavailable")} {trip.guideAvailabilityIssue.conflictingDates.join(", ")}.</div>{trip.guideAvailabilityIssue.replacement && <Button className="mt-3 bg-white text-[#17231f] hover:bg-[#f7f5ef]" disabled={loading} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: trip.guideAvailabilityIssue!.replacement!.id, days: guideDays })}>{copy("use")} {trip.guideAvailabilityIssue.replacement.name} · {money(trip.guideAvailabilityIssue.replacementTotalCost || 0)}</Button>}</div>}><label className="mb-4 flex items-center gap-3 text-sm">{copy("days")} <Input type="number" min={1} max={trip.durationDays} value={guideDays} onChange={event => setGuideDays(Number(event.target.value))} className="w-20" /></label>{guides.data?.map(guide => <Choice key={guide.id} disabled={loading} onClick={() => selectGuide.mutate({ tripId: trip.tripId, guideId: guide.id, days: guideDays })} title={guide.name} detail={`${guide.specialisation} · ${guide.languages.join(", ")}`} amount={guide.dayRate} meta={`★ ${guide.rating}`} />)}<Button variant="ghost" className="mt-4" disabled={loading} onClick={() => skipGuide.mutate({ tripId: trip.tripId })}>{copy("skipGuide")} <ArrowRight className="ml-2 h-4 w-4" /></Button></Stage>}
          {(trip.status === "review" || trip.status === "confirmed") && <Stage title={trip.status === "confirmed" ? copy("locked") : copy("review")} subtitle={trip.status === "confirmed" ? `${copy("final")} ${money(trip.runningTotal)} ${copy("of")} ${money(trip.budgetCap)}.` : copy("reviewSub")} onBack={trip.status === "review" ? back : undefined} backLabel={copy("back")}>{trip.status === "confirmed" ? <div className="rounded-md bg-[#e1efea] p-4 font-semibold text-[#286c62]"><Check className="mr-2 inline h-4 w-4" />{copy("confirmed")}</div> : <div className="space-y-3"><Row label={copy("flight")} value={trip.chosenFlight ? `${trip.chosenFlight.airline} ${trip.chosenFlight.id}` : "—"} amount={trip.chosenFlight?.price} /><Row label={copy("yourPackage")} value={trip.package?.name || "—"} amount={trip.packagePrice || undefined} /><Row label={copy("hotel")} value={trip.chosenHotel?.name || "—"} amount={trip.chosenHotel?.total} /><Row label={copy("guide")} value={trip.chosenGuide ? `${trip.chosenGuide.name} (${trip.chosenGuide.daysBooked})` : copy("notBooked")} amount={trip.chosenGuide?.totalCost} /><div className="grid gap-3 pt-3 sm:grid-cols-2"><Input placeholder={copy("email")} value={email} onChange={event => setEmail(event.target.value)} type="email" /><Input placeholder={copy("phone")} value={phone} onChange={event => setPhone(event.target.value)} /></div><Button className="mt-3 w-full bg-[#17231f] text-[#f7f5ef] hover:bg-[#2b3933]" disabled={loading} onClick={() => confirm.mutate({ tripId: trip.tripId, email: email || undefined, phone: phone || undefined })}>{copy("confirmTrip")} <Check className="ml-2 h-4 w-4" /></Button></div>}{trip.status === "confirmed" && <Button variant="ghost" className="mt-6" onClick={startOver}>{copy("another")}</Button>}</Stage>}
        </>}
      </section>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start"><AgentTransparencyChat trip={trip} lang={form.language} destination={destinationCity} plannerContext={{ availableOrigins: cities.data?.origins || [], availableDestinations: cities.data?.destinations || [], budgetCap: form.budgetCap, interests: form.interests }} onApplyTrip={applyTripRequest} onBuildPackage={buildTripRequest} />{(trip || screen !== "intake") && <PlanActions saved={draftSaved} onSave={saveDraft} onShare={sharePlan} saveLabel={copy("saveDraft")} savedLabel={copy("saved")} shareLabel={copy("share")} />}{trip ? <><Card className="border-[#d8d7cd] border-t-[3px] border-t-[#286c62] bg-white/70 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">{copy("liveBudget")}</div><div className="mt-3 font-serif text-3xl">{money(trip.runningTotal)} <span className="text-sm text-[#68736c]">{copy("of")} {money(trip.budgetCap)}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ece9df]"><div className="h-full rounded-full bg-[#286c62]" style={{ width: `${pct}%` }} /></div><div className="mt-2 flex justify-between text-xs text-[#68736c]"><span>{trip.remaining >= 0 ? `${money(trip.remaining)} ${copy("remaining")}` : `${money(Math.abs(trip.remaining))} ${copy("over")}`}</span><span>{Math.round(pct)}%</span></div></CardContent></Card><Card className="border-[#d8d7cd] bg-white/50 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">{copy("tripBrief")}</div><RailRow label={copy("dates")} value={`${form.departDate}\n${form.returnDate}`} /><RailRow label={copy("party")} value={`${trip.travelers}`} /><RailRow label={copy("language")} value={LANGS.find(item => item.value === form.language)?.native || form.language} /><RailRow label={copy("pieces")} value={String(trip.packageComponents.length || "—")} /></CardContent></Card><div className="flex items-start gap-2 text-xs text-[#68736c]"><Sparkles className="mt-0.5 h-4 w-4 text-[#b6762a]" />{copy("promiseNote")}</div></> : <><Card className="border-[#d8d7cd] border-t-[3px] border-t-[#17231f] bg-white/50 shadow-none"><CardContent className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">{copy("promise")}</div><h3 className="mt-3 font-serif text-2xl">{copy("promiseTitle")}</h3><p className="mt-3 text-sm text-[#68736c]">{copy("promiseBody")}</p></CardContent></Card><RailStep n="01" title={copy("build")} detail={copy("buildSub")} /><RailStep n="02" title={copy("shape")} detail={copy("shapeSub")} /><RailStep n="03" title={copy("confirm")} detail={copy("confirmSub")} /></>}</aside>
    </main>
  </div>;
}


function CuratedPackages({ packages, recommendations, recommendedGuides, selectedPackageId, onSelectPackage, lang, onChoose }: { packages: any[]; recommendations: any[]; recommendedGuides: any[]; selectedPackageId: string | null; onSelectPackage: (id: string | null) => void; lang: Lang; onChoose: (city: string, id: string) => void }) {
  const packageCards = packages.slice(0, 6);
  const selected = packages.find(pkg => pkg.id === selectedPackageId);
  return <div className="mt-10 border-t border-[#d8d7cd] pt-8">
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">{t(lang, "curated")}</div>
        <h2 className="mt-2 font-serif text-3xl">{t(lang, "curatedSub")}</h2>
      </div>
      <Badge variant="outline" className="border-[#d8d7cd]">{packageCards.length} {t(lang, "routes")}</Badge>
    </div>

    {recommendations.length > 1 && (
      <div className="mt-6 rounded-xl border border-[#b8d8cf] bg-gradient-to-r from-[#e1efea]/80 via-white/80 to-[#fbf3e4]/70 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#286c62]">
            <Sparkles className="h-4 w-4" /> {t(lang, "compareRoutes")}
          </div>
          <span className="text-[11px] text-[#68736c]">{t(lang, "comparing")}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {recommendations.slice(0, 2).map((pkg, idx) => (
            <div key={pkg.id} className="rounded-lg border border-[#d8d7cd] bg-white/90 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#286c62]">Option {idx + 1}: {pkg.city}</span>
                <span className="font-serif text-base">{money(pkg.basePrice)}</span>
              </div>
              <h4 className="mt-1 font-serif text-lg">{pkg.name}</h4>
              <p className="mt-1 text-xs text-[#68736c] line-clamp-2">{pkg.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {(pkg.matchReasons || []).map((reason: string) => (
                  <Badge key={reason} variant="outline" className="text-[10px] border-[#286c62]/30 bg-[#e1efea]/50 text-[#286c62]">
                    ✓ {reason}
                  </Badge>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => onChoose(pkg.city, pkg.id)} className="mt-3 w-full text-xs hover:bg-[#e1efea]">
                Choose this route
              </Button>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packageCards.map(pkg => (
        <button key={pkg.id} onClick={() => { onSelectPackage(selectedPackageId === pkg.id ? null : pkg.id); onChoose(pkg.city, pkg.id); }} className={`rounded-md border p-4 text-left transition hover:-translate-y-0.5 hover:border-[#286c62] ${selectedPackageId === pkg.id ? "border-[#286c62] bg-[#e1efea]/60" : "border-[#d8d7cd] bg-white/60"}`}>
          <div className="package-card-media"><img src={pkg.image} alt={`${pkg.city} travel`} loading="lazy" /></div>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{pkg.theme}</Badge>
            <span className="font-serif text-lg">{money(pkg.basePrice)}</span>
          </div>
          <h3 className="mt-3 font-serif text-xl">{pkg.name}</h3>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#68736c]">{pkg.description}</p>
          <div className="mt-3 flex items-center justify-between text-[11px] text-[#68736c]">
            <span><MapPin className="mr-1 inline h-3 w-3" />{pkg.city}</span>
            <span>{pkg.duration} days · {pkg.components.length} components</span>
          </div>
        </button>
      ))}
    </div>

    {selected && (
      <div className="mt-4 rounded-md border border-[#b8d8cf] bg-white/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <img className="package-detail-image" src={selected.image} alt={`${selected.city} travel`} />
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">{t(lang, "detail")}</div>
            <h3 className="mt-2 font-serif text-2xl">{selected.name}</h3>
            <p className="mt-2 text-sm leading-6 text-[#68736c]">{selected.description}</p>
          </div>
          <Button variant="ghost" onClick={() => onSelectPackage(null)}>×</Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {selected.components.map((component: any) => (
            <div key={component.id} className="rounded border border-[#d8d7cd] p-3">
              <div className="text-sm font-medium">{component.label}</div>
              <div className="mt-1 text-xs text-[#68736c]">{component.detail}</div>
              <div className="mt-2 text-sm">{money(component.price)}</div>
            </div>
          ))}
        </div>
      </div>
    )}

    {recommendations.length > 0 && (
      <div className="mt-8 rounded-md bg-[#e1efea]/60 p-5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#286c62]">
          <Sparkles className="h-3.5 w-3.5" />{t(lang, "recommendations")}
        </div>
        <p className="mt-2 text-xs text-[#68736c]">{t(lang, "grounded")}</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {recommendations.slice(0, 3).map(pkg => (
            <button key={pkg.id} onClick={() => onChoose(pkg.city, pkg.id)} className="rounded border border-[#b8d8cf] bg-white/60 p-3 text-left">
              <div className="text-sm font-medium">{pkg.name}</div>
              <div className="mt-1 text-xs text-[#68736c]">{pkg.city} · {money(pkg.basePrice)}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(pkg.matchReasons || []).slice(0, 2).map((reason: string) => (
                  <span key={reason} className="rounded bg-[#286c62]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#286c62]">
                    {reason}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
        {recommendedGuides.length > 0 && (
          <div className="mt-4 border-t border-[#b8d8cf] pt-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#286c62]">{t(lang, "guideAddons")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recommendedGuides.map(guide => (
                <Badge key={guide.id} variant="outline" className="border-[#b8d8cf] bg-white/60">
                  {guide.name} · {guide.specialisation} · {money(guide.dayRate)}/day
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    )}
  </div>;
}
function PlanActions({ saved, onSave, onShare, saveLabel, savedLabel, shareLabel }: { saved: boolean; onSave: () => void; onShare: () => void; saveLabel: string; savedLabel: string; shareLabel: string }) {
  return <div className="flex gap-2"><Button variant="outline" className="flex-1 border-[#d8d7cd] bg-white/60 text-xs" onClick={onSave}><Check className="mr-1 h-3.5 w-3.5" />{saved ? savedLabel : saveLabel}</Button><Button variant="outline" className="flex-1 border-[#d8d7cd] bg-white/60 text-xs" onClick={onShare}>{shareLabel} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold"><span className="mb-2 flex justify-between"><span>{label}</span>{hint && <small className="font-normal text-[#68736c]">{hint}</small>}</span>{children}</label>; }
function Stage({ title, subtitle, extra, children, onBack, backLabel = "Back", danger }: { title: string; subtitle: string; extra?: React.ReactNode; children: React.ReactNode; onBack?: () => void; backLabel?: string; danger?: boolean }) { return <Card className={`border-[#d8d7cd] bg-white/70 shadow-none ${danger ? "border-[#ad4738]" : ""}`}><CardContent className="p-6">{onBack && <Button variant="ghost" onClick={onBack} className="mb-3 -ml-3 text-xs text-[#68736c]"><ArrowLeft className="mr-2 h-4 w-4" />{backLabel}</Button>}<h2 className={`font-serif text-3xl ${danger ? "text-[#ad4738]" : ""}`}>{title}</h2><p className="mt-2 text-sm text-[#68736c]">{subtitle}</p><div className="mt-6">{extra}<div className="space-y-3">{children}</div></div></CardContent></Card>; }
function Choice({ title, detail, amount, meta, onClick, disabled }: { title: string; detail: string; amount: number; meta?: string; onClick: () => void; disabled?: boolean }) { return <button disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between rounded-md border border-[#d8d7cd] bg-white/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#286c62] disabled:opacity-50"><div><div className="font-medium">{title}</div><div className="mt-1 text-xs text-[#68736c]">{detail}</div></div><div className="text-right"><div className="font-serif text-lg">{money(amount)}</div>{meta && <div className="text-[11px] text-[#68736c]">{meta}</div>}</div></button>; }
function Row({ label, value, amount }: { label: string; value: string; amount?: number }) { return <div className="flex items-start justify-between border-b border-[#d8d7cd] py-2"><div><div className="text-[11px] uppercase tracking-wider text-[#68736c]">{label}</div><div>{value}</div></div>{amount != null && <span>{money(amount)}</span>}</div>; }
function RailRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 border-b border-[#d8d7cd] py-3 text-xs text-[#68736c]"><span>{label}</span><strong className="whitespace-pre-line text-right text-[#17231f]">{value}</strong></div>; }
function RailStep({ n, title, detail }: { n: string; title: string; detail: string }) { return <div className="flex items-center gap-3 border-b border-[#d8d7cd] py-3"><span className="font-serif text-2xl text-[#b6762a]">{n}</span><div><div className="text-sm font-semibold">{title}</div><div className="text-xs text-[#68736c]">{detail}</div></div></div>; }
