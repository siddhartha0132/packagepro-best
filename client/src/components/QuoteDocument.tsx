import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lang } from "@/i18n";
import { useTr } from "@/lib/translate";
import type { TripView } from "./PackageCustomiser";
import { type Estimate, money, specLabel } from "./TripScreens";

// Printable A4 quotation (browser "Save as PDF"): keeps Indic scripts crisp and photos sharp without a PDF library.
// A table's thead/tfoot repeat on every printed page, giving each page a brand strip and footer.

const cleanDetail = (detail: string) => detail.replace(/^Day \d+ · \w+ · /, "");

const KIND_TAG: Record<string, string> = { arrival: "Flight", experience: "Activity", transfer: "Transfer", meal: "Meal", entry_ticket: "Ticket", guide: "Guide", hotel: "Stay" };

const locale = (lang: Lang) => (lang === "en-IN" ? "en-IN" : `${lang}-IN`);

function longDate(iso: string, lang: Lang) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { weekday: "", label: iso, full: iso };
  return {
    weekday: new Intl.DateTimeFormat(locale(lang), { weekday: "long", timeZone: "UTC" }).format(date),
    label: new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(date),
    full: new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
  };
}

// Contractual lines are hand-translated: machine translation must never alter a percentage or a promise.
const FIXED: Partial<Record<Lang, Record<string, string>>> = {
  hi: {
    "Fine print": "ज़रूरी जानकारी",
    "Terms & conditions": "नियम और शर्तें",
    "Flight fares are live at the time of this quotation and are confirmed only when ticketed.": "उड़ान किराए इस कोटेशन के समय के लाइव किराए हैं और टिकट जारी होने पर ही पक्के होते हैं।",
    "This is an indicative estimate. Flight fares are live and change until booked.": "यह एक अनुमानित राशि है। उड़ान किराए लाइव हैं और बुकिंग तक बदल सकते हैं।",
    "Guides are checked date by date against their calendar; an unavailable guide is never booked, and a same-language substitute is offered instead.": "हर तारीख के लिए गाइड का कैलेंडर जाँचा जाता है; अनुपलब्ध गाइड कभी बुक नहीं होता, उसकी जगह उसी भाषा का दूसरा गाइड सुझाया जाता है।",
    "Hotels, activities and transfers are subject to availability at confirmation.": "होटल, गतिविधियाँ और ट्रांसफ़र पुष्टि के समय उपलब्धता पर निर्भर हैं।",
    "Payment: 30% to confirm, balance 20 days before departure. Amendments are repriced live.": "भुगतान: पुष्टि के लिए 30%, बाकी राशि प्रस्थान से 20 दिन पहले। बदलावों की कीमत लाइव दोबारा तय होती है।",
    "Cancellation: free within 24 hours of booking; after that, supplier charges apply.": "रद्दीकरण: बुकिंग के 24 घंटे के भीतर मुफ़्त; उसके बाद सप्लायर शुल्क लागू होंगे।",
  },
  ta: {
    "Fine print": "முக்கிய குறிப்புகள்",
    "Terms & conditions": "விதிமுறைகள் மற்றும் நிபந்தனைகள்",
    "Flight fares are live at the time of this quotation and are confirmed only when ticketed.": "விமானக் கட்டணங்கள் இந்த விலைப்பட்டியல் உருவான நேரத்தின் நேரடி கட்டணங்கள்; டிக்கெட் வழங்கப்பட்ட பின்னரே உறுதியாகும்.",
    "This is an indicative estimate. Flight fares are live and change until booked.": "இது ஒரு தோராயமான மதிப்பீடு. விமானக் கட்டணங்கள் நேரடியானவை; முன்பதிவு செய்யும் வரை மாறக்கூடும்.",
    "Guides are checked date by date against their calendar; an unavailable guide is never booked, and a same-language substitute is offered instead.": "ஒவ்வொரு தேதிக்கும் வழிகாட்டியின் அட்டவணை சரிபார்க்கப்படுகிறது; கிடைக்காத வழிகாட்டி ஒருபோதும் முன்பதிவு செய்யப்படமாட்டார், அதற்குப் பதிலாக அதே மொழி பேசும் மாற்று வழிகாட்டி பரிந்துரைக்கப்படுவார்.",
    "Hotels, activities and transfers are subject to availability at confirmation.": "ஹோட்டல்கள், செயல்பாடுகள் மற்றும் போக்குவரத்து உறுதிப்படுத்தும் நேரத்தில் உள்ள இருப்பைப் பொறுத்தது.",
    "Payment: 30% to confirm, balance 20 days before departure. Amendments are repriced live.": "கட்டணம்: உறுதிப்படுத்த 30%, மீதித் தொகை புறப்படுவதற்கு 20 நாட்களுக்கு முன். மாற்றங்களுக்கு நேரடியாக மீண்டும் விலை கணக்கிடப்படும்.",
    "Cancellation: free within 24 hours of booking; after that, supplier charges apply.": "ரத்து: முன்பதிவு செய்த 24 மணி நேரத்திற்குள் இலவசம்; அதன் பிறகு சப்ளையர் கட்டணங்கள் பொருந்தும்.",
  },
  te: {
    "Fine print": "ముఖ్య గమనికలు",
    "Terms & conditions": "నిబంధనలు మరియు షరతులు",
    "Flight fares are live at the time of this quotation and are confirmed only when ticketed.": "విమాన ఛార్జీలు ఈ కొటేషన్ సమయంలోని లైవ్ ధరలు; టికెట్ జారీ అయిన తర్వాతే ఖరారవుతాయి.",
    "This is an indicative estimate. Flight fares are live and change until booked.": "ఇది సూచనాత్మక అంచనా మాత్రమే. విమాన ఛార్జీలు లైవ్ ధరలు; బుకింగ్ వరకు మారవచ్చు.",
    "Guides are checked date by date against their calendar; an unavailable guide is never booked, and a same-language substitute is offered instead.": "ప్రతి తేదీకి గైడ్ క్యాలెండర్ తనిఖీ చేయబడుతుంది; అందుబాటులో లేని గైడ్‌ను ఎప్పుడూ బుక్ చేయము, బదులుగా అదే భాష మాట్లాడే మరో గైడ్‌ను సూచిస్తాము.",
    "Hotels, activities and transfers are subject to availability at confirmation.": "హోటళ్లు, కార్యకలాపాలు మరియు ట్రాన్స్‌ఫర్‌లు నిర్ధారణ సమయంలో లభ్యతకు లోబడి ఉంటాయి.",
    "Payment: 30% to confirm, balance 20 days before departure. Amendments are repriced live.": "చెల్లింపు: నిర్ధారణకు 30%, మిగిలిన మొత్తం బయలుదేరడానికి 20 రోజుల ముందు. మార్పులకు ధర లైవ్‌గా మళ్లీ లెక్కించబడుతుంది.",
    "Cancellation: free within 24 hours of booking; after that, supplier charges apply.": "రద్దు: బుకింగ్ చేసిన 24 గంటలలోపు ఉచితం; ఆ తర్వాత సరఫరాదారు ఛార్జీలు వర్తిస్తాయి.",
  },
};

