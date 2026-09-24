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

function dateOnly(date: Date) { return date.toISOString().slice(0, 10); }

function nextWeekendStart() {
  const date = new Date();
  const daysUntilSaturday = ((6 - date.getDay()) + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  date.setHours(12, 0, 0, 0);
  return date;
}

function findPlace(text: string, places: CataloguePlace[]) {
  const lower = text.toLowerCase();
  const aliases: Record<string, string[]> = {
    jaipur: ["pink city", "jaipur", "jai"],
    "new delhi": ["new delhi", "delhi", "capital", "del"],
    thanjavur: ["thanjavur", "tanjore", "chola"],
    varanasi: ["varanasi", "banaras", "kashi", "vns"],
    goa: ["goa", "panaji", "panjim"],
  };
  return places.find(place => {
    const names = [place.city, place.code, ...(aliases[place.city.toLowerCase()] || [])].map(value => value.toLowerCase());
    return names.some(name => lower.includes(name));
  });
}

export function parseTripRequest(text: string, context?: Record<string, unknown>): TripRequest | null {
  const lower = text.toLowerCase();
  const destinations = Array.isArray(context?.availableDestinations) ? context!.availableDestinations as CataloguePlace[] : [];
  const origins = Array.isArray(context?.availableOrigins) ? context!.availableOrigins as CataloguePlace[] : [];
  const destination = findPlace(lower, destinations);
  const originMatch = lower.match(/(?:from|starting in|leaving from)\s+([a-z][a-z\s-]{2,30}?)(?:\s+(?:next|this|on|for|to)\b|$)/i);
  const origin = (originMatch ? findPlace(originMatch[1], origins) : undefined) || findPlace(lower, origins);
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

async function parseTripRequestWithModel(text: string, context: Record<string, unknown>, key: string): Promise<TripRequest | null> {
  if (!key || process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  const models = await getFreeModels();
  const destinations = JSON.stringify(context.availableDestinations || []);
  const origins = JSON.stringify(context.availableOrigins || []);
  for (const model of models.slice(0, 2)) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 180,
          messages: [
            { role: "system", content: `Extract a travel request into JSON. Only return JSON, no markdown. Match origin and destination to these exact catalogue records. If this is not a request to plan or change a trip, set isTripRequest false. Resolve next weekend relative to today ${dateOnly(new Date())}. Extract durationDays, hotelTier (budget, boutique, luxury), and transportMode (flight, train, cab) when stated. Origins: ${origins}. Destinations: ${destinations}.` },
            { role: "user", content: text },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const raw = body.choices?.[0]?.message?.content?.trim();
      if (!raw) continue;
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")) as { isTripRequest?: boolean; originCode?: string; destinationCode?: string; durationDays?: number; departDate?: string; returnDate?: string; hotelTier?: "budget" | "boutique" | "luxury"; transportMode?: "flight" | "train" | "cab" };
      if (!parsed.isTripRequest || !parsed.destinationCode) continue;
      const destination = (context.availableDestinations as CataloguePlace[]).find(place => place.code === parsed.destinationCode);
      const origin = (context.availableOrigins as CataloguePlace[]).find(place => place.code === parsed.originCode);
      if (!destination) continue;
      return { origin, destination, durationDays: parsed.durationDays, departDate: parsed.departDate, returnDate: parsed.returnDate, hotelTier: parsed.hotelTier, transportMode: parsed.transportMode || "flight" };
    } catch { /* deterministic parser and next model remain available */ }
  }
  return null;
}

export async function explainWithFreeOpenRouter(messages: ChatMessage[], context?: Record<string, unknown>) {
  const latest = messages[messages.length - 1]?.content || "";
  const command = parseTripCommand(latest, context);
  if (command) {
    return { text: command.type === "remove_guide" ? "I’ll remove the guide from your current itinerary and reprice the running total." : `I’ll look for a ${command.target} hotel in the current destination and reprice the live total.`, modelUsed: "planner-command-parser", fallbackChain: ["catalogue-command-parser"], command };
  }
  const tripRequest = parseTripRequest(latest, context) || await parseTripRequestWithModel(latest, context || {}, env("OPENROUTER_API_KEY"));
  if (tripRequest) {
    return { text: requestText(tripRequest), modelUsed: "planner-intent-parser", fallbackChain: ["catalogue-intent-parser"], tripRequest };
  }

  const key = env("OPENROUTER_API_KEY");
  const systemPrompt = `You are the transparent PackagePro Agent inside a live travel planner. Use ONLY the supplied PackagePro context and catalogue facts. Explain exactly why a package, flight, hotel, guide, or substitute was selected. Mention the traveller's interests, selected city, budget math, language match, and real guide availability dates when relevant. If the user asks to plan a trip, identify origin, destination, duration, and relative dates and return an actionable planner request. Never assume Thanjavur or invent inventory.
Live PackagePro context: ${JSON.stringify(context || {})}
Style: concise, friendly, concrete, and honest.`;
  const fullMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  if (!key || process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { text: fallbackExplanation(latest, context), modelUsed: !key ? "offline-context-engine" : "test-context-engine", fallbackChain: [!key ? "no-openrouter-key" : "vitest-isolated"] };
  }

  const freeModels = await getFreeModels();
  const attempted: string[] = [];
  for (const model of freeModels.slice(0, 4)) {
    attempted.push(model);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://packagepro.local", "X-Title": "PackagePro Transparent Trip Agent", "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: fullMessages, temperature: 0.2, max_tokens: 420 }),
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const reply = body.choices?.[0]?.message?.content?.trim();
      if (reply) return { text: reply, modelUsed: model, fallbackChain: attempted };
    } catch { /* try next free model */ }
  }
  return { text: fallbackExplanation(latest, context), modelUsed: "context-fallback", fallbackChain: attempted };
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
