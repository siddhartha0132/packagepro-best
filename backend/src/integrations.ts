import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FLIGHTS, HOTELS, PACKAGES, type FlightRecord, type HotelRecord } from "./packagepro";

const SARVAM_LANG: Record<string, string> = {
  "en-IN": "en-IN",
  en: "en-IN",
  ta: "ta-IN",
  hi: "hi-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  bn: "bn-IN",
  pa: "pa-IN",
  or: "od-IN",
};

// Sarvam translations persist to disk so restarts (and an offline demo) keep every string already translated.
const TRANSLATION_FILE = path.resolve(process.cwd(), "data-model/seed/translation-cache.json");
const translationCache = new Map<string, string>(Object.entries((() => { try { return JSON.parse(readFileSync(TRANSLATION_FILE, "utf8")) as Record<string, string>; } catch { return {}; } })()));
let translationSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistTranslations() {
  if (process.env.VITEST) return;
  if (translationSaveTimer) return; // throttle: at most one write every 3 s while translations stream in
  translationSaveTimer = setTimeout(() => {
    translationSaveTimer = null;
    try { writeFileSync(TRANSLATION_FILE, JSON.stringify(Object.fromEntries(translationCache))); } catch { /* read-only disk: keep in memory */ }
  }, 3000);
}
let inrPerUsd: { value: number; at: number } | null = null;
let inrPerEur: { value: number; at: number } | null = null;

export const ORIGINS = [
  { code: "DEL", city: "New Delhi", airport: "Indira Gandhi International" },
  { code: "BOM", city: "Mumbai", airport: "Chhatrapati Shivaji Maharaj" },
  { code: "BLR", city: "Bengaluru", airport: "Kempegowda International" },
  { code: "MAA", city: "Chennai", airport: "Chennai International" },
  { code: "HYD", city: "Hyderabad", airport: "Rajiv Gandhi International" },
  { code: "CCU", city: "Kolkata", airport: "Netaji Subhas Chandra Bose" },
  { code: "PNQ", city: "Pune", airport: "Pune International" },
  { code: "AMD", city: "Ahmedabad", airport: "Sardar Vallabhbhai Patel" },
  { code: "COK", city: "Kochi", airport: "Cochin International" },
  { code: "LKO", city: "Lucknow", airport: "Chaudhary Charan Singh" },
  { code: "IXC", city: "Chandigarh", airport: "Shaheed Bhagat Singh" },
  { code: "JAI", city: "Jaipur", airport: "Jaipur International" },
  { code: "GOI", city: "Goa", airport: "Manohar International" },
  { code: "VNS", city: "Varanasi", airport: "Lal Bahadur Shastri" },
];

// Nearest commercial airport for each PS-04 package city (flight search needs IATA; several cities share one).
const CITY_AIRPORT: Record<string, string> = {
  Agra: "AGR", Ahmedabad: "AMD", Alleppey: "COK", Amritsar: "ATQ", Aurangabad: "IXU", Bengaluru: "BLR", Bhubaneswar: "BBI", Bhuj: "BHJ",
  Chennai: "MAA", Darjeeling: "IXB", Gangtok: "PYG", Gokarna: "GOI", Guwahati: "GAU", Hampi: "HBX", Hyderabad: "HYD", Jaipur: "JAI",
  Jaisalmer: "JSA", Jodhpur: "JDH", Kochi: "COK", Kolkata: "CCU", Leh: "IXL", Lucknow: "LKO", Madurai: "IXM", Manali: "KUU", Mumbai: "BOM",
  Munnar: "COK", Mysuru: "MYQ", Nainital: "PGH", "New Delhi": "DEL", Ooty: "CJB", Panaji: "GOI", Pondicherry: "MAA", Pune: "PNQ", Puri: "BBI",
  Rishikesh: "DED", Shillong: "SHL", Shimla: "SLV", Srinagar: "SXR", Thanjavur: "TRZ", Thiruvananthapuram: "TRV", Tirupati: "TIR",
  Udaipur: "UDR", Varanasi: "VNS", Visakhapatnam: "VTZ", Wayanad: "CCJ",
};

