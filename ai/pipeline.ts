import { PACKAGES, recommendPackages } from "../backend/src/packagepro";
import { translateText } from "../backend/src/integrations";
import { getTraveller, travellerSummary } from "../backend/src/travellers";
import { agentPrompt, packageBuilderPrompt, travellerBlock, tripParserPrompt } from "./prompts";

/** Attach the traveller's saved profile (users + user_preferences + booking history), looked up server-side from userId. */
function withTraveller(context?: Record<string, unknown>) {
  const userId = typeof context?.userId === "string" ? context.userId : undefined;
  const profile = userId ? getTraveller(userId) : null;
  return profile ? { ...context, traveller: travellerSummary(profile) } : context;
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CataloguePlace = { code: string; city: string; label?: string };
export type TripRequest = {
  origin?: CataloguePlace;
  destination?: CataloguePlace;
  durationDays?: number;
  departDate?: string;
  returnDate?: string;
  hotelTier?: "budget" | "boutique" | "luxury";
  transportMode?: "flight" | "train" | "cab";
};
export type TripCommand = { type: "swap_hotel" | "remove_guide"; target?: string };

const DEFAULT_FREE_MODELS = [
  "google/gemini-2.0-flash-thinking-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "qwen/qwen-2.5-72b-instruct:free",
];

let discoveredFreeModels: string[] | null = null;
let lastDiscoveryAt = 0;

function env(key: string) { return process.env[key] || ""; }

async function getFreeModels(): Promise<string[]> {
  if (discoveredFreeModels && Date.now() - lastDiscoveryAt < 60 * 60 * 1000) return discoveredFreeModels;
  const key = env("OPENROUTER_API_KEY");
  if (!key) return DEFAULT_FREE_MODELS;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return DEFAULT_FREE_MODELS;
    const body = await res.json() as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const free = (body.data || []).filter(item => Number(item.pricing?.prompt || 0) === 0 && Number(item.pricing?.completion || 0) === 0).map(item => item.id);
    if (free.length) {
      discoveredFreeModels = Array.from(new Set([...free, ...DEFAULT_FREE_MODELS]));
      lastDiscoveryAt = Date.now();
      return discoveredFreeModels;
    }
  } catch { /* use the known free chain */ }
  return DEFAULT_FREE_MODELS;
}

const LANGUAGE_NAMES: Record<string, string> = { "en-IN": "English", en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", mr: "Marathi", gu: "Gujarati", bn: "Bengali", pa: "Punjabi", or: "Odia", ur: "Urdu" };
export const languageName = (tag?: string) => LANGUAGE_NAMES[tag || "en-IN"] || "English";

/**
 * One chat completion from the first provider that answers:
 *  1. Sarvam `sarvam-105b-conversations` — Indian-language native, sub-second.
 *  2. OpenRouter free-model chain.
 * Returns null when no provider is configured or all fail (callers keep a grounded fallback).
 */
export async function chatLLM(messages: ChatMessage[], options: { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number } = {}): Promise<{ text: string; model: string } | null> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  const { maxTokens = 500, temperature = 0.2, json = false, timeoutMs = 9000 } = options;
  const sarvam = env("SARVAM_API_KEY");
  if (sarvam) {
    try {
      const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "api-subscription-key": sarvam, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sarvam-105b-conversations", messages, temperature, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const body = await res.json() as { choices?: { message?: { content?: string | null } }[] };
        const text = body.choices?.[0]?.message?.content?.trim();
        if (text) return { text, model: "sarvam-105b" };
      }
    } catch { /* fall through to OpenRouter */ }
  }
  const key = env("OPENROUTER_API_KEY");
  if (!key) return null;
  for (const model of (await getFreeModels()).slice(0, 3)) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://packagepro.local", "X-Title": "PackagePro", "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, ...(json ? { response_format: { type: "json_object" } } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model };
    } catch { /* try the next free model */ }
  }
  return null;
}

function dateOnly(date: Date) { return date.toISOString().slice(0, 10); }

