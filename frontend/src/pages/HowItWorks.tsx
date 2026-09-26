import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowRight, BadgeCheck, Bot, CalendarCheck, CircleAlert, Database, Languages, Layers, PackageOpen, Play, PlusCircle, Sparkles, Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useTr } from "@/lib/translate";

// "How it works" — one section per PS-04 requirement: the requirement, how PackagePro solves it, where it lives in the code,
// and a CSS-3D demo driven by live API data where it is cheap (packages, the real guide availability check, translations).

const MEERA = "gid_dbf7be53";
const THANJAVUR = "pkg_f2d745d6";
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function Section({ id, index, icon, requirement, title, children, demo, code, flip }: { id: string; index: number; icon: ReactNode; requirement: string; title: string; children: ReactNode; demo: ReactNode; code: string[]; flip?: boolean }) {
  return <section id={id} className="scroll-mt-20 border-t border-[#e6ebf2] py-14 md:py-20">
    <div className={`mx-auto grid max-w-[1180px] items-center gap-10 px-4 md:px-6 lg:grid-cols-2 ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div>
        <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[.18em] text-[#0b6bcb]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#e8f1fd]">{icon}</span>Requirement {index}</div>
        <blockquote className="mt-4 border-l-4 border-[#0b6bcb] pl-4 text-sm italic leading-6 text-[#5f6b7a]">“{requirement}”</blockquote>
        <h2 className="mt-5 text-2xl font-black tracking-tight text-[#0b1f3a] md:text-3xl">{title}</h2>
        <div className="mt-4 space-y-3 text-[15px] leading-7 text-[#334155]">{children}</div>
        <div className="mt-5 flex flex-wrap gap-2">{code.map(item => <code key={item} className="rounded-md bg-[#0b1f3a] px-2 py-1 text-[11px] text-[#bfe0ff]">{item}</code>)}</div>
      </div>
      <div className="hw-scene relative h-[340px] overflow-hidden rounded-3xl bg-gradient-to-br from-[#061a36] via-[#0b2f63] to-[#0b4fb3] shadow-[0_30px_70px_rgba(6,26,54,.35)] md:h-[400px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(83,178,254,.25),transparent_55%)]" />
        {demo}
      </div>
    </div>
  </section>;
}

/** 1 · Curated packages on a rotating 3D ring (real packages + photos). */
function PackageRing() {
  const list = trpc.packagepro.list.useQuery();
  const items = (list.data ?? []).slice(0, 10);
  const step = 360 / Math.max(1, items.length);
  return <div className="absolute inset-0 grid place-items-center">
    <div className="hw-3d hw-ring relative h-44 w-36 scale-[.72] md:scale-100">
      {items.map((pkg, index) => <div key={pkg.id} className="absolute inset-0 overflow-hidden rounded-2xl bg-white shadow-2xl" style={{ transform: `rotateY(${index * step}deg) translateZ(290px)` }}>
        <img src={pkg.image} alt="" className="h-24 w-full object-cover" />
        <div className="p-2 text-[#0b1f3a]"><div className="truncate text-[11px] font-extrabold">{pkg.name}</div><div className="text-[10px] text-[#5f6b7a]">{pkg.tags[0].replace("_", " ")} · {pkg.durationNights}N/{pkg.duration}D</div><div className="text-sm font-black">{money(pkg.basePrice)}</div></div>
      </div>)}
    </div>
    <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] font-semibold text-white/70">45 PS-04 packages · hover to pause</div>
  </div>;
}

/** 2 · Price as a 3D stack of layers: base + every kept component; toggles reprice live. */
function PriceStack() {
  const [upgrade, setUpgrade] = useState(false);
  const [guide, setGuide] = useState(true);
  // Example: the demo trip (Delhi → Thanjavur, 3 days, 4 travellers). Fares are live, so real totals vary by day.
  const layers = [
    { label: "Flights · 4 × ₹10,903", value: 43612, tone: "from-[#53b2fe] to-[#1a8cff]" },
    { label: "Package base · ₹27,833 × 3/6 days × 4", value: 55665, tone: "from-[#7dd3a8] to-[#16a37a]" },
    { label: upgrade ? "Hotel ↑ Riverside Kothi · activities · transfer" : "Hotel · activities · transfer", value: upgrade ? 7139 + 10698 : 7139, tone: upgrade ? "from-[#fbbf24] to-[#f59e0b]" : "from-[#a5b4fc] to-[#6366f1]" },
    ...(guide ? [{ label: "Guide · Arjun Nair · 3 days", value: 7440, tone: "from-[#f9a8d4] to-[#db2777]" }] : []),
  ];
  const total = layers.reduce((sum, layer) => sum + layer.value, 0);
  return <div className="absolute inset-0">
    <div className="absolute left-4 top-4 z-10 w-[46%] max-w-56 space-y-1.5 rounded-2xl bg-black/25 p-3 ring-1 ring-white/15 backdrop-blur-sm">
      {layers.map(layer => <div key={layer.label} className="flex items-start gap-2 text-[10.5px] leading-tight text-white"><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm bg-gradient-to-br ${layer.tone}`} /><span className="flex-1">{layer.label}</span><strong>{money(layer.value)}</strong></div>)}
      <div className="border-t border-white/20 pt-1.5 text-[10px] text-white/70">Demo trip · fares are live, so totals vary by day</div>
    </div>
    <div className="absolute left-[64%] top-[52%] -translate-x-1/2 -translate-y-1/2 scale-[.62] md:scale-90">
      <div className="hw-3d hw-float relative h-36 w-60">
        {layers.map((layer, index) => <div key={layer.label} className={`absolute inset-0 rounded-xl bg-gradient-to-br ${layer.tone} p-3 text-white shadow-[0_18px_30px_rgba(0,0,0,.35)] transition-all duration-700`} style={{ transform: `translateZ(${index * 30}px)`, opacity: .96 }}>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">{layer.label}</div>
          <div className="text-lg font-black">{money(layer.value)}</div>
        </div>)}
      </div>
    </div>
    <div className="absolute right-4 top-4 z-10 rounded-2xl bg-white/95 px-4 py-2 text-right text-[#0b1f3a] shadow-xl"><div className="text-[10px] font-bold uppercase tracking-wider text-[#5f6b7a]">Live total</div><div key={total} className="text-2xl font-black [animation:rise-in_.5s_both]">{money(total)}</div></div>
    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap justify-center gap-2">
      <button onClick={() => setUpgrade(value => !value)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#0b1f3a] shadow">{upgrade ? "↺ Default hotel" : "⇄ Upgrade hotel (+₹8,915/room)"}</button>
      <button onClick={() => setGuide(value => !value)} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/30">{guide ? "✕ Remove guide" : "＋ Add guide"}</button>
    </div>
  </div>;
}

