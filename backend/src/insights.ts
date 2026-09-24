import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Insight = {
  city: string;
  summary: string;
  source: string;
  sourceUrl?: string;
  image?: string;
  fetchedAt: string;
};

const cache = new Map<string, { value: Insight; expiresAt: number }>();

const CURATED_CONTEXT: Record<string, string> = {
  Jaipur: "Pink City heritage, palace courtyards, block-print craft, and food lanes around the old walls.",
  Thanjavur: "Chola temples, bronze craft studios, Tamil heritage stories, and slower old-town mornings.",
  Goa: "Local kitchens, quiet coves, Portuguese streets, and an unhurried coastal rhythm.",
  Varanasi: "Riverfront dawns, living silk craft, devotional rituals, and the city's layered food culture.",
  Ahmedabad: "Pol houses, stepwells, textile traditions, and a strong old-city food trail.",
  Udaipur: "Lake views, palace architecture, artisan workshops, and a gentler romantic pace.",
  Agra: "The Taj Mahal, Mughal architecture, marble craft, and an easy heritage-focused short break.",
};

function slug(city: string) { return city.trim().replace(/\s+/g, "_"); }

const cityImages = new Map<string, string>();
/** Wikimedia thumbnails are resizable by path: ask for a card-sized 960px rendition. */
function largeThumb(url: string) { return url.replace(/\/(\d+)px-/, "/960px-").replace(/\?.*$/, ""); }
export function cityImage(city: string) { return cityImages.get(city.trim()); }

// Landmark articles give recognisable card photos and avoid disambiguation pages (Gokarna, Manali, Puri) that carry no image.
const IMAGE_TITLES: Record<string, string> = {
  Gokarna: "Gokarna, Karnataka", Manali: "Manali, Himachal Pradesh", Puri: "Jagannath Temple, Puri", Srinagar: "Dal Lake",
  "New Delhi": "India Gate", Mumbai: "Gateway of India", Kolkata: "Victoria Memorial, Kolkata", Chennai: "Marina Beach",
  Hyderabad: "Charminar", Bengaluru: "Bangalore Palace", Lucknow: "Rumi Darwaza", Mysuru: "Mysore Palace", Rishikesh: "Lakshman Jhula",
  Visakhapatnam: "Rushikonda Beach", Guwahati: "Kamakhya Temple", Nainital: "Naini Lake", Bhubaneswar: "Lingaraja Temple",
  Pune: "Shaniwar Wada", Darjeeling: "Batasia Loop", Kochi: "Chinese fishing nets", Aurangabad: "Ellora Caves", Jaisalmer: "Gadisar Lake",
  Agra: "Taj Mahal", Amritsar: "Golden Temple",
};
const IMAGE_CACHE_FILE = path.resolve(process.cwd(), "data-model/seed/city-images.json");
type ImageEntry = { title: string; url: string };

function readImageCache(): Record<string, ImageEntry> {
  try { return JSON.parse(readFileSync(IMAGE_CACHE_FILE, "utf8")) as Record<string, ImageEntry>; } catch { return {}; }
}

async function wikiThumb(title: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug(title))}`, { headers: { Accept: "application/json", "User-Agent": "PackagePro/1.0 (hackathon demo)" }, signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { type?: string; thumbnail?: { source?: string } };
      return body.type === "disambiguation" || !body.thumbnail?.source || /\.svg/i.test(body.thumbnail.source) ? undefined : largeThumb(body.thumbnail.source);
    } catch { await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1))); }
  }
  return undefined;
}

/** Resolve destination photos (Wikipedia REST, no key). Resolved URLs are kept in data-model/seed/city-images.json so a fresh deploy never starts with blank cards. */
export async function warmCityImages(cities: string[]) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const saved = readImageCache();
  const missing: string[] = [];
  for (const city of Array.from(new Set(cities.map(item => item.trim())))) {
    if (saved[city]?.title === (IMAGE_TITLES[city] ?? city)) cityImages.set(city, saved[city].url);
    else missing.push(city);
  }
  if (!missing.length) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const city = missing[cursor++];
      for (const title of Array.from(new Set([IMAGE_TITLES[city] ?? city, city, `${city}, India`]))) {
        const url = await wikiThumb(title);
        if (url) { cityImages.set(city, url); saved[city] = { title: IMAGE_TITLES[city] ?? city, url }; break; }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  try { writeFileSync(IMAGE_CACHE_FILE, `${JSON.stringify(saved, null, 2)}\n`); } catch { /* read-only filesystem: keep in memory */ }
}

export async function getDestinationInsight(city: string): Promise<Insight> {
  const key = city.trim();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const fallback: Insight = {
    city: key,
    summary: CURATED_CONTEXT[key] || `${key} is available in the PackagePro destination catalogue. The planner will ground choices in package, price, and availability data.`,
    source: "PackagePro curated catalogue",
    fetchedAt: new Date().toISOString(),
  };
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    cache.set(key, { value: fallback, expiresAt: Date.now() + 30 * 60 * 1000 });
    return fallback;
  }
  try {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug(key))}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1800) });
    if (response.ok) {
      const body = await response.json() as { type?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source?: string } };
      if (body.extract) {
        const value: Insight = { city: key, summary: `${body.extract.slice(0, 520)} ${CURATED_CONTEXT[key] || ""}`.trim(), source: "Wikipedia REST summary + PackagePro catalogue", sourceUrl: body.content_urls?.desktop?.page, image: body.thumbnail?.source ? largeThumb(body.thumbnail.source) : undefined, fetchedAt: new Date().toISOString() };
        cache.set(key, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
        return value;
      }
    }
  } catch { /* keep the curated fallback */ }
  cache.set(key, { value: fallback, expiresAt: Date.now() + 30 * 60 * 1000 });
  return fallback;
}

export function clearInsightCache() { cache.clear(); }