function nextWeekendStart() {
  const date = new Date();
  const daysUntilSaturday = ((6 - date.getDay()) + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  date.setHours(12, 0, 0, 0);
  return date;
}

// Everyday names that differ from the dataset city name.
const PLACE_ALIASES: Record<string, string[]> = {
  jaipur: ["pink city"], "new delhi": ["delhi", "new delhi"], thanjavur: ["tanjore"], varanasi: ["banaras", "benaras", "kashi"],
  panaji: ["goa", "panjim"], bengaluru: ["bangalore"], mysuru: ["mysore"], thiruvananthapuram: ["trivandrum"], kochi: ["cochin"],
  pondicherry: ["puducherry", "pondy"], ooty: ["udhagamandalam", "ootacamund"], mumbai: ["bombay"], kolkata: ["calcutta"],
  alleppey: ["alappuzha"], gangtok: ["sikkim"], leh: ["ladakh"], srinagar: ["kashmir"], chennai: ["madras"], puri: ["jagannath puri"],
};
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function placeNames(place: CataloguePlace) {
  const names = [place.city, ...(PLACE_ALIASES[place.city.toLowerCase()] || [])];
  if (/^[A-Z]{3}$/.test(place.code)) names.push(place.code);
  return names.map(value => value.toLowerCase());
}

function findPlace(text: string, places: CataloguePlace[], excludeCity?: string) {
  const lower = text.toLowerCase();
  return places.find(place => place.city !== excludeCity && placeNames(place).some(name => new RegExp(`(^|[^a-z])${escapeRe(name)}($|[^a-z])`).test(lower)));
}

export function parseTripRequest(text: string, context?: Record<string, unknown>): TripRequest | null {
  const lower = text.toLowerCase();
  const destinations = Array.isArray(context?.availableDestinations) ? context!.availableDestinations as CataloguePlace[] : [];
  const origins = Array.isArray(context?.availableOrigins) ? context!.availableOrigins as CataloguePlace[] : [];
  const originSegment = lower.match(/(?:from|starting in|leaving from)\s+([a-z][a-z\s-]{2,30}?)(?=\s+(?:next|this|on|for|to|in)\b|[,.!?]|$)/)?.[1];
  const destinationSegment = lower.match(/(?:\bto|\bin|\bvisit(?:ing)?|\btrip to|\bholiday in)\s+([a-z][a-z\s-]{2,30}?)(?=\s+(?:next|this|on|for|from|in|with|under)\b|[,.!?]|$)/)?.[1];
  const origin = (originSegment ? findPlace(originSegment, origins) : undefined) || findPlace(lower.replace(destinationSegment ?? "\u0000", " "), origins);
  const destination = (destinationSegment ? findPlace(destinationSegment, destinations, origin?.city) : undefined) || findPlace(lower.replace(originSegment ?? "\u0000", " "), destinations, origin?.city);
  const durationMatch = lower.match(/(\d+)\s*(?:day|days|night|nights)\b/);
  const wordDuration = /\b(?:a couple of|couple of|two|2)\s+(?:days?|nights?)\b/.test(lower) ? 2 : /\b(?:three|3)\s+(?:days?|nights?)\b/.test(lower) ? 3 : undefined;
  const durationDays = durationMatch ? Number(durationMatch[1]) : wordDuration || (/\b(?:weekend|short break|quick getaway)\b/.test(lower) ? 2 : undefined);
  const isPlanningRequest = Boolean(destination && (durationDays || /\b(plan|make|create|build|trip|travel|visit|itinerary|holiday|vacation|getaway|break|book|spend)\b/.test(lower)));
  if (!isPlanningRequest) return null;

  const request: TripRequest = { origin, destination, durationDays };
  if (/(?:5[- ]star|luxury|palace|grand hotel)/.test(lower)) request.hotelTier = "luxury";
  else if (/(?:boutique|heritage stay|haveli)/.test(lower)) request.hotelTier = "boutique";
  else if (/(?:budget|cheap|lowest price)/.test(lower)) request.hotelTier = "budget";
  if (/(?:vande bharat|train|rail)/.test(lower)) request.transportMode = "train";
  else if (/(?:private cab|taxi|drive|road trip)/.test(lower)) request.transportMode = "cab";
  else request.transportMode = "flight";
  if (/next weekend|this weekend|coming weekend/.test(lower)) {
    const start = nextWeekendStart();
    request.departDate = dateOnly(start);
    const days = Math.max(1, durationDays || 2);
    const end = new Date(start);
    end.setDate(end.getDate() + days - 1);
    request.returnDate = dateOnly(end);
  }
  return request;
}

function requestText(request: TripRequest) {
  const from = request.origin?.city || "your chosen origin";
  const to = request.destination?.city || "your chosen destination";
  const dates = request.departDate && request.returnDate ? ` from ${request.departDate} to ${request.returnDate}` : " for the dates you choose";
  const style = request.hotelTier ? ` with a ${request.hotelTier} hotel preference` : "";
  const transport = request.transportMode && request.transportMode !== "flight" ? ` using ${request.transportMode === "train" ? "train" : "a private cab"} fallback` : " using the best available flight";
  return `I understood this as a ${request.durationDays || 2}-day trip from ${from} to ${to}${dates}${style}${transport}. I found that destination in the live PackagePro catalogue and will assemble the package components for review.`;
}

function parseTripCommand(text: string, context?: Record<string, unknown>): TripCommand | null {
  if (!context?.tripId) return null;
  const lower = text.toLowerCase();
  if (/(?:remove|drop|skip|without)\s+(?:the\s+)?(?:local\s+)?guide/.test(lower)) return { type: "remove_guide" };
  const match = lower.match(/(?:swap|change|switch)\s+(?:the\s+)?hotel\s+(?:to|for)\s+(.+)/i);
  if (match?.[1]) return { type: "swap_hotel", target: match[1].replace(/[.!?].*$/, "").trim() };
  return null;
}

async function parseTripRequestWithModel(text: string, context: Record<string, unknown>): Promise<TripRequest | null> {
  const destinations = JSON.stringify((context.availableDestinations as CataloguePlace[] | undefined || []).map(place => ({ code: place.code, city: place.city })));
  const origins = JSON.stringify(context.availableOrigins || []);
  const reply = await chatLLM([
    { role: "system", content: tripParserPrompt({ today: dateOnly(new Date()), origins, destinations }) },
    { role: "user", content: text },
  ], { maxTokens: 200, temperature: 0, json: true, timeoutMs: 6000 });
  if (!reply) return null;
  try {
    const raw = reply.text.match(/\{[\s\S]*\}/)?.[0] ?? reply.text;
    const parsed = JSON.parse(raw) as { isTripRequest?: boolean; originCode?: string; destinationCode?: string; durationDays?: number; departDate?: string; returnDate?: string; hotelTier?: "budget" | "boutique" | "luxury"; transportMode?: "flight" | "train" | "cab" };
    if (!parsed.isTripRequest || !parsed.destinationCode) return null;
    const destination = (context.availableDestinations as CataloguePlace[]).find(place => place.code === parsed.destinationCode);
    const origin = (context.availableOrigins as CataloguePlace[]).find(place => place.code === parsed.originCode);
    if (!destination) return null;
    return { origin, destination, durationDays: parsed.durationDays, departDate: parsed.departDate, returnDate: parsed.returnDate, hotelTier: parsed.hotelTier, transportMode: parsed.transportMode || "flight" };
  } catch {
    return null;
  }
}

export type PackageSuggestion = { packageId: string; cityId: string; city: string; name: string; theme: string; duration: number; basePrice: number; reason: string };

/** The facts the agent needs, without the destination lists (which crowd out trip details). */
function compactContext(context?: Record<string, unknown>) {
  const c = (context || {}) as Record<string, any>;
  const it = c.currentItinerary || {};
  const issue = c.guideAvailabilityIssue;
  return {
    planner: c.planner,
    destination: c.destination,
    budgetCap: c.budgetCap,
    runningTotal: c.runningTotal,
    flight: it.chosenFlight && { airline: it.chosenFlight.airline, number: it.chosenFlight.id, route: it.chosenFlight.route, depart: it.chosenFlight.depart, arrive: it.chosenFlight.arrive, price: it.chosenFlight.price },
    transport: it.chosenTransport && { operator: it.chosenTransport.operator, price: it.chosenTransport.price },
    hotel: it.chosenHotel && { name: it.chosenHotel.name, detail: it.chosenHotel.detail },
    package: it.package && { name: it.package.name, city: it.package.city, theme: it.package.theme },
    packagePrice: it.packagePrice,
    guide: it.chosenGuide && { name: it.chosenGuide.name, specialisation: it.chosenGuide.specialisation, languages: it.chosenGuide.languages, bookedDates: it.chosenGuide.bookedDates, cost: it.chosenGuide.totalCost },
    guideRefusal: issue && {
      refusedGuide: issue.guide?.name, specialisation: issue.guide?.specialisation, languages: issue.guide?.languages,
      unavailableOn: issue.conflictingDates, datesChecked: issue.requestedDates, totalBefore: issue.currentTotal,
      substitutes: (issue.replacementOptions || []).slice(0, 3).map((option: any) => ({ name: option.guide?.name, city: option.guide?.city, languages: option.guide?.languages, specialisation: option.guide?.specialisation, priceDeltaVsRefused: option.priceDelta, newTotal: option.newTotal, distanceKm: option.distanceKm })),
    },
    destinationInsight: c.destinationInsight?.summary?.slice?.(0, 400),
    traveller: c.traveller,
  };
}

/** Budget stated in free text: "40000", "40,000", "50k", "50 हज़ार", "1.5 lakh", "2 லட்சம்" … */
export function parseBudget(text: string): number | undefined {
  const clean = text.replace(/,/g, "");
  const lakh = clean.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|लाख|லட்சம்|లక్ష)/i);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const thousand = clean.match(/(\d+(?:\.\d+)?)\s*(?:k\b|thousand|हज़ार|हजार|ஆயிரம்|వేల)/i);
  if (thousand) return Math.round(Number(thousand[1]) * 1000);
  const plain = clean.match(/(?:₹|rs\.?|inr)?\s*(\d{4,7})/i);
  return plain ? Number(plain[1]) : undefined;
}