/** 3 · AI builder: 45 packages as tiles; the budget-fitting picks for a free-text request rise out of the grid. */
function BuilderTiles() {
  const list = trpc.packagepro.list.useQuery();
  const packages = list.data ?? [];
  const picks = useMemo(() => new Set(packages.filter(pkg => ["honeymoon", "wellness"].includes(pkg.tags[0]) && pkg.basePrice <= 40000).sort((a, b) => a.basePrice - b.basePrice).slice(0, 3).map(pkg => pkg.id)), [packages]);
  const picked = packages.filter(pkg => picks.has(pkg.id));
  return <div className="absolute inset-0">
    <div className="absolute left-4 right-4 top-4 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-xs font-semibold text-[#0b1f3a] shadow-lg md:left-6 md:right-auto">💬 “beach honeymoon, relaxed, under ₹40k”</div>
    <div className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2">
      <div className="hw-3d grid grid-cols-9 gap-1.5 scale-[.8] md:scale-100" style={{ transform: "rotateX(55deg) rotateZ(-35deg)" }}>
        {packages.slice(0, 45).map(pkg => <div key={pkg.id} title={pkg.name} className={`h-6 w-6 rounded-md ${picks.has(pkg.id) ? "hw-rise bg-[#fbbf24] shadow-[0_0_18px_rgba(251,191,36,.9)]" : "bg-white/25"}`} />)}
      </div>
    </div>
    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap justify-center gap-2">{picked.map(pkg => <span key={pkg.id} className="rounded-full bg-[#fbbf24] px-3 py-1 text-[11px] font-extrabold text-[#0b1f3a]">✓ {pkg.city} · {money(pkg.basePrice)}</span>)}</div>
  </div>;
}

/** 4 · Add-on recommendations orbiting the package (real optional components). */
function AddOnOrbit() {
  const detail = trpc.packagepro.detail.useQuery({ id: THANJAVUR });
  const addOns = (detail.data?.components ?? []).filter(item => item.optional).slice(0, 6);
  const step = 360 / Math.max(1, addOns.length);
  return <div className="absolute inset-0 grid place-items-center">
    <div className="relative grid place-items-center">
      <div className="z-10 w-44 rounded-2xl bg-white p-3 text-center text-[#0b1f3a] shadow-2xl"><div className="text-[10px] font-bold uppercase tracking-wider text-[#0b6bcb]">Package</div><div className="text-sm font-black">{detail.data?.name ?? "Thanjavur Heritage"}</div></div>
      <div className="hw-3d hw-orbit absolute h-0 w-0">
        {addOns.map((item, index) => <div key={item.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ transform: `rotateY(${index * step}deg) translateZ(170px)` }}>
          <div className="hw-counter whitespace-nowrap rounded-full bg-[#16a37a] px-3 py-1.5 text-[11px] font-bold text-white shadow-lg" style={{ transform: `rotateY(${-index * step}deg)` }}>＋ {item.label} · {money(item.price)}</div>
        </div>)}
      </div>
    </div>
    <div className="absolute bottom-4 text-[11px] font-semibold text-white/70">From package_components where is_optional = 1</div>
  </div>;
}