/** One destination per PS-04 package city. `code` is the dataset city_id; `airport` is the IATA code used for flights. */
export const DESTINATIONS = PACKAGES
  .map(pkg => ({ code: pkg.cityId, city: pkg.city, label: `${pkg.city} · ${pkg.theme}`, airport: CITY_AIRPORT[pkg.city] || "" }))
  .sort((a, b) => a.city.localeCompare(b.city));

function env(name: string) {
  return process.env[name] || "";
}

function timedFetch(url: string | URL, init: RequestInit = {}, ms = 2500) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

async function fxRate(base: "USD" | "EUR") {
  const cached = base === "USD" ? inrPerUsd : inrPerEur;
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.value;
  const key = env("EXCHANGE_RATE_API_KEY");
  if (!key) return base === "USD" ? 84 : 91;
  try {
    const res = await timedFetch(`https://v6.exchangerate-api.com/v6/${key}/latest/${base}`, {}, 4000);
    const body = await res.json() as { result?: string; conversion_rates?: { INR?: number } };
    const value = body.conversion_rates?.INR;
    if (body.result === "success" && value) {
      const next = { value, at: Date.now() };
      if (base === "USD") inrPerUsd = next;
      else inrPerEur = next;
      return value;
    }
  } catch {
    // fall through
  }
  return base === "USD" ? 84 : 91;
}

export async function convertToInr(amount: number, currency: string) {
  const code = currency.toUpperCase();
  if (code === "INR" || code === "IN") return Math.round(amount);
  if (code === "USD") return Math.round(amount * (await fxRate("USD")));
  if (code === "EUR") return Math.round(amount * (await fxRate("EUR")));
  return Math.round(amount);
}

function hotelbedsHeaders(apiKey: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha256").update(`${apiKey}${secret}${timestamp}`).digest("hex");
  return {
    "Api-key": apiKey,
    "X-Signature": signature,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip",
  };
}

export async function searchHotelsLive(city: string, checkIn: string, checkOut: string, adults: number): Promise<{ hotels: HotelRecord[]; source: string }> {
  const nights = Math.max(1, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000) || 1);
  // PS-04 dataset hotels first (cheapest active room × nights); live Hotelbeds rates are appended as extra options.
  const hotels = HOTELS.filter(hotel => hotel.city === city)
    .map(hotel => ({ ...hotel, total: Math.round((hotel.nightly ?? hotel.total) * nights * 100) / 100, detail: `${hotel.detail} · ${nights} night${nights > 1 ? "s" : ""}` }))
    .sort((a, b) => a.total - b.total);
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return { hotels, source: "ps04" };
  const pairs = [
    [env("HOTELBEDS_API_KEY"), env("HOTELBEDS_API_SECRET")],
    [env("HOTELBEDS_API_KEY_ALT"), env("HOTELBEDS_API_SECRET_ALT")],
  ].filter(([key, secret]) => key && secret) as [string, string][];

  for (const [apiKey, secret] of pairs) {
    try {
      const dest = DESTINATIONS.find(item => item.city === city)?.airport;
      if (!dest) break;
      const res = await timedFetch("https://api.test.hotelbeds.com/hotel-api/1.0/hotels", {
        method: "POST",
        headers: hotelbedsHeaders(apiKey, secret),
        body: JSON.stringify({
          stay: { checkIn, checkOut },
          occupancies: [{ rooms: 1, adults: Math.max(1, adults), children: 0 }],
          destination: { code: dest },
          filter: { maxHotels: 6 },
        }),
      }, 3500);
      if (!res.ok) continue;
      const body = await res.json() as {
        hotels?: { hotels?: { code?: string; name?: string; categoryName?: string; minRate?: string; currency?: string }[] };
      };
      const live = body.hotels?.hotels || [];
      if (!live.length) continue;
      const mapped: HotelRecord[] = [];
      for (const hotel of live.slice(0, 6)) {
        const total = await convertToInr(Number(hotel.minRate || 0), hotel.currency || "EUR");
        if (!hotel.name || total <= 0) continue;
        mapped.push({
          id: `hb-${hotel.code || hotel.name}`,
          name: hotel.name,
          city,
          rating: 4.4,
          detail: hotel.categoryName || "Hotelbeds live rate · breakfast varies",
          total,
        });
      }
      if (mapped.length) return { hotels: [...hotels, ...mapped].slice(0, 10), source: hotels.length ? "ps04+hotelbeds" : "hotelbeds" };
    } catch {
      // try next credential pair
    }
  }
  return { hotels, source: "ps04" };
}

