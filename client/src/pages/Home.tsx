import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BedDouble, Calendar, Check, Compass, Flame, Languages, Map as MapIcon, MapPin, Plane, Search, Share2, Sparkles, Star, Ticket, Users, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { LANGS, type CopyKey, type Lang, t } from "@/i18n";
import AgentTransparencyChat from "@/components/AgentTransparencyChat";
import { buildWhatsAppUrl } from "@/lib/itineraryExport";
import { PackageCustomiser, PriceBreakdown } from "@/components/PackageCustomiser";
import { EstimateView, FlightRow, NegotiationPanel, Panel, ReviewPanel, ScreenHeader, SectionTitle, Stepper, money, prettyDate } from "@/components/TripScreens";

function isoDateFromToday(offset: number) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function addDays(iso: string, days: number) { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

/** Guide / tour-delivery languages (BCP-47) spoken by guides in the PS-04 dataset. */
const GUIDE_LANGS = [
  { value: "en-IN", native: "English" }, { value: "hi", native: "हिन्दी · Hindi" }, { value: "ta", native: "தமிழ் · Tamil" }, { value: "te", native: "తెలుగు · Telugu" },
  { value: "kn", native: "ಕನ್ನಡ · Kannada" }, { value: "ml", native: "മലയാളം · Malayalam" }, { value: "mr", native: "मराठी · Marathi" }, { value: "gu", native: "ગુજરાતી · Gujarati" },
  { value: "bn", native: "বাংলা · Bengali" }, { value: "pa", native: "ਪੰਜਾਬੀ · Punjabi" }, { value: "or", native: "ଓଡ଼ିଆ · Odia" }, { value: "ur", native: "اردو · Urdu" },
];
const THEMES = ["heritage", "honeymoon", "adventure", "pilgrimage", "family", "wellness", "wildlife", "food_trail"] as const;
const MOODS = ["Heritage & living temples", "Beaches & slow food", "Pilgrimage & dawn rituals", "Street food trails", "Mountains & treks"];

type FormState = { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests: string };
type Screen = "intake" | "reality" | "trip";

export default function Home() {
  const [form, setForm] = useState<FormState>({ origin: "", destination: "", departDate: isoDateFromToday(3), returnDate: isoDateFromToday(6), travelers: 1, budgetCap: 0, language: "en-IN", interests: "" });
  const [uiLang, setUiLang] = useState<Lang>("en-IN");
  const [screen, setScreen] = useState<Screen>("intake");
  const [tripId, setTripId] = useState<string | null>(null);
  const [newCap, setNewCap] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const utils = trpc.useUtils();
  const copy = (key: CopyKey) => t(uiLang, key);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("packagepro-draft");
      if (saved) { const draft = JSON.parse(saved); if (draft.form) setForm(draft.form); if (draft.uiLang) setUiLang(draft.uiLang); if (draft.screen) setScreen(draft.screen); if (draft.tripId) setTripId(draft.tripId); }
    } catch { /* ignore a malformed or blocked local draft */ }
    const encoded = window.location.hash.startsWith("#plan=") ? window.location.hash.slice(6) : "";
    if (encoded) { try { const shared = JSON.parse(decodeURIComponent(encoded)); if (shared.origin) setForm(current => ({ ...current, ...shared })); toast.success(t("en-IN", "sharedLoaded")); } catch { /* ignore a malformed shared plan */ } }
  }, []);

  const cities = trpc.packagepro.cities.useQuery();
  const packages = trpc.packagepro.list.useQuery({ language: form.language });
  useEffect(() => {
    if (defaultsReady || !cities.data?.destinations.length || !packages.data?.length) return;
    setForm(current => ({ ...current, origin: current.origin || "DEL", destination: current.destination || (cities.data!.destinations.find(item => item.city === "Jaipur") ?? cities.data!.destinations[0]).code, budgetCap: current.budgetCap || 40000, interests: current.interests || "heritage, local food, living culture" }));
    setDefaultsReady(true);
  }, [cities.data, packages.data, defaultsReady]);

  const tripQuery = trpc.trip.get.useQuery({ tripId: tripId || "" }, { enabled: Boolean(tripId), retry: false });
  const trip = tripQuery.data;
  useEffect(() => { if (tripQuery.error && tripId) { setTripId(null); setScreen("intake"); } }, [tripQuery.error, tripId]);
  const destination = cities.data?.destinations.find(item => item.code === form.destination);
  const destinationCity = destination?.city || "Jaipur";
  const recommendations = trpc.packagepro.recommend.useQuery({ query: form.interests, language: form.language, destination: destinationCity, budget: form.budgetCap || undefined });
  const estimate = trpc.packagepro.estimate.useQuery({ origin: form.origin, destination: form.destination, departDate: form.departDate, returnDate: form.returnDate, travelers: form.travelers, budget: form.budgetCap || 1, language: form.language, interests: form.interests }, { enabled: screen === "reality" && Boolean(form.destination), staleTime: 5 * 60 * 1000 });

  const onError = (error: { message: string }) => toast.error(error.message);
  const refresh = () => utils.trip.get.invalidate();
  const createTrip = trpc.trip.create.useMutation({ onSuccess: data => { setTripId(data.tripId); setScreen("trip"); toast.success(copy("started")); }, onError });
  const autoBuild = trpc.trip.autoBuild.useMutation({ onSuccess: data => { setTripId(data.tripId); setScreen("trip"); toast.success(copy("packageReady")); }, onError });
  const selectFlight = trpc.trip.selectFlight.useMutation({ onSuccess: refresh, onError });
  const swapHotel = trpc.trip.swapHotel.useMutation({ onSuccess: refresh, onError });
  const removeGuide = trpc.trip.removeGuide.useMutation({ onSuccess: refresh, onError });
  const continuePackage = trpc.trip.continuePackage.useMutation({ onSuccess: refresh, onError });
  const negotiate = trpc.trip.negotiate.useMutation({ onSuccess: () => { setNewCap(""); refresh(); }, onError });
  const goBack = trpc.trip.goBack.useMutation({ onSuccess: refresh, onError });
  const setTripLanguage = trpc.trip.setLanguage.useMutation({ onSuccess: () => { refresh(); utils.trip.guides.invalidate(); } });
  const confirm = trpc.trip.confirm.useMutation({ onSuccess: refresh, onError });
  const busy = createTrip.isPending || autoBuild.isPending || selectFlight.isPending || swapHotel.isPending || removeGuide.isPending || continuePackage.isPending || negotiate.isPending || goBack.isPending || confirm.isPending;

  const packageList = packages.data || [];
  const filtered = useMemo(() => packageList.filter(pkg => !theme || pkg.tags.includes(theme)), [packageList, theme]);
  const topBooked = new Set([...packageList].sort((a, b) => b.popularity.bookings - a.popularity.bookings).slice(0, 3).map(pkg => pkg.id));
  const heroImage = packageList.find(pkg => pkg.city === destinationCity && pkg.image.startsWith("http"))?.image || packageList.find(pkg => pkg.image.startsWith("http"))?.image;
  const detail = packageList.find(pkg => pkg.id === detailId);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(current => ({ ...current, [key]: value })); }
  function changeGuideLanguage(value: string) { update("language", value); if (tripId && trip && trip.status !== "confirmed") setTripLanguage.mutate({ tripId, language: value }); }
  function choosePackage(pkg: { city: string; duration: number }) {
    const match = cities.data?.destinations.find(item => item.city === pkg.city);
    setForm(current => ({ ...current, destination: match?.code || current.destination, returnDate: addDays(current.departDate, pkg.duration) }));
    setDetailId(null);
    setTripId(null);
    setScreen("reality");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function applyTripRequest(request: any) {
    const durationDays = Math.max(1, Number(request.durationDays || 2));
    const departDate = request.departDate || isoDateFromToday(3);
    setForm(current => ({ ...current, origin: request.origin?.code || current.origin, destination: request.destination?.code || current.destination, departDate, returnDate: request.returnDate || addDays(departDate, durationDays) }));
    setTripId(null); setScreen("intake"); setDefaultsReady(true);
    toast.success(copy("requestApplied"));
  }
  function buildTripRequest(request: any) {
    const durationDays = Math.max(1, Number(request.durationDays || 2));
    const departDate = request.departDate || isoDateFromToday(3);
    autoBuild.mutate({ origin: request.origin?.code || form.origin, destination: request.destination?.code || form.destination, departDate, returnDate: request.returnDate || addDays(departDate, durationDays), travelers: form.travelers, budgetCap: form.budgetCap > 0 ? form.budgetCap : undefined, language: form.language, interests: form.interests, hotelTier: request.hotelTier, transportMode: request.transportMode });
  }
  function runTripCommand(command: { type: "swap_hotel" | "remove_guide"; target?: string }) {
    if (!tripId) return;
    if (command.type === "swap_hotel" && command.target) swapHotel.mutate({ tripId, target: command.target });
    if (command.type === "remove_guide") removeGuide.mutate({ tripId });
  }
  function startOver() { setTripId(null); setScreen("intake"); }
  function saveDraft() { try { localStorage.setItem("packagepro-draft", JSON.stringify({ form, uiLang, tripId, screen })); } catch { /* storage unavailable */ } setDraftSaved(true); toast.success(copy("saved")); }
  async function sharePlan() { const encoded = encodeURIComponent(JSON.stringify(form)); const url = `${window.location.origin}${window.location.pathname}#plan=${encoded}`; window.history.replaceState(null, "", `#plan=${encoded}`); await navigator.clipboard?.writeText(url).catch(() => undefined); toast.success(copy("copied")); }
  function exportWhatsApp() { if (!trip) return; window.open(buildWhatsAppUrl(trip), "_blank", "noopener,noreferrer"); toast.success(copy("whatsappReady")); }
  function back() {
    if (screen === "reality") setScreen("intake");
    else if (!trip || trip.status === "select_flight") { setTripId(null); setScreen("reality"); }
    else goBack.mutate({ tripId: trip.tripId });
  }

  const steps = [copy("stepTrip"), copy("stepReality"), copy("stepFlight"), copy("customise").split(" ")[0], copy("stepConfirm")];
  const stepIndex = screen === "reality" ? 1 : !trip ? 0 : trip.status === "select_flight" ? 2 : trip.status === "select_package" || trip.status === "negotiate" ? 3 : 4;

  return <div className="min-h-screen bg-[#f2f5f9] text-[#0b1f3a]">
    {/* ---------- Top bar ---------- */}
    <header className={`${screen === "intake" ? "absolute inset-x-0 top-0 z-20 text-white" : "sticky top-0 z-30 border-b border-[#e6ebf2] bg-white/95 backdrop-blur"}`}>
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-3 md:px-6">
        <button onClick={startOver} className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#1a8cff] to-[#0b4fb3] text-base font-black text-white shadow-md">P<span className="text-[#ffb36b]">+</span></div>
          <div className="text-left leading-tight"><div className="text-lg font-black tracking-tight">{copy("brand")}</div><div className={`text-[10px] font-semibold uppercase tracking-[.16em] ${screen === "intake" ? "text-white/70" : "text-[#5f6b7a]"}`}>{copy("tag")}</div></div>
        </button>
        {screen !== "intake" && <div className="hidden lg:block"><Stepper steps={steps} current={stepIndex} /></div>}
        <label className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${screen === "intake" ? "bg-white/15 ring-1 ring-white/25" : "bg-[#f2f5f9]"}`}>
          <Languages className="h-3.5 w-3.5" /><span className="hidden sm:inline">{copy("appLanguage")}</span>
          <select value={uiLang} onChange={event => setUiLang(event.target.value as Lang)} className="bg-transparent font-bold outline-none [&>option]:text-[#0b1f3a]">{LANGS.map(lang => <option key={lang.value} value={lang.value}>{lang.native}</option>)}</select>
        </label>
      </div>
    </header>

    {screen === "intake" && <>
      {/* ---------- Hero + search ---------- */}
      <section className="relative overflow-hidden pb-24 pt-24 text-white md:pb-28 md:pt-28">
        {heroImage && <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#041634]/90 via-[#0a2d63]/80 to-[#0b4fb3]/85" />
        <div className="relative mx-auto max-w-[1240px] px-4 md:px-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[.16em] ring-1 ring-white/25"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />{copy("live")} · Google Flights · PS-04</div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">{copy("heroTitle")}</h1>
          <p className="mt-4 max-w-2xl text-sm text-white/80 md:text-base">{copy("heroLead")}</p>

          <form onSubmit={event => { event.preventDefault(); setScreen("reality"); }} className="relative mt-8 rounded-2xl bg-white p-2 pb-10 text-[#0b1f3a] shadow-[0_24px_60px_rgba(0,0,0,.3)]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-2 pt-3 text-xs font-semibold text-[#5f6b7a]"><span className="flex items-center gap-1.5 text-[#0b6bcb]"><Plane className="h-3.5 w-3.5" />Flights</span><span className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5" />Stays</span><span className="flex items-center gap-1.5"><Ticket className="h-3.5 w-3.5" />Activities</span><span className="flex items-center gap-1.5"><Compass className="h-3.5 w-3.5" />Local guides</span><span className="ml-auto hidden text-[11px] md:inline">{copy("everything")}</span></div>
            <div className="grid overflow-hidden rounded-xl border border-[#e6ebf2] sm:grid-cols-2 lg:grid-cols-[1.1fr_1.3fr_1fr_1fr_1fr_1.1fr]">
              <FieldCell label={copy("from")}>
                <select value={form.origin} onChange={event => update("origin", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{(cities.data?.origins || []).map(item => <option key={item.code} value={item.code}>{item.city} ({item.code})</option>)}</select>
                <div className="truncate text-2xl font-black">{cities.data?.origins.find(item => item.code === form.origin)?.city || "—"}</div>
                <div className="truncate text-[11px] text-[#5f6b7a]">{form.origin}, {cities.data?.origins.find(item => item.code === form.origin)?.airport}</div>
              </FieldCell>
              <FieldCell label={copy("to")}>
                <select value={form.destination} onChange={event => update("destination", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{(cities.data?.destinations || []).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
                <div className="truncate text-2xl font-black">{destinationCity}</div>
                <div className="truncate text-[11px] text-[#5f6b7a]">{destination?.airport ? `${destination.airport} · ` : ""}{destination?.label.split("·")[1]?.trim()}</div>
              </FieldCell>
              <DateCell label={copy("depart")} value={form.departDate} onChange={value => { update("departDate", value); if (value >= form.returnDate) update("returnDate", addDays(value, 3)); }} />
              <DateCell label={copy("return")} value={form.returnDate} min={addDays(form.departDate, 1)} onChange={value => update("returnDate", value)} />
              <FieldCell label={copy("travellersBudget")}>
                <div className="flex items-baseline gap-1"><input type="number" min={1} max={20} value={form.travelers} onChange={event => update("travelers", Math.max(1, Number(event.target.value)))} className="w-8 bg-transparent text-2xl font-black outline-none" /><Users className="h-4 w-4 text-[#5f6b7a]" /></div>
                <div className="flex items-center text-[11px] text-[#5f6b7a]">₹<input type="number" min={1000} step={1000} value={form.budgetCap} onChange={event => update("budgetCap", Number(event.target.value))} className="w-20 bg-transparent font-semibold text-[#0b1f3a] outline-none" /></div>
              </FieldCell>
              <FieldCell label={copy("guideLanguage")}>
                <select value={form.language} onChange={event => changeGuideLanguage(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{GUIDE_LANGS.map(lang => <option key={lang.value} value={lang.value}>{lang.native}</option>)}</select>
                <div className="truncate text-2xl font-black">{GUIDE_LANGS.find(lang => lang.value === form.language)?.native.split(" · ")[0]}</div>
                <div className="text-[11px] text-[#5f6b7a]">{form.language} · guides & tours</div>
              </FieldCell>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5f6b7a]">{copy("feel")}</span>
              {MOODS.map(mood => <button key={mood} type="button" onClick={() => update("interests", mood)} className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${form.interests === mood ? "bg-[#0b6bcb] text-white" : "bg-[#eef3fa] text-[#0b1f3a] hover:bg-[#dfe9f7]"}`}>{mood}</button>)}
              <input value={form.interests} onChange={event => update("interests", event.target.value)} className="min-w-40 flex-1 rounded-full border border-[#e6ebf2] px-3 py-1 text-xs outline-none focus:border-[#0b6bcb]" />
            </div>
            <Button type="submit" className="absolute -bottom-6 left-1/2 h-12 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] px-12 text-base font-black uppercase tracking-wider text-white shadow-[0_10px_24px_rgba(6,90,243,.45)] hover:opacity-95"><Search className="mr-2 h-5 w-5" />{copy("searchPackages")}</Button>
          </form>
        </div>
      </section>

      <main className="mx-auto max-w-[1240px] space-y-10 px-4 pb-24 pt-14 md:px-6">
        {/* ---------- Picked for you + AI planner ---------- */}
        <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Panel className="p-5">
            <SectionTitle icon={<Sparkles className="h-4 w-4 text-[#7c3aed]" />} title={copy("pickedForYou")} sub={copy("grounded")} />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(recommendations.data?.packages || []).map(pkg => <button key={pkg.id} onClick={() => setDetailId(pkg.id)} className="group overflow-hidden rounded-xl border border-[#e6ebf2] text-left transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="relative h-28 overflow-hidden bg-[#dfe8f4]"><img src={packageList.find(item => item.id === pkg.id)?.image || pkg.image} alt={pkg.city} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold text-[#0b1f3a]">{pkg.city}</span></div>
                <div className="p-3"><div className="line-clamp-1 text-sm font-bold">{pkg.name}</div><div className="mt-1 flex flex-wrap gap-1">{pkg.matchReasons.slice(0, 3).map(reason => <span key={reason} className="rounded bg-[#eef6ff] px-1.5 py-0.5 text-[9px] font-semibold text-[#0b6bcb]">✓ {reason}</span>)}</div><div className="mt-2 text-base font-extrabold">{money(pkg.basePrice)}</div></div>
              </button>)}
            </div>
          </Panel>
          <div>
            <div className="mb-2 px-1"><div className="text-[15px] font-bold">{copy("planWithAi")}</div><p className="text-xs text-[#5f6b7a]">{copy("planWithAiSub")}</p></div>
            <AgentTransparencyChat trip={trip} lang={uiLang} destination={destinationCity} plannerContext={{ availableOrigins: cities.data?.origins || [], availableDestinations: cities.data?.destinations || [], budgetCap: form.budgetCap, interests: form.interests, destinationInsight: recommendations.data?.destinationInsight }} onApplyTrip={applyTripRequest} onBuildPackage={buildTripRequest} onCommand={runTripCommand} />
          </div>
        </section>

        {/* ---------- Package listing ---------- */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black tracking-tight">{copy("popularPackages")}</h2><p className="mt-1 text-sm text-[#5f6b7a]">{copy("popularSub")}</p></div><span className="text-xs font-semibold text-[#5f6b7a]">{filtered.length} {copy("routes")}</span></div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {[null, ...THEMES].map(item => <button key={item ?? "all"} onClick={() => setTheme(item)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${theme === item ? "bg-[#0b1f3a] text-white shadow" : "bg-white text-[#0b1f3a] shadow-sm ring-1 ring-[#e6ebf2] hover:ring-[#0b6bcb]"}`}>{item ? copy(`theme_${item}` as CopyKey) : copy("allThemes")}</button>)}
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.slice(0, 12).map(pkg => {
              const hot = topBooked.has(pkg.id);
              const inLang = pkg.languagesOffered.includes(form.language);
              return <article key={pkg.id} className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08),0_8px_24px_rgba(16,24,40,.06)] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(16,24,40,.14)]">
                <button onClick={() => setDetailId(pkg.id)} className="relative h-48 overflow-hidden bg-[#dfe8f4] text-left">
                  <img src={pkg.image} alt={pkg.city} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#0b1f3a]">{copy(`theme_${pkg.tags[0]}` as CopyKey)}</span>
                  {hot && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#ff5a1f] px-2.5 py-1 text-[10px] font-extrabold text-white"><Flame className="h-3 w-3" />Most booked</span>}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-white"><MapPin className="h-3.5 w-3.5" /><span className="text-sm font-bold">{pkg.city}</span></div>
                  <span className="absolute bottom-3 right-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">{pkg.durationNights}N/{pkg.duration}D</span>
                </button>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="line-clamp-1 text-base font-extrabold">{pkg.name}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#334155]">
                    <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 text-[#0b6bcb]" />{pkg.tier}</span>
                    <span className="flex items-center gap-1"><MapIcon className="h-3.5 w-3.5 text-[#0b6bcb]" />{pkg.components.filter(item => item.isDefault && item.type === "experience").length} sights</span>
                    <span className="flex items-center gap-1"><Plane className="h-3.5 w-3.5 rotate-45 text-[#0b6bcb]" />transfers</span>
                    {pkg.components.some(item => item.type === "meal") && <span className="flex items-center gap-1"><UtensilsCrossed className="h-3.5 w-3.5 text-[#0b6bcb]" />meals</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">{pkg.languagesOffered.map(tag => <span key={tag} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tag === form.language ? "bg-[#0e8a5f] text-white" : "bg-[#eef2f7] text-[#5f6b7a]"}`}>{tag}</span>)}{inLang && <span className="text-[10px] font-semibold text-[#0e8a5f]">✓ {copy("offeredIn")}</span>}</div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                    <div className="text-[11px] text-[#5f6b7a]"><Star className="mr-0.5 inline h-3 w-3 fill-[#f5b83d] text-[#f5b83d]" />{pkg.popularity.bookings} {copy("bookedBy")} · {pkg.popularity.trips} {copy("pastTrips")}</div>
                    <div className="text-right"><div className="text-xl font-black">{money(pkg.basePrice)}</div><div className="text-[10px] text-[#5f6b7a]">{copy("perPackage")}</div></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setDetailId(pkg.id)} className="h-9 rounded-full text-xs font-bold">{copy("viewDetails")}</Button><Button onClick={() => choosePackage(pkg)} className="h-9 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-xs font-bold text-white">{copy("customiseThis").split(" ")[0]} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></div>
                </div>
              </article>;
            })}
          </div>
        </section>
      </main>
    </>}

    {screen !== "intake" && <main className="mx-auto grid max-w-[1240px] gap-6 px-4 pb-24 pt-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <div className="mb-4 lg:hidden"><Stepper steps={steps} current={stepIndex} /></div>
        {screen === "reality" && <>
          <ScreenHeader title={`${cities.data?.origins.find(item => item.code === form.origin)?.city || form.origin} → ${destinationCity}`} sub={`${form.departDate} → ${form.returnDate} · ${form.travelers} ${copy("travelers").toLowerCase()} · ${copy("guideLanguage")}: ${GUIDE_LANGS.find(lang => lang.value === form.language)?.native}`} onBack={back} backLabel={copy("back")} />
          <EstimateView estimate={estimate.data} loading={estimate.isLoading} lang={uiLang} continuing={createTrip.isPending} onContinue={() => createTrip.mutate({ ...form, budgetCap: form.budgetCap || 1 })} />
          {estimate.error && <Panel className="mt-4 p-5 text-sm text-[#c0392b]">{estimate.error.message}</Panel>}
        </>}
        {screen === "trip" && trip && <>
          {trip.status === "negotiate" && <NegotiationPanel trip={trip} lang={uiLang} busy={busy} newCap={newCap} setNewCap={setNewCap} onChoose={choice => negotiate.mutate({ tripId: trip.tripId, choice })} onRaise={() => negotiate.mutate({ tripId: trip.tripId, choice: "raise_cap", newCap: Number(newCap) })} />}
          {trip.status === "select_flight" && <>
            <ScreenHeader title={copy("chooseFlight")} sub={`${trip.origin} → ${trip.destination} · ${trip.departDate} · ${trip.flightNote || (trip.flightSource === "serpapi" ? "Google Flights · live fares" : trip.flightSource)}`} onBack={back} backLabel={copy("back")} />
            {trip.flightInsights?.typicalRange && <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#eef6ff] px-4 py-2.5 text-xs text-[#0b1f3a]"><Sparkles className="h-4 w-4 text-[#0b6bcb]" />{copy("typicalFare")}: <strong>{money(trip.flightInsights.typicalRange[0])}–{money(trip.flightInsights.typicalRange[1])}</strong> · {copy("priceLevel")}: <strong className="uppercase">{trip.flightInsights.priceLevel}</strong></div>}
            <div className="space-y-3">{[...trip.flightOptions].sort((a, b) => a.price - b.price).map((flight, index) => <FlightRow key={flight.id} flight={flight} lang={uiLang} cheapest={index === 0} disabled={busy} onSelect={() => selectFlight.mutate({ tripId: trip.tripId, flightId: flight.id })} />)}</div>
          </>}
          {trip.status === "select_package" && trip.package && <>
            <ScreenHeader title={copy("customise")} sub={copy("packageSub")} onBack={back} backLabel={copy("back")} />
            <Panel className="p-5"><PackageCustomiser trip={trip} lang={uiLang} busy={busy} onContinue={() => continuePackage.mutate({ tripId: trip.tripId })} /></Panel>
          </>}
          {(trip.status === "review" || trip.status === "confirmed") && <>
            <ScreenHeader title={trip.status === "confirmed" ? copy("locked") : copy("review")} sub={trip.status === "confirmed" ? undefined : copy("reviewSub")} onBack={trip.status === "review" ? back : undefined} backLabel={copy("back")} />
            <ReviewPanel trip={trip} lang={uiLang} busy={busy} email={email} phone={phone} setEmail={setEmail} setPhone={setPhone} onConfirm={() => confirm.mutate({ tripId: trip.tripId, email: email || undefined, phone: phone || undefined })} onEdit={back} onWhatsApp={exportWhatsApp} onStartOver={startOver} />
          </>}
        </>}
      </section>

      {/* ---------- Side rail ---------- */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        {trip ? <Panel className="p-5"><PriceBreakdown trip={trip} lang={uiLang} /></Panel>
          : estimate.data && <Panel className="p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">{copy("fareSummary")}</div><div className="mt-2 text-3xl font-black">{money(estimate.data.typical)}</div><div className="text-xs text-[#5f6b7a]">{copy("typicalEst")} · {money(estimate.data.low)}–{money(estimate.data.high)}</div><div className="mt-3 space-y-1 border-t border-[#e6ebf2] pt-3 text-xs"><Line label={copy("liveFlights")} value={money(estimate.data.flights.typical)} /><Line label={copy("packageBase")} value={money(estimate.data.package.forTrip)} /><Line label={copy("guide")} value={estimate.data.guides.find(guide => guide.available) ? money(estimate.data.guides.find(guide => guide.available)!.tripCost) : "—"} /><Line label={copy("yourBudget")} value={money(form.budgetCap)} /></div></Panel>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-10 rounded-full bg-white text-xs font-bold" onClick={saveDraft}><Check className="mr-1 h-3.5 w-3.5" />{draftSaved ? copy("saved") : copy("saveDraft")}</Button>
          <Button variant="outline" className="h-10 rounded-full bg-white text-xs font-bold" onClick={sharePlan}><Share2 className="mr-1 h-3.5 w-3.5" />{copy("share")}</Button>
          {trip && <Button variant="outline" className="col-span-2 h-10 rounded-full border-[#25d366] bg-white text-xs font-bold text-[#128c4a]" onClick={exportWhatsApp}>{copy("whatsapp")}</Button>}
        </div>
        <Panel className="p-4 text-xs text-[#5f6b7a]">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]"><Calendar className="h-3.5 w-3.5" />{copy("tripBrief")}</div>
          <Line label={copy("dates")} value={`${prettyDate(trip?.departDate || form.departDate).day} ${prettyDate(trip?.departDate || form.departDate).rest} → ${prettyDate(trip?.returnDate || form.returnDate).day} ${prettyDate(trip?.returnDate || form.returnDate).rest}`} />
          <Line label={copy("party")} value={String(trip?.travelers || form.travelers)} />
          <Line label={copy("guideLanguage")} value={GUIDE_LANGS.find(lang => lang.value === (trip?.language || form.language))?.native || form.language} />
          <Line label={copy("appLanguage")} value={LANGS.find(lang => lang.value === uiLang)?.native || uiLang} />
        </Panel>
        <AgentTransparencyChat trip={trip} lang={uiLang} destination={destinationCity} plannerContext={{ availableOrigins: cities.data?.origins || [], availableDestinations: cities.data?.destinations || [], budgetCap: form.budgetCap, interests: form.interests, destinationInsight: recommendations.data?.destinationInsight }} onApplyTrip={applyTripRequest} onBuildPackage={buildTripRequest} onCommand={runTripCommand} />
      </aside>
    </main>}

    {/* ---------- Package detail ---------- */}
    <Dialog open={Boolean(detail)} onOpenChange={open => !open && setDetailId(null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl p-0">
        {detail && <>
          <div className="relative h-56 bg-[#0b1f3a]"><img src={detail.image} alt={detail.city} className="h-full w-full object-cover opacity-90" /><div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" /><button onClick={() => setDetailId(null)} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90"><X className="h-4 w-4" /></button>
            <div className="absolute bottom-4 left-5 right-5 text-white"><div className="text-[11px] font-bold uppercase tracking-[.2em] text-white/75">{copy(`theme_${detail.tags[0]}` as CopyKey)} · {detail.tier} · {detail.difficulty}</div><DialogTitle className="text-2xl font-black">{detail.name}</DialogTitle><div className="text-xs text-white/80">{detail.city} · {detail.durationNights}N/{detail.duration}D · {detail.popularity.bookings} {copy("bookedBy")}</div></div></div>
          <div className="space-y-5 p-5">
            <p className="text-sm leading-6 text-[#334155]">{detail.description}</p>
            <div>
              <div className="text-sm font-bold">{copy("itinerary")}</div>
              <div className="mt-3 space-y-3">{Array.from(new Set(detail.components.filter(item => item.isDefault).map(item => item.dayIndex ?? 1))).sort((a, b) => a - b).map(day => <div key={day} className="flex gap-3"><div className="h-fit w-14 shrink-0 rounded-lg bg-[#e8f1fd] py-1 text-center text-[10px] font-bold uppercase text-[#0b6bcb]">{copy("day")} {day}</div><div className="flex-1 space-y-1.5 border-l-2 border-dashed border-[#dde3ec] pl-3">{detail.components.filter(item => item.isDefault && (item.dayIndex ?? 1) === day).map(item => <div key={item.id} className="flex items-start justify-between gap-3 text-sm"><div><span className="mr-2 text-[10px] font-bold uppercase text-[#9aa7b8]">{item.slot}</span>{item.label}{item.optional && <span className="ml-2 rounded bg-[#fff4e0] px-1.5 text-[10px] font-bold text-[#b45309]">add-on</span>}{detail.components.some(other => other.swapGroup && other.swapGroup === item.swapGroup && other.id !== item.id) && <span className="ml-2 rounded bg-[#eef6ff] px-1.5 text-[10px] font-bold text-[#0b6bcb]">swappable</span>}</div><span className="shrink-0 text-xs text-[#5f6b7a]">{item.optional ? "+" : ""}{money(item.price)}</span></div>)}</div></div>)}</div>
            </div>
            <div className="grid gap-3 text-xs sm:grid-cols-2"><div className="rounded-xl bg-[#e7f8f0] p-3 text-[#14532d]"><strong>✓ Includes</strong><div className="mt-1">{detail.inclusions}</div></div><div className="rounded-xl bg-[#fdecea] p-3 text-[#7f1d1d]"><strong>✕ Excludes</strong><div className="mt-1">{detail.exclusions}</div></div></div>
            <div className="flex items-center justify-between gap-3 border-t border-[#e6ebf2] pt-4"><div><div className="text-2xl font-black">{money(detail.basePrice)}</div><div className="text-[11px] text-[#5f6b7a]">{copy("perPackage")} · {detail.duration} {copy("days")} · {copy("offeredIn")} {detail.languagesOffered.join(", ")}</div></div><Button onClick={() => choosePackage(detail)} className="h-11 rounded-full bg-gradient-to-r from-[#ff8a3d] to-[#f0541e] px-6 text-sm font-extrabold uppercase text-white">{copy("customiseThis")}</Button></div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}

function FieldCell({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="relative block cursor-pointer border-b border-[#e6ebf2] px-4 py-3 transition hover:bg-[#f5f9ff] sm:border-r lg:border-b-0"><div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#5f6b7a]">{label}</div>{children}</label>;
}

function DateCell({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (value: string) => void }) {
  const date = prettyDate(value);
  return <FieldCell label={label}>
    <input type="date" value={value} min={min} onChange={event => event.target.value && onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full" />
    <div className="flex items-baseline gap-1"><span className="text-2xl font-black">{date.day}</span><span className="text-sm font-bold">{date.rest}</span></div>
    <div className="text-[11px] text-[#5f6b7a]">{date.weekday}</div>
  </FieldCell>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-[#f0f3f7] py-1.5 last:border-0"><span className="text-[#5f6b7a]">{label}</span><strong className="text-right text-[#0b1f3a]">{value}</strong></div>;
}