const catalogueLine = (pkg: (typeof PACKAGES)[number]) => `${pkg.id} | ${pkg.city} | ${pkg.theme} | ${pkg.tier} | ${pkg.duration}d | ₹${Math.round(pkg.basePrice)} | lang ${pkg.languagesOffered.join("/")} | ${pkg.components.filter(item => item.isDefault && item.type === "experience").map(item => item.label).slice(0, 2).join(", ")} | ${pkg.description.slice(0, 90)}`;
const INTEREST_HINT = /(love|like|prefer|interest|into|enjoy|want|looking for|suggest|recommend|budget|under|relax|adventure|trek|mountain|beach|temple|food|heritage|wildlife|honeymoon|family|pilgrim|wellness|yoga|culture|history|पसंद|बजट|விரும்ப|பட்ஜெட்|ఇష్టం|బడ్జెట్)/i;
const ABOUT_CURRENT_TRIP = /\b(why|explain|refus|substitut|this (package|hotel|flight|guide)|current|my trip|total)\b/i;

function toSuggestion(packageId: string, reason: string): PackageSuggestion | null {
  const pkg = PACKAGES.find(item => item.id === packageId);
  return pkg ? { packageId: pkg.id, cityId: pkg.cityId, city: pkg.city, name: pkg.name, theme: pkg.theme, duration: pkg.duration, basePrice: pkg.basePrice, reason } : null;
}