export type FlightInsights = { lowestPrice?: number; typicalRange?: [number, number]; priceLevel?: string };
type FlightSearch = { flights: FlightRecord[]; source: string; insights?: FlightInsights; note?: string };

const flightCache = new Map<string, { value: FlightSearch; at: number }>();
const FLIGHT_CACHE_MS = 30 * 60 * 1000;

const hhmm = (value?: string) => value && /\d{2}:\d{2}/.test(value) ? value.match(/(\d{2}:\d{2})/)![1] : "";
const fmtDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/**
 * Live flights, best source first:
 *  1. SerpAPI Google Flights — real fares, times, flight numbers, logos and Google's typical price range (≈6 s, so cached).
 *  2. Sky-Scrapper (RapidAPI) — real fares when the key is subscribed.
 *  3. Aviationstack — real schedules only; fares are catalogue estimates and flagged as such.
 */
/**
 * Google Flights also returns long international connections on short domestic routes (an Etihad via Abu Dhabi for Delhi →
 * Jaipur at 15× the direct fare). Keep fares within 3× the cheapest — or within 1.5× the top of Google's typical range when
 * that is higher — cheapest first, at most 8.
 */
export function sensibleFares(flights: FlightRecord[], typicalRange?: [number, number]) {
  const sorted = [...flights].sort((a, b) => a.price - b.price);
  const ceiling = Math.max(sorted[0].price * 3, (typicalRange?.[1] ?? 0) * 1.5);
  return sorted.filter(flight => flight.price <= ceiling).slice(0, 8);
}