/** 5 · The mandatory Guide Availability Check as a live 3D calendar (packagepro.checkGuide on the real dataset). */
function GuideCalendar() {
  const check = trpc.packagepro.checkGuide.useQuery({ guideId: MEERA, departDate: "2026-09-28", duration: 3, language: "ta", specialisation: "heritage" });
  const data = check.data;
  const substitute = data?.replacementOptions[0];
  // When nobody is free on every date (confirmed trips hold the last slots), show the other same-language guides' live calendars.
  const peers = trpc.packagepro.guides.useQuery({ city: "Thanjavur", language: "ta", specialisation: "heritage" }, { enabled: Boolean(data) && !substitute });
  const others = substitute ? [{ name: substitute.guide.name, availability: substitute.guide.availability, refused: false }]
    : (peers.data ?? []).filter(guide => guide.id !== MEERA && guide.languages.includes("ta")).slice(0, 2).map(guide => ({ name: guide.name, availability: guide.availability, refused: true }));
  const rows = data ? [{ name: data.guide.name, availability: data.guide.availability, refused: true }, ...others] : [];
  return <div className="absolute inset-0">
    <div className="absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2">
      <div className="hw-3d space-y-3 scale-[.8] md:scale-100" style={{ transform: "rotateX(50deg) rotateZ(-28deg)" }}>
        {rows.map(row => <div key={row.name} className="hw-3d flex items-center gap-2">
          <div className="w-28 text-right text-xs font-extrabold text-white">{row.name}</div>
          {(data?.dates ?? []).map(date => {
            const free = row.availability[date] === true;
            return <div key={date} className={`hw-3d grid h-14 w-16 place-items-center rounded-lg text-[11px] font-black shadow-[0_14px_22px_rgba(0,0,0,.4)] ${free ? `bg-[#16a37a] text-white ${row.refused ? "" : "hw-rise"}` : "hw-sink bg-[#ef4444] text-white"}`}>{dayLabel(date)}<span className="text-base">{free ? "✓" : "✕"}</span></div>;
          })}
        </div>)}
      </div>
    </div>
    <div className="absolute left-4 right-4 top-4 rounded-2xl bg-white/95 p-3 text-xs text-[#0b1f3a] shadow-xl">
      {data ? <>
        <div className="flex items-center gap-1.5 font-extrabold text-[#c0392b]"><CircleAlert className="h-4 w-4" />Refused: {data.guide.name} is unavailable on {data.conflicts.map(dayLabel).join(", ")}</div>
        {substitute ? <div className="mt-1 text-[#334155]">✅ Same language (ta) &amp; specialisation ({data.requiredSpecialisation}): <strong>{substitute.guide.name}</strong> · {substitute.priceDelta < 0 ? "−" : "+"}{money(Math.abs(substitute.priceDelta))} vs {data.guide.name.split(" ")[0]}</div>
          : <div className="mt-1 text-[#334155]">No same-language {data.requiredSpecialisation} guide is free on every date right now: their last slots are held by confirmed trips (the double-booking guard). Reset the demo with <code>pnpm db:reset</code>.</div>}
      </> : <div>Checking guide_availability…</div>}
    </div>
    <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] font-semibold text-white/70">Live: packagepro.checkGuide → guide_availability − confirmed slots</div>
  </div>;
}

/** 6 · One package, four languages, on a rotating cube (live translations). */
function LanguageCube() {
  const name = "Thanjavur Heritage — 6 Days";
  const hi = useTr("hi");
  const ta = useTr("ta");
  const te = useTr("te");
  const faces = [
    { tag: "en-IN", label: "English", text: name },
    { tag: "hi", label: "हिन्दी", text: hi(name) },
    { tag: "ta", label: "தமிழ்", text: ta(name) },
    { tag: "te", label: "తెలుగు", text: te(name) },
  ];
  return <div className="absolute inset-0 grid place-items-center">
    <div className="hw-3d hw-cube relative h-44 w-44">
      {faces.map((face, index) => <div key={face.tag} className="hw-face absolute inset-0 grid place-content-center gap-2 rounded-2xl border border-white/30 bg-gradient-to-br from-white to-[#e8f1fd] p-4 text-center text-[#0b1f3a] shadow-2xl" style={{ transform: `rotateY(${index * 90}deg) translateZ(88px)` }}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#0b6bcb]">{face.label} · {face.tag}</div>
        <div className="text-base font-black leading-snug">{face.text}</div>
      </div>)}
    </div>
    <div className="absolute bottom-4 text-[11px] font-semibold text-white/70">BCP-47 tags · Sarvam mayura translation, cached</div>
  </div>;
}

/** 7 · Save, share and book: a ticket that flips to show what the booking wrote. */
function BookingTicket() {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => { const timer = setInterval(() => setFlipped(value => !value), 3800); return () => clearInterval(timer); }, []);
  return <div className="absolute inset-0 grid place-items-center">
    <button onClick={() => setFlipped(value => !value)} className="hw-3d relative h-48 w-80 scale-[.85] md:scale-100">
      <div className={`hw-3d hw-flip absolute inset-0 ${flipped ? "is-flipped" : ""}`}>
        <div className="hw-face absolute inset-0 rounded-2xl bg-white p-4 text-left text-[#0b1f3a] shadow-2xl">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#0b6bcb]">PackagePro · confirmed</div>
          <div className="mt-2 flex items-baseline justify-between"><span className="text-2xl font-black">DEL → TRZ</span><span className="text-xs text-[#5f6b7a]">28 Sept – 1 Oct</span></div>
          <div className="mt-2 text-xs text-[#334155]">Thanjavur Heritage · 4 travellers · guide Arjun Nair</div>
          <div className="mt-3 flex items-end justify-between border-t border-dashed border-[#dde3ec] pt-3"><span className="text-[10px] text-[#5f6b7a]">tap to flip</span><span className="font-mono text-lg font-black">PNR K7Q2XA</span></div>
        </div>
        <div className="hw-face absolute inset-0 rounded-2xl bg-[#0b1f3a] p-4 text-left font-mono text-[11px] leading-5 text-[#bfe0ff] shadow-2xl" style={{ transform: "rotateY(180deg)" }}>
          <div className="font-sans text-[10px] font-bold uppercase tracking-wider text-white/70">Written in one transaction</div>
          <div>trips          trp_… status=confirmed</div>
          <div>itineraries    itn_… v1 · INR</div>
          <div>itinerary_items itm_… × lines</div>
          <div>bookings       bkg_… channel=web</div>
          <div className="text-[#fbbf24]">idempotency_key idem_trp_…</div>
          <div>app_guide_bookings gbk_… × dates</div>
        </div>
      </div>
    </button>
    <div className="absolute bottom-4 text-[11px] font-semibold text-white/70">Save draft · #trip= share link · idempotent confirm · PDF quotation</div>
  </div>;
}

