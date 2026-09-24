import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BedDouble, FileDown, Calendar, Check, Compass, Flame, Languages, Map as MapIcon, MapPin, Plane, Search, Share2, Sparkles, Star, Ticket, Users, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { LANGS, type CopyKey, type Lang, t } from "@/i18n";
import AgentTransparencyChat from "@/components/AgentTransparencyChat";
import { buildWhatsAppUrl } from "@/lib/itineraryExport";
import { PackageCustomiser, PriceBreakdown } from "@/components/PackageCustomiser";
import { EstimateView, FlightRow, NegotiationPanel, Panel, ReviewPanel, ScreenHeader, SectionTitle, Stepper, money, prettyDate, slotLabel } from "@/components/TripScreens";
import { translationsSettled, useTr } from "@/lib/translate";
import { EstimateQuote, TripQuote } from "@/components/QuoteDocument";
import { SmartImage } from "@/components/SmartImage";

function isoDateFromToday(offset: number) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function addDays(iso: string, days: number) { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

/** Guide / tour-delivery languages (BCP-47) spoken by guides in the PS-04 dataset. */
const GUIDE_LANGS = [
  { value: "en-IN", native: "English" }, { value: "hi", native: "हिन्दी · Hindi" }, { value: "ta", native: "தமிழ் · Tamil" }, { value: "te", native: "తెలుగు · Telugu" },
  { value: "kn", native: "ಕನ್ನಡ · Kannada" }, { value: "ml", native: "മലയാളം · Malayalam" }, { value: "mr", native: "मराठी · Marathi" }, { value: "gu", native: "ગુજરાતી · Gujarati" },
  { value: "bn", native: "বাংলা · Bengali" }, { value: "pa", native: "ਪੰਜਾਬੀ · Punjabi" }, { value: "or", native: "ଓଡ଼ିଆ · Odia" }, { value: "ur", native: "اردو · Urdu" },
];
const THEMES = ["heritage", "honeymoon", "adventure", "pilgrimage", "family", "wellness", "wildlife", "food_trail"] as const;
/** Mood chips: the English value feeds interest matching; the label is translated. */
const MOODS: { value: string; key: CopyKey }[] = [{ value: "Heritage & living temples", key: "mood1" }, { value: "Beaches & slow food", key: "mood2" }, { value: "Pilgrimage & dawn rituals", key: "mood3" }, { value: "Street food trails", key: "mood4" }, { value: "Mountains & treks", key: "mood5" }];

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
  const tr = useTr(uiLang);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("packagepro-draft");
      if (saved) { const draft = JSON.parse(saved); if (draft.form) setForm(draft.form); if (draft.uiLang) setUiLang(draft.uiLang); if (draft.screen) setScreen(draft.screen); if (draft.tripId) setTripId(draft.tripId); }
    } catch { /* ignore a malformed or blocked local draft */ }
    const sharedTrip = window.location.hash.match(/^#trip=(trp_[\w-]+)/)?.[1];
    if (sharedTrip) { setTripId(sharedTrip); setScreen("trip"); toast.success(t("en-IN", "sharedLoaded")); return; }
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
  const estimate = trpc.packagepro.estimate.useQuery({ origin: form.origin, destination: form.destination, departDate: form.departDate, returnDate: form.returnDate, travelers: form.travelers, budget: form.budgetCap || 1, language: form.language, interests: form.interests, uiLanguage: uiLang }, { enabled: screen === "reality" && Boolean(form.destination), staleTime: 5 * 60 * 1000 });

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
  const [printing, setPrinting] = useState<"trip" | "estimate" | null>(null);
  const pdfKind: "trip" | "estimate" | null = screen === "trip" && trip?.package ? "trip" : screen === "reality" && estimate.data ? "estimate" : null;
  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const finish = () => { window.removeEventListener("afterprint", finish); document.title = previousTitle; setPrinting(null); };
    const previousTitle = document.title;
    void (async () => {
      await translationsSettled(uiLang);
      const images = Array.from(document.querySelectorAll<HTMLImageElement>("#print-root img"));
      await Promise.race([Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = image.onerror = resolve; }))), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (cancelled) return;
      const place = printing === "trip" ? trip?.destination : estimate.data?.destination;
      document.title = `PackagePro · ${place ?? "Trip"} · ${printing === "trip" ? (trip?.booking?.reference ?? "Quotation") : "Estimate"}`;
      window.addEventListener("afterprint", finish);
      window.print();
    })();
    return () => { cancelled = true; };
  }, [printing]);
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
  /** A saved trip shares by ID (the exact customised package, from the app database); before that, the search brief is shared. */
  async function sharePlan() {
    const hash = tripId ? `#trip=${tripId}` : `#plan=${encodeURIComponent(JSON.stringify(form))}`;
    window.history.replaceState(null, "", hash);
    await navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}${hash}`).catch(() => undefined);
    toast.success(copy("copied"));
  }
  function exportWhatsApp() { if (!trip) return; window.open(buildWhatsAppUrl(trip), "_blank", "noopener,noreferrer"); toast.success(copy("whatsappReady")); }
  function back() {
    if (screen === "reality") setScreen("intake");
    else if (!trip || trip.status === "select_flight") { setTripId(null); setScreen("reality"); }
    else goBack.mutate({ tripId: trip.tripId });
  }

  const steps = [copy("stepTrip"), copy("stepReality"), copy("stepFlight"), copy("customiseShort"), copy("stepConfirm")];
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-2 pt-3 text-xs font-semibold text-[#5f6b7a]"><span className="flex items-center gap-1.5 text-[#0b6bcb]"><Plane className="h-3.5 w-3.5" />{copy("flights")}</span><span className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5" />{copy("stays")}</span><span className="flex items-center gap-1.5"><Ticket className="h-3.5 w-3.5" />{copy("activities")}</span><span className="flex items-center gap-1.5"><Compass className="h-3.5 w-3.5" />{copy("localGuides")}</span><span className="ml-auto hidden text-[11px] md:inline">{copy("everything")}</span></div>
            <div className="grid overflow-hidden rounded-xl border border-[#e6ebf2] sm:grid-cols-2 lg:grid-cols-[1.1fr_1.3fr_1fr_1fr_1fr_1.1fr]">
              <FieldCell label={copy("from")}>
                <select value={form.origin} onChange={event => update("origin", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{(cities.data?.origins || []).map(item => <option key={item.code} value={item.code}>{tr(item.city)} ({item.code})</option>)}</select>
                <div className="truncate text-2xl font-black">{tr(cities.data?.origins.find(item => item.code === form.origin)?.city) || "—"}</div>
                <div className="truncate text-[11px] text-[#5f6b7a]">{form.origin}, {tr(cities.data?.origins.find(item => item.code === form.origin)?.airport)}</div>
              </FieldCell>
              <FieldCell label={copy("to")}>
                <select value={form.destination} onChange={event => update("destination", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{(cities.data?.destinations || []).map(item => <option key={item.code} value={item.code}>{tr(item.city)} · {tr(item.label.split("·")[1]?.trim())}</option>)}</select>
                <div className="truncate text-2xl font-black">{tr(destinationCity)}</div>
                <div className="truncate text-[11px] text-[#5f6b7a]">{destination?.airport ? `${destination.airport} · ` : ""}{tr(destination?.label.split("·")[1]?.trim())}</div>
              </FieldCell>
              <DateCell label={copy("depart")} value={form.departDate} onChange={value => { update("departDate", value); if (value >= form.returnDate) update("returnDate", addDays(value, 3)); }} />
              <DateCell label={copy("return")} value={form.returnDate} min={addDays(form.departDate, 1)} onChange={value => update("returnDate", value)} />
              <FieldCell label={copy("travellersBudget")}>
                <div className="flex items-baseline gap-1"><input type="text" inputMode="numeric" aria-label={copy("travelers")} value={form.travelers} onChange={event => update("travelers", Math.min(20, Math.max(1, Number(event.target.value.replace(/\D/g, "").slice(-2)) || 1)))} className="w-8 bg-transparent text-2xl font-black outline-none" /><Users className="h-4 w-4 text-[#5f6b7a]" /></div>
                <div className="flex items-center text-[11px] text-[#5f6b7a]">₹<input type="text" inputMode="numeric" aria-label={copy("yourBudget")} value={form.budgetCap ? form.budgetCap.toLocaleString("en-IN") : ""} onChange={event => update("budgetCap", Math.min(10_000_000, Number(event.target.value.replace(/\D/g, "")) || 0))} placeholder="40,000" className="w-24 bg-transparent font-semibold text-[#0b1f3a] outline-none" /></div>
              </FieldCell>
              <FieldCell label={copy("guideLanguage")}>
                <select value={form.language} onChange={event => changeGuideLanguage(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">{GUIDE_LANGS.map(lang => <option key={lang.value} value={lang.value}>{lang.native}</option>)}</select>
                <div className="truncate text-2xl font-black">{GUIDE_LANGS.find(lang => lang.value === form.language)?.native.split(" · ")[0]}</div>
                <div className="text-[11px] text-[#5f6b7a]">{form.language} · {copy("guidesTours")}</div>
              </FieldCell>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5f6b7a]">{copy("feel")}</span>
              {MOODS.map(mood => <button key={mood.key} type="button" onClick={() => update("interests", mood.value)} className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${form.interests === mood.value ? "bg-[#0b6bcb] text-white" : "bg-[#eef3fa] text-[#0b1f3a] hover:bg-[#dfe9f7]"}`}>{copy(mood.key)}</button>)}
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
                <div className="relative h-28 overflow-hidden bg-[#dfe8f4]"><SmartImage src={packageList.find(item => item.id === pkg.id)?.image || pkg.image} fallback={packageList.find(item => item.id === pkg.id)?.fallbackImage} alt={pkg.city} eager className="group-hover:scale-105" /><span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-bold text-[#0b1f3a]">{tr(pkg.city)}</span></div>
                <div className="p-3"><div className="line-clamp-1 text-sm font-bold">{tr(pkg.name)}</div><div className="mt-1 flex flex-wrap gap-1">{pkg.matchReasons.slice(0, 3).map(reason => <span key={reason} className="rounded bg-[#eef6ff] px-1.5 py-0.5 text-[9px] font-semibold text-[#0b6bcb]">✓ {copy(`reason_${reason.replaceAll(" ", "_")}` as CopyKey) || reason}</span>)}</div><div className="mt-2 text-base font-extrabold">{money(pkg.basePrice)}</div></div>
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
                  <SmartImage src={pkg.image} fallback={pkg.fallbackImage} alt={pkg.city} className="group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#0b1f3a]">{copy(`theme_${pkg.tags[0]}` as CopyKey)}</span>
                  {hot && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#ff5a1f] px-2.5 py-1 text-[10px] font-extrabold text-white"><Flame className="h-3 w-3" />{copy("mostBooked")}</span>}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-white"><MapPin className="h-3.5 w-3.5" /><span className="text-sm font-bold">{tr(pkg.city)}</span></div>
                  <span className="absolute bottom-3 right-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">{pkg.durationNights}N/{pkg.duration}D</span>
                </button>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="line-clamp-1 text-base font-extrabold">{tr(pkg.name)}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#334155]">
                    <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5 text-[#0b6bcb]" />{copy(`tier_${pkg.tier}` as CopyKey)}</span>
                    <span className="flex items-center gap-1"><MapIcon className="h-3.5 w-3.5 text-[#0b6bcb]" />{pkg.components.filter(item => item.isDefault && item.type === "experience").length} {copy("sights")}</span>
                    <span className="flex items-center gap-1"><Plane className="h-3.5 w-3.5 rotate-45 text-[#0b6bcb]" />{copy("transfersWord")}</span>
                    {pkg.components.some(item => item.type === "meal") && <span className="flex items-center gap-1"><UtensilsCrossed className="h-3.5 w-3.5 text-[#0b6bcb]" />{copy("mealsWord")}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">{pkg.languagesOffered.map(tag => <span key={tag} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tag === form.language ? "bg-[#0e8a5f] text-white" : "bg-[#eef2f7] text-[#5f6b7a]"}`}>{tag}</span>)}{inLang && <span className="text-[10px] font-semibold text-[#0e8a5f]">✓ {copy("offeredIn")}</span>}</div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                    <div className="text-[11px] text-[#5f6b7a]"><Star className="mr-0.5 inline h-3 w-3 fill-[#f5b83d] text-[#f5b83d]" />{pkg.popularity.bookings} {copy("bookedBy")} · {pkg.popularity.trips} {copy("pastTrips")}</div>
                    <div className="text-right"><div className="text-xl font-black">{money(pkg.basePrice)}</div><div className="text-[10px] text-[#5f6b7a]">{copy("perPackage")}</div></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setDetailId(pkg.id)} className="h-9 rounded-full text-xs font-bold">{copy("viewDetails")}</Button><Button onClick={() => choosePackage(pkg)} className="h-9 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-xs font-bold text-white">{copy("customiseShort")} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></div>
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
          <ScreenHeader title={`${tr(cities.data?.origins.find(item => item.code === form.origin)?.city) || form.origin} → ${tr(destinationCity)}`} sub={`${form.departDate} → ${form.returnDate} · ${form.travelers} ${copy("travelers").toLowerCase()} · ${copy("guideLanguage")}: ${GUIDE_LANGS.find(lang => lang.value === form.language)?.native}`} onBack={back} backLabel={copy("back")} />
          <EstimateView estimate={estimate.data} loading={estimate.isLoading} lang={uiLang} continuing={createTrip.isPending} onContinue={() => createTrip.mutate({ ...form, budgetCap: form.budgetCap || 1 })} />
          {estimate.error && <Panel className="mt-4 p-5 text-sm text-[#c0392b]">{estimate.error.message}</Panel>}
        </>}
        {screen === "trip" && trip && <>
          {trip.status === "negotiate" && <NegotiationPanel trip={trip} lang={uiLang} busy={busy} newCap={newCap} setNewCap={setNewCap} onChoose={choice => negotiate.mutate({ tripId: trip.tripId, choice })} onRaise={() => negotiate.mutate({ tripId: trip.tripId, choice: "raise_cap", newCap: Number(newCap) })} />}
          {trip.status === "select_flight" && <>
            <ScreenHeader title={copy("chooseFlight")} sub={`${trip.origin} → ${tr(trip.destination)} · ${trip.departDate} · ${trip.flightNote ? tr(trip.flightNote) : trip.flightSource === "serpapi" ? copy("srcGoogle") : trip.flightSource}`} onBack={back} backLabel={copy("back")} />
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
          {pdfKind && <Button disabled={Boolean(printing)} className="col-span-2 h-10 rounded-full bg-[#0b1f3a] text-xs font-bold text-white hover:bg-[#13315c]" onClick={() => setPrinting(pdfKind)}><FileDown className="mr-1 h-3.5 w-3.5" />{printing ? copy("preparingPdf") : pdfKind === "trip" ? copy("downloadQuote") : copy("downloadEstimate")}</Button>}
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

    {printing === "trip" && trip && <TripQuote trip={trip} lang={uiLang} image={packageList.find(item => item.id === trip.package?.id)?.image} />}
    {printing === "estimate" && estimate.data && <EstimateQuote estimate={estimate.data} lang={uiLang} travelers={form.travelers} origin={cities.data?.origins.find(item => item.code === form.origin)?.city || form.origin} image={estimate.data.insight.image || packageList.find(item => item.id === estimate.data?.package.id)?.image} />}

    {/* ---------- Package detail ---------- */}
    <Dialog open={Boolean(detail)} onOpenChange={open => !open && setDetailId(null)}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-3xl gap-0 overflow-y-auto rounded-2xl border-0 bg-white p-0 text-[#0b1f3a] shadow-[0_24px_60px_rgba(11,31,58,.35)] sm:max-w-3xl">
        {detail && <>
          <div className="relative h-56 bg-[#0b1f3a]"><SmartImage src={detail.image} fallback={detail.fallbackImage} alt={tr(detail.city)} eager /><div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" /><button onClick={() => setDetailId(null)} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90"><X className="h-4 w-4" /></button>
            <div className="absolute bottom-4 left-5 right-5 text-white"><div className="text-[11px] font-bold uppercase tracking-[.2em] text-white/75">{copy(`theme_${detail.tags[0]}` as CopyKey)} · {copy(`tier_${detail.tier}` as CopyKey)} · {copy(`diff_${detail.difficulty}` as CopyKey)}</div><DialogTitle className="text-2xl font-black">{tr(detail.name)}</DialogTitle><div className="text-xs text-white/80">{tr(detail.city)} · {detail.durationNights}N/{detail.duration}D · {detail.popularity.bookings} {copy("bookedBy")}</div></div></div>
          <div className="space-y-5 p-5">
            <p className="text-sm leading-6 text-[#334155]">{tr(detail.description)}</p>
            <div>
              <div className="text-sm font-bold">{copy("itinerary")}</div>
              <div className="mt-3 space-y-3">{Array.from(new Set(detail.components.filter(item => item.isDefault).map(item => item.dayIndex ?? 1))).sort((a, b) => a - b).map(day => <div key={day} className="flex gap-3"><div className="h-fit w-14 shrink-0 rounded-lg bg-[#e8f1fd] py-1 text-center text-[10px] font-bold uppercase text-[#0b6bcb]">{copy("day")} {day}</div><div className="flex-1 space-y-1.5 border-l-2 border-dashed border-[#dde3ec] pl-3">{detail.components.filter(item => item.isDefault && (item.dayIndex ?? 1) === day).map(item => <div key={item.id} className="flex items-start justify-between gap-3 text-sm"><div><span className="mr-2 text-[10px] font-bold uppercase text-[#9aa7b8]">{slotLabel(uiLang, item.slot)}</span>{tr(item.label)}{item.optional && <span className="ml-2 rounded bg-[#fff4e0] px-1.5 text-[10px] font-bold text-[#b45309]">{copy("addOnTag")}</span>}{detail.components.some(other => other.swapGroup && other.swapGroup === item.swapGroup && other.id !== item.id) && <span className="ml-2 rounded bg-[#eef6ff] px-1.5 text-[10px] font-bold text-[#0b6bcb]">{copy("swappable")}</span>}</div><span className="shrink-0 text-xs text-[#5f6b7a]">{item.optional ? "+" : ""}{money(item.price)}</span></div>)}</div></div>)}</div>
            </div>
            <div className="grid gap-3 text-xs sm:grid-cols-2"><div className="rounded-xl bg-[#e7f8f0] p-3 text-[#14532d]"><strong>✓ {copy("includes")}</strong><div className="mt-1">{tr(detail.inclusions)}</div></div><div className="rounded-xl bg-[#fdecea] p-3 text-[#7f1d1d]"><strong>✕ {copy("excludes")}</strong><div className="mt-1">{tr(detail.exclusions)}</div></div></div>
            <div className="flex items-center justify-between gap-3 border-t border-[#e6ebf2] pt-4"><div><div className="text-2xl font-black">{money(detail.basePrice)}</div><div className="text-[11px] text-[#5f6b7a]">{copy("perPackage")} · {detail.duration} {copy("days")} · {copy("offeredIn")} {detail.languagesOffered.join(", ")}</div></div><Button onClick={() => choosePackage(detail)} className="h-11 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] px-6 text-sm font-extrabold uppercase text-white shadow-[0_8px_20px_rgba(6,90,243,.35)] hover:opacity-95">{copy("customiseThis")}</Button></div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}

function FieldCell({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  const className = "relative block cursor-pointer border-b border-[#e6ebf2] px-4 py-3 transition hover:bg-[#f5f9ff] sm:border-r lg:border-b-0";
  const heading = <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#5f6b7a]">{label}</div>;
  // A clickable cell is a div, not a label: a label would also forward the click to its input and toggle the picker twice.
  return onClick ? <div onClick={onClick} className={className}>{heading}{children}</div> : <label className={className}>{heading}{children}</label>;
}

function DateCell({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (value: string) => void }) {
  const date = prettyDate(value);
  const input = useRef<HTMLInputElement>(null);
  // Open the native calendar from anywhere in the cell without stretching its indicator (which shows a "Show date picker" tooltip).
  const open = () => { try { input.current?.showPicker(); } catch { input.current?.focus(); } };
  return <FieldCell label={label} onClick={open}>
    <input ref={input} type="date" value={value} min={min} aria-label={label} onChange={event => event.target.value && onChange(event.target.value)} className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0" />
    <div className="flex items-baseline gap-1"><span className="text-2xl font-black">{date.day}</span><span className="text-sm font-bold">{date.rest}</span></div>
    <div className="text-[11px] text-[#5f6b7a]">{date.weekday}</div>
  </FieldCell>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-[#f0f3f7] py-1.5 last:border-0"><span className="text-[#5f6b7a]">{label}</span><strong className="text-right text-[#0b1f3a]">{value}</strong></div>;
}