function useQuoteTr(lang: Lang) {
  const tr = useTr(lang);
  return (text: string) => FIXED[lang]?.[text] ?? tr(text);
}

function Sheet({ reference, tr, lang, children }: { reference: string; tr: (text: string) => string; lang: Lang; children: ReactNode }) {
  const issued = new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return createPortal(<div id="print-root" className={`print-root${lang === "en-IN" ? "" : " q-indic"}`} lang={lang}>
    <table className="q-sheet">
      <thead><tr><td><div className="q-strip"><span className="q-brand"><span className="q-logo">P</span>PackagePro</span><span>{tr("Quotation")} · {reference}</span></div></td></tr></thead>
      <tbody><tr><td>{children}</td></tr></tbody>
      <tfoot><tr><td><div className="q-foot">{tr("Prices generated live on")} {issued} · {tr("PS-04 dataset, Google Flights and guide availability")}</div></td></tr></tfoot>
    </table>
  </div>, document.body);
}

function Cover({ image, title, subtitle, meta }: { image?: string; title: string; subtitle: string; meta: [string, string][] }) {
  return <section className="q-cover">
    {image && <img src={image} alt="" />}
    <div className="q-cover-shade" />
    <div className="q-cover-title"><h1>{title}</h1><p>{subtitle}</p></div>
    <div className="q-cover-meta">{meta.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  </section>;
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return <div className="q-heading"><div className="q-kicker">{kicker}</div><h2>{title}</h2></div>;
}

function Terms({ tr, estimate }: { tr: (text: string) => string; estimate?: boolean }) {
  const lines = [
    estimate ? "This is an indicative estimate. Flight fares are live and change until booked." : "Flight fares are live at the time of this quotation and are confirmed only when ticketed.",
    "Guides are checked date by date against their calendar; an unavailable guide is never booked, and a same-language substitute is offered instead.",
    "Hotels, activities and transfers are subject to availability at confirmation.",
    "Payment: 30% to confirm, balance 20 days before departure. Amendments are repriced live.",
    "Cancellation: free within 24 hours of booking; after that, supplier charges apply.",
  ];
  return <section className="q-avoid">
    <Heading kicker={tr("Fine print")} title={tr("Terms & conditions")} />
    <ul className="q-terms">{lines.map(line => <li key={line}>{tr(line)}</li>)}</ul>
    <div className="q-closing"><strong>{tr("PackagePro travel desk")}</strong><span>{tr("We would be delighted to hold these arrangements for you.")}</span></div>
  </section>;
}

function ListBox({ tone, title, text }: { tone: "in" | "out"; title: string; text: string }) {
  const items = text.split(/[,;]\s*|\.\s+/).map(item => item.trim().replace(/\.$/, "")).filter(Boolean);
  return <div className={`q-box q-box-${tone}`}><div className="q-box-title">{title}</div><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>;
}

/** Final quotation for a customised (or confirmed) trip. */
export function TripQuote({ trip, lang, image }: { trip: TripView; lang: Lang; image?: string }) {
  const tr = useQuoteTr(lang);
  const b = trip.priceBreakdown;
  const reference = trip.booking?.reference ? `PNR ${trip.booking.reference}` : `#${trip.tripId.replace(/^trp_/, "").toUpperCase()}`;
  const flight = trip.chosenFlight;
  const hotel = trip.chosenHotel;
  const rows: [string, number][] = [
    [flight ? `${tr("Flight")} · ${flight.airline} ${flight.id}` : trip.chosenTransport ? `${tr("Transport")} · ${trip.chosenTransport.operator}` : tr("Transport"), b.transport],
    [`${tr("Package")} · ${tr(trip.package?.name ?? "")} (${trip.durationDays} ${tr("days")})`, b.packageBase],
    ...(b.swapAdjustments ? [[tr("Your swaps"), b.swapAdjustments] as [string, number]] : []),
    ...(b.addOns ? [[tr("Add-ons"), b.addOns] as [string, number]] : []),
    ...(trip.chosenGuide ? [[`${tr("Guide")} · ${trip.chosenGuide.name}`, b.guide] as [string, number]] : []),
  ];
  return <Sheet reference={reference} tr={tr} lang={lang}>
    <Cover image={image} title={tr(trip.destination)} subtitle={tr(trip.package?.name ?? "")} meta={[
      [tr("Duration"), `${trip.durationDays} ${tr("days")}`],
      [tr("Departure"), longDate(trip.departDate, lang).full],
      [tr("Travellers"), String(trip.travelers)],
      [tr(trip.booking ? "Booking" : "Reference"), trip.booking?.reference ?? reference],
    ]} />

    <section className="q-letter">
      <h3>{tr("Dear traveller,")}</h3>
      <p>{tr(`Thank you for planning with PackagePro. Here is your ${trip.destination} holiday, customised by you and priced live, with every guide date checked.`)}</p>
      {trip.status === "confirmed" ? <span className="q-pill q-pill-ok">✓ {tr("Confirmed")}</span> : <span className="q-pill">{tr("Ready to confirm")}</span>}
    </section>

    <section className="q-avoid">
      <Heading kicker={tr("Investment")} title={tr("Your price")} />
      <table className="q-table">
        <thead><tr><th>{tr("Item")}</th><th className="r">{tr("Amount")}</th></tr></thead>
        <tbody>{rows.map(([label, value]) => <tr key={label}><td>{label}</td><td className="r">{value < 0 ? "−" : ""}{money(Math.abs(value))}</td></tr>)}</tbody>
        <tfoot><tr><td>{tr("Total")}<span className="q-sub">{tr("Your budget")} {money(trip.budgetCap)} · {money(Math.max(0, trip.budgetCap - b.total))} {tr("remaining")}</span></td><td className="r q-total">{money(b.total)}</td></tr></tfoot>
      </table>
    </section>

    <section className="q-break">
      <Heading kicker={tr("Travel & stay")} title={tr("Your arrangements")} />
      <div className="q-grid">
        {flight && <div className="q-card q-avoid">
          <div className="q-card-kicker">{tr("Flight")} · {longDate(trip.departDate, lang).label}</div>
          <div className="q-card-title">{flight.logo && <img src={flight.logo} alt="" className="q-airline" />}{flight.airline} <span className="q-muted">{flight.id}</span></div>
          <div className="q-fl"><strong>{flight.depart}</strong><span>— {flight.duration} —</span><strong>{flight.arrive ?? ""}</strong></div>
          <div className="q-muted">{flight.route} · {flight.stops ? `${flight.stops} ${tr("stop")}${flight.via ? ` via ${flight.via}` : ""}` : tr("Non-stop")}</div>
        </div>}
        {trip.chosenTransport && <div className="q-card q-avoid"><div className="q-card-kicker">{tr("Transport")}</div><div className="q-card-title">{trip.chosenTransport.operator}</div><div className="q-muted">{trip.chosenTransport.route} · {trip.chosenTransport.depart} · {trip.chosenTransport.duration}</div></div>}
        {hotel && <div className="q-card q-avoid">
          <div className="q-card-kicker">{tr("Stay")} · {trip.durationDays} {tr("nights")}</div>
          <div className="q-card-title">{hotel.name}</div>
          {hotel.rating > 0 && <div className="q-stars">{"★".repeat(hotel.rating)} <span>{hotel.rating} {tr("Star")}</span></div>}
          <div className="q-muted">{tr(cleanDetail(hotel.detail))}</div>
        </div>}
        {trip.chosenGuide && <div className="q-card q-avoid">
          <div className="q-card-kicker">{tr("Local guide")} · {tr("available on every date")}</div>
          <div className="q-card-title">{trip.chosenGuide.name} <span className="q-muted">★ {trip.chosenGuide.rating}</span></div>
          <div className="q-muted">{specLabel(lang, trip.chosenGuide.specialisation)} · {trip.chosenGuide.languages.join(", ")}</div>
          <div className="q-muted">{trip.chosenGuide.bookedDates.map(date => longDate(date, lang).label).join(" · ")}</div>
        </div>}
      </div>
    </section>

    <section>
      <Heading kicker={tr("Schedule")} title={tr("Day by day")} />
      <div className="q-days">{trip.itinerary.map(day => {
        const date = longDate(day.date, lang);
        return <div key={day.date} className="q-day q-avoid">
          <div className="q-day-badge"><span>{tr("Day")}</span><strong>{String(day.day).padStart(2, "0")}</strong><em>{date.weekday}</em><small>{date.label}</small></div>
          <div className="q-day-items">{day.items.map((item, index) => <div key={index} className="q-item">
            <div><div className="q-item-title">{tr(item.label)}</div>{item.detail && <div className="q-muted">• {tr(item.detail)}</div>}</div>
            <span className="q-tag">{tr(KIND_TAG[item.kind] ?? item.kind)}</span>
          </div>)}</div>
        </div>;
      })}</div>
    </section>

    {trip.package && <section className="q-avoid">
      <Heading kicker={tr("Inclusions & exclusions")} title={tr("What is covered")} />
      <div className="q-grid"><ListBox tone="in" title={tr("Included")} text={tr(trip.package.inclusions)} /><ListBox tone="out" title={tr("Not included")} text={tr(trip.package.exclusions)} /></div>
    </section>}

    <Terms tr={tr} />
  </Sheet>;
}

/** Initial AI estimate: three price options plus the live facts behind them. */
export function EstimateQuote({ estimate: e, lang, travelers, origin, image }: { estimate: Estimate; lang: Lang; travelers: number; origin: string; image?: string }) {
  const tr = useQuoteTr(lang);
  const defaultHotel = e.hotels.options.find(hotel => hotel.isDefault) ?? e.hotels.options[0];
  const upgrade = [...e.hotels.options].sort((a, b) => b.delta - a.delta)[0];
  const guide = e.guides.find(item => item.available);
  const options = [
    { name: tr("Value"), note: `${tr("Lowest live fare")} + ${tr(defaultHotel?.name ?? "")}`, total: e.low },
    { name: tr("Recommended"), note: `${tr("Typical fare")} + ${tr("package")}${guide ? ` + ${tr("guide")} ${guide.name}` : ""}`, total: e.typical },
    { name: tr("Premium"), note: `${upgrade && upgrade.delta > 0 ? tr(upgrade.name) : tr("Upgraded stay")} + ${tr("all add-ons")} + ${tr("guide")}`, total: e.high },
  ];
  const reference = `#EST-${e.cityId.replace(/^\w+_/, "").slice(0, 6).toUpperCase()}`;
  return <Sheet reference={reference} tr={tr} lang={lang}>
    <Cover image={image} title={tr(e.destination)} subtitle={tr(e.package.name)} meta={[
      [tr("Duration"), `${e.days} ${tr("days")}`],
      [tr("Departure"), longDate(e.dates[0], lang).full],
      [tr("Travellers"), String(travelers)],
      [tr("Budget"), money(e.budget)],
    ]} />

    <section className="q-letter">
      <h3>{tr("Dear traveller,")}</h3>
      <p>{tr(`Here is our first estimate for ${e.destination}, built from live fares, the real package catalogue and what past travellers chose. Pick an option and we will customise it with you.`)}</p>
      <span className={`q-pill ${e.verdict === "comfortable" ? "q-pill-ok" : e.verdict === "tight" ? "q-pill-warn" : "q-pill-bad"}`}>{tr(`Your budget is ${e.verdict}`)}</span>
    </section>

    <section className="q-avoid">
      <Heading kicker={tr("Investment")} title={tr("Your package options")} />
      <table className="q-table">
        <thead><tr><th>{tr("Option")}</th><th>{tr("What it includes")}</th><th className="r">{tr("Total")}</th></tr></thead>
        <tbody>{options.map((option, index) => <tr key={option.name} className={index === 1 ? "q-hl" : ""}><td className="q-opt">{option.name}{index === 1 && <span className="q-pill q-pill-ok">{tr("Best fit")}</span>}</td><td className="q-muted">{option.note}</td><td className="r q-total-sm">{money(option.total)}</td></tr>)}</tbody>
      </table>
      <div className="q-muted q-note">{origin} → {tr(e.destination)} · {tr("flights")} {money(e.flights.low)}–{money(e.flights.high)} · {tr("package")} {money(e.package.forTrip)}</div>
    </section>

    <section className="q-avoid">
      <Heading kicker={tr("AI planner")} title={tr("Our take on this trip")} />
      <div className="q-ai">{(e.ai.source === "llm" ? e.ai.text : e.ai.text.split("\n").map(line => tr(line)).join("\n")).split("\n").filter(Boolean).map((line, index) => <p key={index}>{line.replace(/\*\*/g, "")}</p>)}</div>
    </section>

    <section>
      <Heading kicker={tr("Stay")} title={tr("Your accommodation options")} />
      <div className="q-grid">{e.hotels.options.slice(0, 4).map(hotel => <div key={hotel.id} className="q-card q-avoid">
        <div className="q-card-kicker">{hotel.isDefault ? tr("Included") : `${hotel.delta >= 0 ? "+" : "−"}${money(Math.abs(hotel.delta))}`}</div>
        <div className="q-card-title">{hotel.name}</div>
        <div className="q-muted">{tr(cleanDetail(hotel.detail))}</div>
      </div>)}</div>
    </section>

    <section className="q-avoid">
      <Heading kicker={tr("Live fares")} title={tr("Flights")} />
      <table className="q-table">
        <tbody>{e.flights.options.slice(0, 3).map(flight => <tr key={flight.id}><td><strong>{flight.airline}</strong> <span className="q-muted">{flight.id}</span></td><td>{flight.depart} → {flight.arrive ?? ""} <span className="q-muted">· {flight.duration}</span></td><td className="q-muted">{flight.stops ? `${flight.stops} ${tr("stop")}` : tr("Non-stop")}</td><td className="r"><strong>{money(flight.price)}</strong></td></tr>)}</tbody>
      </table>
    </section>

    {e.guides.length > 0 && <section className="q-avoid">
      <Heading kicker={tr("Local guides")} title={tr("Guides in your language")} />
      <table className="q-table">
        <tbody>{e.guides.map(item => <tr key={item.id}><td><strong>{item.name}</strong> <span className="q-muted">★ {item.rating}</span></td><td className="q-muted">{specLabel(lang, item.specialisation)} · {item.languages.join(", ")}</td><td className={item.available ? "q-ok" : "q-bad"}>{item.available ? tr("Available all dates") : `${tr("Busy")} ${item.unavailableDates.slice(0, 2).map(date => longDate(date, lang).label).join(", ")}`}</td><td className="r"><strong>{money(item.tripCost)}</strong></td></tr>)}</tbody>
      </table>
    </section>}

    <div className="q-grid q-grid-top">
      {e.popularity.topPlaces.length > 0 && <section className="q-avoid">
        <Heading kicker={tr("Past travellers")} title={tr("What travellers loved")} />
        <div className="q-chips">{e.popularity.topPlaces.slice(0, 5).map(place => <span key={place.title}>{tr(place.title)}</span>)}{e.popularity.topInterests.slice(0, 3).map(item => <span key={item.interest} className="q-chip-alt">{tr(item.interest)}</span>)}</div>
        <div className="q-muted q-note">{e.popularity.trips} {tr("past trips")} · {e.popularity.confirmedBookings} {tr("bookings")}{e.popularity.avgBookingInr ? ` · ${tr("average spend")} ${money(e.popularity.avgBookingInr)}` : ""}</div>
      </section>}
      <section className="q-avoid">
        <Heading kicker={tr("Inclusions")} title={tr("What is covered")} />
        <ListBox tone="in" title={tr("Included in the package")} text={tr(e.package.inclusions)} />
      </section>
    </div>

    <Terms tr={tr} estimate />
  </Sheet>;
}