/**
 * AI package builder: free-text interests (any language) → up to 3 catalogue packages with reasons.
 * The LLM only chooses among real package IDs; unknown IDs are dropped and keyword scoring is the fallback.
 */
export async function matchPackagesFromInterests(text: string, context?: Record<string, unknown>): Promise<{ reply: string; suggestions: PackageSuggestion[]; model: string } | null> {
  const language = typeof context?.language === "string" ? context.language : "en-IN";
  const replyLanguage = languageName(language);
  const planner = (context?.planner || {}) as { budgetCap?: number; interests?: string };
  const budget = parseBudget(text);
  // Hard budget rule: the model only sees packages that fit a stated budget, and over-budget picks are dropped.
  const affordable = budget ? PACKAGES.filter(pkg => pkg.basePrice <= budget) : PACKAGES;
  const pool = affordable.length >= 3 ? affordable : PACKAGES;
  const traveller = context?.traveller as ReturnType<typeof travellerSummary> | undefined;
  // Booking history + saved preferences (users, user_preferences, bookings → trips) ground the builder's picks.
  const builderTravellerBlock = travellerBlock(traveller);
  const reply = await chatLLM([
    { role: "system", content: packageBuilderPrompt({ catalogue: pool.map(catalogueLine).join("\n"), budget, language, replyLanguage, travellerBlock: builderTravellerBlock }) },
    { role: "user", content: `${text}${planner.budgetCap ? `\n(Planner budget cap: ₹${planner.budgetCap})` : ""}` },
  ], { maxTokens: 450, temperature: 0.1, json: true, timeoutMs: 12000 });
  if (reply) {
    try {
      const parsed = JSON.parse(reply.text.match(/\{[\s\S]*\}/)?.[0] ?? reply.text) as { isPreferenceRequest?: boolean; picks?: { id?: string; reason?: string }[]; reply?: string };
      if (!parsed.isPreferenceRequest) return null;
      const suggestions = (parsed.picks || []).map(pick => toSuggestion(String(pick.id || ""), String(pick.reason || ""))).filter((item): item is PackageSuggestion => Boolean(item) && (!budget || pool !== affordable || item!.basePrice <= budget)).slice(0, 3);
      if (suggestions.length) return { reply: parsed.reply || "", suggestions, model: reply.model };
    } catch { /* fall back to keyword scoring */ }
  }
  if (!INTEREST_HINT.test(text)) return null;
  const ranked = recommendPackages(traveller ? `${text} ${traveller.favouriteThemes.join(" ")} ${traveller.interests}` : text, language, undefined, budget ?? planner.budgetCap).packages.filter(pkg => !budget || pkg.basePrice <= budget);
  if (!ranked.length || ranked[0].score <= 0) return null;
  const suggestions = ranked.map(pkg => toSuggestion(pkg.id, pkg.matchReasons.filter(item => !["curated route", "flexible route"].includes(item)).join(" · "))).filter((item): item is PackageSuggestion => Boolean(item));
  const fallbackReply = `Here are the closest catalogue matches for “${text.slice(0, 80)}”.`;
  return { reply: language === "en-IN" ? fallbackReply : await translateText(fallbackReply, language), suggestions, model: "catalogue-keyword-match" };
}