export async function searchFlightsLive(origin: string, destination: string, departDate: string): Promise<FlightSearch> {
  const fallback = FLIGHTS.map(flight => ({ ...flight, route: `${origin} → ${destination}`, source: "catalogue" }));
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return { flights: fallback, source: "catalogue" };
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return { flights: fallback, source: "catalogue", note: "No airport code for this destination" };
  if (departDate < new Date().toISOString().slice(0, 10)) return { flights: fallback, source: "catalogue", note: "Live fares are only available for future dates" };
  const cacheKey = `${origin}-${destination}-${departDate}`;
  const cached = flightCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FLIGHT_CACHE_MS) return cached.value;
  const remember = (value: FlightSearch) => { flightCache.set(cacheKey, { value, at: Date.now() }); return value; };

  const serpKey = env("SERP_API_KEY");
  if (serpKey) {
    try {
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google_flights");
      url.searchParams.set("api_key", serpKey);
      url.searchParams.set("departure_id", origin);
      url.searchParams.set("arrival_id", destination);
      url.searchParams.set("outbound_date", departDate);
      url.searchParams.set("type", "2"); // one-way
      url.searchParams.set("currency", "INR");
      url.searchParams.set("hl", "en");
      const res = await timedFetch(url, {}, 15000);
      if (res.ok) {
        type Leg = { departure_airport?: { id?: string; time?: string }; arrival_airport?: { id?: string; time?: string }; airline?: string; airline_logo?: string; flight_number?: string; duration?: number; airplane?: string; travel_class?: string };
        type Option = { flights?: Leg[]; price?: number; total_duration?: number; airline_logo?: string };
        const body = await res.json() as { best_flights?: Option[]; other_flights?: Option[]; price_insights?: { lowest_price?: number; typical_price_range?: [number, number]; price_level?: string }; error?: string };
        const flights: FlightRecord[] = [];
        const seen = new Set<string>();
        for (const item of [...(body.best_flights || []), ...(body.other_flights || [])]) {
          const legs = item.flights || [];
          const first = legs[0];
          const last = legs[legs.length - 1];
          const price = Number(item.price || 0);
          if (!first || !last || price <= 0) continue;
          const id = (first.flight_number || `${origin}${destination}${flights.length}`).replace(/\s+/g, "");
          if (seen.has(id)) continue;
          seen.add(id);
          const minutes = item.total_duration || legs.reduce((sum, leg) => sum + (leg.duration || 0), 0) || 150;
          flights.push({
            id,
            airline: first.airline || "Live carrier",
            route: `${first.departure_airport?.id || origin} → ${last.arrival_airport?.id || destination}`,
            depart: hhmm(first.departure_airport?.time) || "—",
            arrive: hhmm(last.arrival_airport?.time),
            duration: fmtDuration(minutes),
            stops: legs.length - 1,
            via: legs.slice(0, -1).map(leg => leg.arrival_airport?.id).filter(Boolean).join(", "),
            logo: first.airline_logo || item.airline_logo,
            aircraft: first.airplane,
            price: Math.round(price),
            confidence: 0.95,
            source: "google_flights",
          });
          if (flights.length >= 20) break;
        }
        if (flights.length) {
          const insights = body.price_insights;
          const sensible = sensibleFares(flights, insights?.typical_price_range);
          return remember({ flights: sensible, source: "serpapi", insights: insights ? { lowestPrice: insights.lowest_price, typicalRange: insights.typical_price_range, priceLevel: insights.price_level } : undefined });
        }
      }
    } catch {
      // fall through
    }
  }

  const rapidKey = env("SKYSCANNER_API_KEY");
  if (rapidKey) {
    try {
      const url = new URL("https://sky-scrapper.p.rapidapi.com/api/v1/flights/searchFlights");
      url.searchParams.set("originSkyId", origin);
      url.searchParams.set("destinationSkyId", destination);
      url.searchParams.set("date", departDate);
      url.searchParams.set("adults", "1");
      url.searchParams.set("currency", "INR");
      const res = await timedFetch(url, { headers: { "X-RapidAPI-Key": rapidKey, "X-RapidAPI-Host": "sky-scrapper.p.rapidapi.com" } }, 5000);
      if (res.ok) {
        const body = await res.json() as { data?: { itineraries?: { id?: string; price?: { raw?: number }; legs?: { origin?: { displayCode?: string }; destination?: { displayCode?: string }; durationInMinutes?: number; stopCount?: number; carriers?: { marketing?: { name?: string; logoUrl?: string }[] }; departure?: string; arrival?: string }[] }[] } };
        const flights: FlightRecord[] = [];
        for (const item of (body.data?.itineraries || []).slice(0, 8)) {
          const leg = item.legs?.[0];
          const price = Number(item.price?.raw || 0);
          if (!leg || price <= 0) continue;
          flights.push({
            id: String(item.id || `${origin}-${destination}-${flights.length}`).slice(0, 18),
            airline: leg.carriers?.marketing?.[0]?.name || "Live carrier",
            route: `${leg.origin?.displayCode || origin} → ${leg.destination?.displayCode || destination}`,
            depart: hhmm(leg.departure) || "—",
            arrive: hhmm(leg.arrival),
            duration: fmtDuration(leg.durationInMinutes || 150),
            stops: leg.stopCount ?? 0,
            logo: leg.carriers?.marketing?.[0]?.logoUrl,
            price: Math.round(price),
            confidence: 0.9,
            source: "skyscanner",
          });
        }
        if (flights.length) return remember({ flights, source: "skyscanner" });
      }
    } catch {
      // fall through
    }
  }

  const avian = env("AVIANSTACK_API_KEY");
  if (avian) {
    try {
      const url = new URL("http://api.aviationstack.com/v1/flights");
      url.searchParams.set("access_key", avian);
      url.searchParams.set("dep_iata", origin);
      url.searchParams.set("arr_iata", destination);
      url.searchParams.set("limit", "6");
      const res = await timedFetch(url, {}, 5000);
      if (res.ok) {
        const body = await res.json() as { data?: { flight?: { iata?: string }; airline?: { name?: string; iata?: string }; departure?: { scheduled?: string; iata?: string }; arrival?: { scheduled?: string; iata?: string } }[] };
        const live = (body.data || []).filter(item => item.flight?.iata);
        if (live.length) {
          const flights = live.slice(0, 6).map((item, index) => {
            const base = fallback[index % fallback.length];
            const dep = item.departure?.scheduled ? Date.parse(item.departure.scheduled) : NaN;
            const arr = item.arrival?.scheduled ? Date.parse(item.arrival.scheduled) : NaN;
            return {
              ...base,
              id: item.flight!.iata!,
              airline: item.airline?.name || base.airline,
              route: `${item.departure?.iata || origin} → ${item.arrival?.iata || destination}`,
              depart: hhmm(item.departure?.scheduled) || base.depart,
              arrive: hhmm(item.arrival?.scheduled),
              duration: Number.isFinite(dep) && Number.isFinite(arr) && arr > dep ? fmtDuration(Math.round((arr - dep) / 60000)) : base.duration,
              logo: item.airline?.iata ? `https://www.gstatic.com/flights/airline_logos/70px/${item.airline.iata}.png` : undefined,
              confidence: 0.6,
              source: "aviationstack",
            };
          });
          return remember({ flights, source: "aviationstack", note: "Real schedules; fares are estimates" });
        }
      }
    } catch {
      // fall through
    }
  }

  return remember({ flights: fallback, source: "catalogue", note: "No live fares found for this route" });
}

