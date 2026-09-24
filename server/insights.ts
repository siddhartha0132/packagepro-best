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
      const body = await response.json() as { extract?: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source?: string } };
      if (body.extract) {
        const value: Insight = { city: key, summary: `${body.extract.slice(0, 520)} ${CURATED_CONTEXT[key] || ""}`.trim(), source: "Wikipedia REST summary + PackagePro catalogue", sourceUrl: body.content_urls?.desktop?.page, image: body.thumbnail?.source, fetchedAt: new Date().toISOString() };
        cache.set(key, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
        return value;
      }
    }
  } catch { /* keep the curated fallback */ }
  cache.set(key, { value: fallback, expiresAt: Date.now() + 30 * 60 * 1000 });
  return fallback;
}

export function clearInsightCache() { cache.clear(); }