/** 8 · Data-model conformance: the canonical tables we write, stacked, with the validator's verdict. */
function DataModelStack() {
  const tables = ["bookings", "itinerary_items", "itineraries", "trips"];
  return <div className="absolute inset-0">
    <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2">
      <div className="hw-3d hw-float relative h-28 w-56">
        {tables.map((table, index) => <div key={table} className="absolute inset-0 rounded-xl border border-white/40 bg-white/15 p-3 font-mono text-sm font-bold text-white backdrop-blur-sm" style={{ transform: `translateZ(${index * 34}px)` }}>{table}</div>)}
      </div>
    </div>
    <div className="absolute right-4 top-4 rotate-[-6deg] rounded-xl border-2 border-[#16a37a] bg-white px-3 py-1.5 text-center text-[#16a37a] shadow-xl"><div className="text-[10px] font-bold uppercase tracking-wider">validate_conformance.py</div><div className="text-2xl font-black">PASS</div></div>
    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap justify-center gap-1.5">{["R1 additive", "R2 prefixed IDs", "R3 money 2dp + INR", "R4 ISO-8601", "R5 enums", "R6 BCP-47", "R8 no deletes"].map(rule => <span key={rule} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25">{rule}</span>)}</div>
  </div>;
}

/** 9 · The same engine in Telegram. */
function TelegramPhone() {
  return <div className="absolute inset-0 grid place-items-center">
    <div className="hw-3d w-60 rounded-[2rem] border-4 border-[#0b1f3a] bg-[#e6ebf2] p-3 shadow-[0_40px_60px_rgba(0,0,0,.45)]" style={{ transform: "rotateY(-22deg) rotateX(8deg)" }}>
      <div className="mb-2 text-center text-[10px] font-bold text-[#5f6b7a]">@wayypoint_Bot</div>
      <div className="space-y-2 text-[10.5px] leading-4 text-[#0b1f3a]">
        <div className="ml-auto w-fit rounded-xl rounded-br-sm bg-[#d9fdd3] px-2 py-1">/demo</div>
        <div className="rounded-xl rounded-bl-sm bg-white px-2 py-1.5 shadow-sm">❌ <b>Meera Novak</b> can't be booked — not available on <b>28 Sept</b>.<div className="mt-1 font-mono">Meera  28 ❌ · 29 ✅ · 30 ✅<br />Arjun  28 ✅ · 29 ✅ · 30 ✅</div></div>
        <div className="rounded-lg bg-[#0b6bcb] px-2 py-1.5 text-center font-bold text-white">✅ Book Arjun Nair</div>
      </div>
    </div>
    <div className="absolute bottom-4 text-[11px] font-semibold text-white/70">हिन्दी · தமிழ் · తెలుగు · English — hand-written copy</div>
  </div>;
}