export async function translateText(input: string, language: string) {
  const target = SARVAM_LANG[language] || "en-IN";
  if (!input.trim() || target === "en-IN") return input;
  const cacheKey = `${target}::${input}`;
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;
  const key = env("SARVAM_API_KEY");
  if (!key) return input;
  try {
    const res = await timedFetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": key,
      },
      body: JSON.stringify({
        input: input.slice(0, 900),
        source_language_code: "en-IN",
        target_language_code: target,
        model: "mayura:v1",
        mode: "formal",
      }),
    }, 8000);
    if (!res.ok) return input;
    const body = await res.json() as { translated_text?: string };
    const translated = body.translated_text || input;
    if (translated !== input) { translationCache.set(cacheKey, translated); persistTranslations(); }
    return translated;
  } catch {
    return input;
  }
}

/** Translate a batch with at most 6 Sarvam calls in flight (cached per string). */
export async function translateMany(values: string[], language: string) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const result: Record<string, string> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, async () => {
    while (next < unique.length) {
      const value = unique[next++];
      result[value] = await translateText(value, language);
    }
  }));
  return result;
}

/** Background warm-up: translate catalogue strings for the demo languages once (cached on disk afterwards). */
export async function prewarmTranslations(texts: string[], languages: string[]) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST || !env("SARVAM_API_KEY")) return;
  for (const language of languages) {
    const target = SARVAM_LANG[language];
    const missing = texts.filter(text => text && !translationCache.has(`${target}::${text}`));
    for (let index = 0; index < missing.length; index += 24) await translateMany(missing.slice(index, index + 24), language);
  }
}

export async function sendConfirmation(input: { email?: string; phone?: string; summary: string }) {
  return sendMessage({ email: input.email, phone: input.phone, subject: "Your PackagePro trip is confirmed", text: input.summary });
}

/** Email (Resend) and/or SMS (Twilio) to a traveller; each is skipped when its keys aren't set. */
export async function sendMessage(input: { email?: string; phone?: string; subject: string; text: string }) {
  const result = { email: false, sms: false };
  if (input.email && env("RESEND_API_KEY")) {
    try {
      const res = await timedFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env("EMAIL_FROM") || "PackagePro <onboarding@resend.dev>",
          to: [input.email],
          subject: input.subject,
          text: input.text,
        }),
      }, 4000);
      result.email = res.ok;
    } catch {
      result.email = false;
    }
  }
  if (input.phone && env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM_NUMBER")) {
    try {
      const body = new URLSearchParams({
        To: input.phone,
        From: env("TWILIO_FROM_NUMBER"),
        Body: input.text.slice(0, 480),
      });
      const res = await timedFetch(`https://api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }, 4000);
      result.sms = res.ok;
    } catch {
      result.sms = false;
    }
  }
  return result;
}