async function inLanguage(text: string, context?: Record<string, unknown>) {
  const language = typeof context?.language === "string" ? context.language : "en-IN";
  return language === "en-IN" || language === "en" ? text : translateText(text, language);
}

export async function explainWithFreeOpenRouter(messages: ChatMessage[], rawContext?: Record<string, unknown>) {
  const context = withTraveller(rawContext);
  const latest = messages[messages.length - 1]?.content || "";
  const command = parseTripCommand(latest, context);
  if (command) {
    const text = command.type === "remove_guide" ? "I’ll remove the guide from your current itinerary and reprice the running total." : `I’ll look for a ${command.target} hotel in the current destination and reprice the live total.`;
    return { text: await inLanguage(text, context), modelUsed: "planner-command-parser", fallbackChain: ["catalogue-command-parser"], command };
  }
  const tripRequest = parseTripRequest(latest, context) || await parseTripRequestWithModel(latest, context || {});
  if (tripRequest) {
    return { text: await inLanguage(requestText(tripRequest), context), modelUsed: "planner-intent-parser", fallbackChain: ["catalogue-intent-parser"], tripRequest };
  }
  const hasTrip = Boolean((context?.currentItinerary as { package?: unknown } | undefined)?.package);
  if (!(hasTrip && ABOUT_CURRENT_TRIP.test(latest))) {
    const match = await matchPackagesFromInterests(latest, context);
    if (match) return { text: match.reply, modelUsed: match.model, fallbackChain: [match.model], suggestions: match.suggestions };
  }

  const replyLanguage = languageName(typeof context?.language === "string" ? context.language : undefined);
  const systemPrompt = agentPrompt({ context: compactContext(context), replyLanguage });
  const reply = await chatLLM([{ role: "system", content: systemPrompt }, ...messages.map(message => ({ role: message.role, content: message.content }))], { maxTokens: 500 });
  if (reply) return { text: reply.text, modelUsed: reply.model, fallbackChain: [reply.model] };
  return { text: fallbackExplanation(latest, context), modelUsed: process.env.VITEST ? "test-context-engine" : "context-fallback", fallbackChain: ["no-llm-provider"] };
}

