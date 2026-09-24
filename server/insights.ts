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
function largeThumb(url: string) { return url.replace(/\/(\d+)px-/, "/960px-"); }
export function cityImage(city: string) { return cityImages.get(city.trim()); }

/** Fetch destination photos once at startup (Wikipedia REST, no key) so package cards show real imagery. */
export async function warmCityImages(cities: string[]) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  for (const city of cities) {
    if (cityImages.has(city)) continue;
    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug(city))}`, { headers: { Accept: "application/json", "User-Agent": "PackagePro/1.0 (hackathon demo)" }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const body = await response.json() as { thumbnail?: { source?: string } };
      if (body.thumbnail?.source) cityImages.set(city, largeThumb(body.thumbnail.source));
    } catch { /* keep the generated placeholder */ }
  }
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
      if (body.thumbnail?.source) cityImages.set(key, largeThumb(body.thumbnail.source));
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