export default function HowItWorks() {
  const [, navigate] = useLocation();
  const judges = [
    { step: "Guide added on dates that clash", href: "#guide" },
    { step: "Refusal names the date", href: "#guide" },
    { step: "Same language + specialisation substitute", href: "#guide" },
    { step: "Total reprices live", href: "#pricing" },
  ];
  return <div className="min-h-screen bg-[#f2f5fa] text-[#0b1f3a]">
    <header className="sticky top-0 z-30 border-b border-[#e6ebf2] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 md:px-6">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#1a8cff] to-[#0b4fb3] font-black text-white">P</div><span className="text-lg font-black">PackagePro</span></button>
        <button onClick={() => navigate("/?demo=1")} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] px-4 py-2 text-sm font-extrabold text-white shadow"><Play className="h-4 w-4" />Run the live demo</button>
      </div>
    </header>

    <section className="relative overflow-hidden bg-gradient-to-br from-[#041634] via-[#0a2d63] to-[#0b4fb3] pb-20 pt-16 text-white">
      <div className="mx-auto max-w-[1180px] px-4 md:px-6">
        <div className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[.16em] ring-1 ring-white/25">KogniVera Hackathon 2026 · PS-04 · Team RNG Gods</div>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">How PackagePro solves every PS-04 requirement</h1>
        <p className="mt-5 max-w-2xl text-base text-white/80">Curated packages you reshape piece by piece, priced live from the PS-04 dataset and Google Flights, with local guides who are checked date by date and speak your language — on the web and in Telegram.</p>
        <div className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[["45", "curated packages"], ["120", "guides · 30-day calendars"], ["4 + 12", "app + guide languages"], ["PASS", "organisers' validator"]].map(([value, label]) => <div key={label} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15"><div className="text-2xl font-black">{value}</div><div className="text-xs text-white/70">{label}</div></div>)}
        </div>
      </div>
    </section>

    <section className="mx-auto -mt-10 max-w-[1180px] px-4 md:px-6">
      <div className="rounded-3xl bg-white p-5 shadow-[0_20px_50px_rgba(11,31,58,.12)]">
        <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#0b6bcb]">What the judges will see — mandatory enhancement</div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">{judges.map((item, index) => <a key={item.step} href={item.href} className="flex items-center gap-3 rounded-2xl bg-[#f2f5fa] p-3 text-sm font-bold transition hover:bg-[#e8f1fd]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0b1f3a] text-xs text-white">{index + 1}</span>{item.step}</a>)}</div>
      </div>
    </section>

    <Section id="packages" index={1} icon={<PackageOpen className="h-4 w-4 text-[#0b6bcb]" />} requirement="Browse curated packages by theme with detail pages (itinerary, inclusions, transparent pricing)." title="Real curated packages, filtered by theme" code={["tour_packages", "package_components", "packagepro.list / detail"]} demo={<PackageRing />}>
      <p>All 45 INR packages from the dataset, ranked by real bookings and filterable by theme (adventure, honeymoon, pilgrimage, family, heritage…). Each opens a detail page with the day-by-day itinerary, inclusions and exclusions.</p>
      <p>Pricing is transparent: <strong>base + every component you keep</strong>, so the itinerary lines add up to the total.</p>
    </Section>

    <Section id="pricing" index={2} flip icon={<Layers className="h-4 w-4 text-[#0b6bcb]" />} requirement="Customise components — hotel tier, activities, transfers, duration — with live repricing." title="Swap anything; the total re-computes every time" code={["trips.ts → priceBreakdown()", "trip.swap / setDuration", "integer paise"]} demo={<PriceStack />}>
      <p>Every change re-runs one pricing function instead of adding to a running total: flights and the package per person, hotels per room (prorated by nights), transfers per vehicle, guides per group — all in integer paise, never a float.</p>
      <p>A change that breaks the budget is parked for negotiation: approve the extra, keep the old plan, drop the change or raise the budget. Try the buttons in the demo.</p>
    </Section>

    <Section id="ai" index={3} icon={<Sparkles className="h-4 w-4 text-[#0b6bcb]" />} requirement="AI package-builder from stated interests, budget and booking history." title="Describe the trip; the AI picks real packages" code={["ai/pipeline.ts", "ai/prompts/packageBuilder.ts", "travellers.ts"]} demo={<BuilderTiles />}>
      <p>Sarvam's model sees only the 45 catalogue packages, and a stated budget is enforced in code before and after it, so it can't invent a package or go over budget. Invented IDs are dropped.</p>
      <p>The traveller's saved preferences and <strong>booking history</strong> (past trips and favourite themes from <code>users</code> → <code>bookings</code> → <code>trips</code>) are attached on the server, so picks build on what they liked and skip places they've already visited.</p>
    </Section>

    <Section id="addons" index={4} flip icon={<PlusCircle className="h-4 w-4 text-[#0b6bcb]" />} requirement="Add-on recommendations relevant to the chosen package." title="Add-ons that belong to this package" code={["package_components.is_optional", "trip.toggleAddOn"]} demo={<AddOnOrbit />}>
      <p>Recommended extras come from the package's own optional components, so they fit the itinerary day and slot. Adding one reprices per person and places it in the itinerary; removing it puts the price back exactly.</p>
    </Section>

    <Section id="guide" index={5} icon={<CalendarCheck className="h-4 w-4 text-[#0b6bcb]" />} requirement="Tour-guide selection: optional local guide by language, specialisation, availability and price — plus the mandatory Guide Availability Check." title="Guides are checked on every date, not picked from a dropdown" code={["packagepro.ts → guideCheck()", "isGuideFree()", "tests/hardProof.guideAvailability.test.ts"]} demo={<GuideCalendar />}>
      <p>Adding a guide checks every trip date against <code>guide_availability</code>, <strong>minus slots already taken by confirmed bookings</strong>. Any clash refuses the selection and names the date.</p>
      <p>The substitute has the <strong>same language and specialisation</strong> and is free on every date, ranked nearest first and then by the smallest price change, with the new total shown. The demo runs the real check live. Confirmation re-checks inside the booking transaction, so no guide is ever double-booked.</p>
      <p><strong>Day-by-day planning:</strong> a live grid of guides × dates lets the traveller book a guide on just the days they're free ("Meera on 29–30") and cover the rest with another ("Arjun on 28"). Each day is priced with its own multiplier.</p>
    </Section>

    <Section id="language" index={6} flip icon={<Languages className="h-4 w-4 text-[#0b6bcb]" />} requirement="Language preferences: preferred language(s) for the app and for guide/tour delivery; packages, guides and content filter and recommend on that basis." title="Two language settings, read from the traveller's preferences" code={["user_preferences", "languages (BCP-47)", "i18n.ts · translate.ts"]} demo={<LanguageCube />}>
      <p>The <strong>app language</strong> (English, हिन्दी, தமிழ், తెలుగు) and the <strong>guide language</strong> (12 BCP-47 tags) are separate settings. A traveller profile sets both from <code>user_preferences</code>.</p>
      <p>Packages offered in the guide language rank first and guides are filtered by it. Dataset content, AI replies, the PDF quotation and the Telegram bot all follow the chosen language.</p>
    </Section>

    <Section id="book" index={7} icon={<Ticket className="h-4 w-4 text-[#0b6bcb]" />} requirement="Save, share and book a customised package." title="Save, share, book — and a quotation to keep" code={["trip.confirm (idempotent)", "#trip= share links", "QuoteDocument.tsx"]} demo={<BookingTicket />}>
      <p>Drafts save automatically, and a share link reopens the exact trip. Booking writes the canonical <code>trips</code>, <code>itineraries</code>, <code>itinerary_items</code> and <code>bookings</code> rows in one transaction. It's keyed by an <strong>idempotency key</strong>, so a double tap never double-books.</p>
      <p>A client-ready PDF quotation downloads in the traveller's language.</p>
    </Section>

    <Section id="data" index={8} flip icon={<Database className="h-4 w-4 text-[#0b6bcb]" />} requirement="Data-model conformance: canonical tables and columns, boundary rules enforced in code, additions documented." title="The shared data model, extended, never renamed" code={["data-model/DATA_MODEL.md", "pnpm conformance", "tests/conformance.test.ts"]} demo={<DataModelStack />}>
      <p>Canonical tables are created verbatim from the dataset's own schema, and our additions are separate, documented tables. Boundary rules are enforced in the backend and each has a test: group size (4–8 for the demo package), BCP-47 languages, INR only, guide capacity and idempotent booking.</p>
      <p>The organisers' <code>validate_conformance.py</code> passes on the dataset merged with every row we write.</p>
    </Section>

    <Section id="telegram" index={9} icon={<Bot className="h-4 w-4 text-[#0b6bcb]" />} requirement="Where travellers already are — the same engine in chat." title="One engine, two channels: web and Telegram" code={["backend/src/telegramBot.ts", "tests/telegramBot.test.ts"]} demo={<TelegramPhone />}>
      <p>@wayypoint_Bot runs the same trip engine with buttons and free text: browse, plan with a tap-to-pick calendar, live estimate, flights, swaps, the guide refusal with date strips, and booking. It's in four languages, with every message tested against Telegram's limits.</p>
    </Section>

    <section className="bg-[#0b1f3a] py-16 text-center text-white">
      <div className="mx-auto max-w-2xl px-4">
        <BadgeCheck className="mx-auto h-10 w-10 text-[#53b2fe]" />
        <h2 className="mt-4 text-3xl font-black">See it end to end in two minutes</h2>
        <p className="mt-3 text-white/70">Delhi → Thanjavur for 4 · swap the hotel · add Meera Novak → refused on 28 Sept → Arjun Nair, repriced → book.</p>
        <button onClick={() => navigate("/?demo=1")} className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] px-6 py-3 text-sm font-extrabold uppercase tracking-wider shadow-lg">Run the live demo <ArrowRight className="h-4 w-4" /></button>
      </div>
    </section>
  </div>;
}