function fallbackExplanation(userQuery: string, context?: Record<string, unknown>): string {
  const q = userQuery.toLowerCase();
  const planner = context?.planner as { destinationCity?: string; budgetCap?: number; interests?: string; language?: string } | undefined;
  const city = planner?.destinationCity || (context?.destination as string) || "the selected destination";
  const budget = planner?.budgetCap ? `₹${Number(planner.budgetCap).toLocaleString("en-IN")}` : "the current budget cap";
  const interests = planner?.interests || "the traveller's selected interests";
  const current = context?.currentItinerary as { chosenFlight?: { airline?: string; id?: string; price?: number }; chosenHotel?: { name?: string; total?: number; rating?: number }; chosenGuide?: { name?: string; totalCost?: number }; package?: { name?: string }; packagePrice?: number; chosenTransport?: { operator?: string; price?: number } } | undefined;
  const guideIssue = context?.guideAvailabilityIssue as { guide?: { name?: string }; conflictingDates?: string[]; replacement?: { name?: string } } | undefined;

  if (guideIssue) return `We refused ${guideIssue.guide?.name || "the selected guide"} because the live availability record clashes on ${guideIssue.conflictingDates?.join(", ") || "one or more trip dates"}. The replacement ${guideIssue.replacement?.name || "guide"} matches the required language and specialisation, and the rate difference is applied to the running total.`;
  if (q.includes("why") && (q.includes("guide") || q.includes("substitute"))) return `Guide selection is checked against the actual package dates. PackagePro first preserves the selected language and specialisation, then chooses the nearest available local guide and reprices only the day-rate difference.`;
  if (q.includes("why") && (q.includes("hotel") || q.includes("flight"))) return `For ${city}, the current planner is balancing ${interests} against ${budget}. The selected components are ${current?.chosenFlight?.airline ? `${current.chosenFlight.airline} at ₹${current.chosenFlight.price?.toLocaleString("en-IN")}` : "the lowest-confidence-ranked flight option"} and ${current?.chosenHotel?.name ? `${current.chosenHotel.name} at ₹${current.chosenHotel.total?.toLocaleString("en-IN")}` : "the available hotel options"}; every later swap updates the live ledger.`;
  if (q.includes("why") || q.includes("explain") || q.includes("itinerary")) {
    const flight = current?.chosenFlight ? `${current.chosenFlight.airline || "Flight"} ${current.chosenFlight.id || ""} ₹${Number(current.chosenFlight.price || 0).toLocaleString("en-IN")}` : "not selected";
    const hotel = current?.chosenHotel ? `${current.chosenHotel.name} ₹${Number(current.chosenHotel.total || 0).toLocaleString("en-IN")} (${current.chosenHotel.rating || "catalogue"}★)` : "not selected";
    const packageLine = current?.package?.name ? `${current.package.name} ₹${Number(current.packagePrice || 0).toLocaleString("en-IN")}` : "not loaded";
    const guide = current?.chosenGuide ? `${current.chosenGuide.name} ₹${Number(current.chosenGuide.totalCost || 0).toLocaleString("en-IN")}` : "no guide charge";
    const transport = current?.chosenTransport ? `${current.chosenTransport.operator} ₹${Number(current.chosenTransport.price || 0).toLocaleString("en-IN")}` : "flight route selected";
    return `Here is the exact live itinerary math for ${city}: ${flight}; ${hotel}; ${packageLine}; ${guide}; ${transport}. The planner is matching ${interests} in ${planner?.language || "your selected language"}, checking guide dates and hotel/transport availability, then comparing the component sum with your ₹${Number(planner?.budgetCap || 0).toLocaleString("en-IN")} cap. Swaps re-run this calculation immediately; this is a recommendation, not a booking yet.`;
  }
  return `I can explain this live plan using its actual city, interests, budget, selected components, and guide availability. Ask “Why this package?”, “Why this hotel?”, or “Why was this guide replaced?” and I’ll show the relevant trade-off.`;
}

/** One grounded completion (Sarvam first, then OpenRouter); null when no provider answers. */
export async function completeGrounded(system: string, user: string, maxTokens = 400) {
  return chatLLM([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens });
}
