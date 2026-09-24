import { createHash } from "crypto";
import { FLIGHTS, HOTELS, type FlightRecord, type HotelRecord } from "./packagepro";

const SARVAM_LANG: Record<string, string> = {
  "en-IN": "en-IN",
  en: "en-IN",
  ta: "ta-IN",
  hi: "hi-IN",
  te: "te-IN",
};

const translationCache = new Map<string, string>();
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

export const DESTINATIONS = [
  { code: "BLR", city: "Thanjavur", label: "Thanjavur · Chola trail", airport: "Trichy / Chennai" },
  { code: "MAA", city: "Thanjavur", label: "Thanjavur via Chennai", airport: "Chennai International" },
  { code: "JAI", city: "Jaipur", label: "Jaipur · Pink City", airport: "Jaipur International" },
  { code: "GOI", city: "Goa", label: "Goa · Coast & kitchens", airport: "Manohar International" },
  { code: "VNS", city: "Varanasi", label: "Varanasi · Riverfront", airport: "Lal Bahadur Shastri" },
  { code: "AMD", city: "Ahmedabad", label: "Ahmedabad · Old city", airport: "Sardar Vallabhbhai Patel" },
  { code: "UDR", city: "Udaipur", label: "Udaipur · Lakes", airport: "Maharana Pratap" },
  { code: "AGR", city: "Agra", label: "Agra · Heritage", airport: "Kheria" },
];

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
  const fallback = HOTELS.filter(hotel => hotel.city === city);
  const hotels = fallback.length ? fallback : HOTELS.filter(hotel => hotel.city === "Thanjavur");
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return { hotels, source: "catalogue" };
  const pairs = [
    [env("HOTELBEDS_API_KEY"), env("HOTELBEDS_API_SECRET")],
    [env("HOTELBEDS_API_KEY_ALT"), env("HOTELBEDS_API_SECRET_ALT")],
  ].filter(([key, secret]) => key && secret) as [string, string][];

  for (const [apiKey, secret] of pairs) {
    try {
      const dest = DESTINATIONS.find(item => item.city === city)?.code || "DEL";
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
      if (mapped.length) return { hotels: [...mapped, ...hotels].slice(0, 8), source: "hotelbeds" };
    } catch {
      // try next credential pair
    }
  }
  return { hotels, source: "catalogue" };
}

export async function searchFlightsLive(origin: string, destination: string, departDate: string): Promise<{ flights: FlightRecord[]; source: string }> {
  const fallback = FLIGHTS.map(flight => ({ ...flight, route: `${origin} → ${destination}` }));
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return { flights: fallback, source: "catalogue" };
  const rapidKey = env("SKYSCANNER_API_KEY");
  if (rapidKey) {
    try {
      const url = new URL("https://sky-scrapper.p.rapidapi.com/api/v1/flights/searchFlights");
      url.searchParams.set("originSkyId", origin);
      url.searchParams.set("destinationSkyId", destination);
      url.searchParams.set("date", departDate);
      url.searchParams.set("adults", "1");
      url.searchParams.set("currency", "INR");
      const res = await timedFetch(url, {
        headers: {
          "X-RapidAPI-Key": rapidKey,
          "X-RapidAPI-Host": "sky-scrapper.p.rapidapi.com",
        },
      }, 3500);
      if (res.ok) {
        const body = await res.json() as { data?: { itineraries?: { id?: string; price?: { raw?: number }; legs?: { origin?: { displayCode?: string }; destination?: { displayCode?: string }; durationInMinutes?: number; carriers?: { marketing?: { name?: string }[] }; departure?: string }[] }[] } };
        const itineraries = body.data?.itineraries || [];
        const flights: FlightRecord[] = [];
        for (const item of itineraries.slice(0, 6)) {
          const leg = item.legs?.[0];
          const price = Number(item.price?.raw || 0);
          if (!leg || price <= 0) continue;
          const depart = leg.departure ? new Date(leg.departure).toISOString().slice(11, 16) : "—";
          flights.push({
            id: String(item.id || `${origin}-${destination}-${flights.length}`).slice(0, 18),
            airline: leg.carriers?.marketing?.[0]?.name || "Live carrier",
            route: `${leg.origin?.displayCode || origin} → ${leg.destination?.displayCode || destination}`,
            depart,
            duration: `${Math.round((leg.durationInMinutes || 150) / 60)}h ${(leg.durationInMinutes || 150) % 60}m`,
            price: Math.round(price),
            confidence: 0.86,
          });
        }
        if (flights.length) return { flights, source: "skyscanner" };
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
      const res = await timedFetch(url, {}, 3500);
      if (res.ok) {
        const body = await res.json() as { data?: { flight?: { iata?: string }; airline?: { name?: string }; departure?: { scheduled?: string; iata?: string }; arrival?: { iata?: string } }[] };
        const live = body.data || [];
        if (live.length) {
          const flights = live.slice(0, 6).map((item, index) => ({
            ...fallback[index % fallback.length],
            id: item.flight?.iata || fallback[index % fallback.length].id,
            airline: item.airline?.name || fallback[index % fallback.length].airline,
            route: `${item.departure?.iata || origin} → ${item.arrival?.iata || destination}`,
            depart: item.departure?.scheduled ? new Date(item.departure.scheduled).toISOString().slice(11, 16) : fallback[index % fallback.length].depart,
          }));
          return { flights, source: "aviationstack" };
        }
      }
    } catch {
      // fall through
    }
  }

  return { flights: fallback, source: "catalogue" };
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
    }, 4000);
    if (!res.ok) return input;
    const body = await res.json() as { translated_text?: string };
    const translated = body.translated_text || input;
    translationCache.set(cacheKey, translated);
    return translated;
  } catch {
    return input;
  }
}

export async function translateMany(values: string[], language: string) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const entries = await Promise.all(unique.map(async value => [value, await translateText(value, language)] as const));
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function sendConfirmation(input: { email?: string; phone?: string; summary: string }) {
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
          from: "PackagePro <beth.t@example.com>",
          to: [input.email],
          subject: "Your PackagePro trip is confirmed",
          text: input.summary,
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
        Body: input.summary.slice(0, 320),
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
