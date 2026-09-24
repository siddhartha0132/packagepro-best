type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const DEFAULT_FREE_MODELS = [
  "google/gemini-2.0-flash-thinking-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "qwen/qwen-2.5-72b-instruct:free",
];

let discoveredFreeModels: string[] | null = null;
let lastDiscoveryAt = 0;

function env(key: string) {
  return process.env[key] || "";
}

async function getFreeModels(): Promise<string[]> {
  if (discoveredFreeModels && Date.now() - lastDiscoveryAt < 60 * 60 * 1000) {
    return discoveredFreeModels;
  }
  const key = env("OPENROUTER_API_KEY");
  if (!key) return DEFAULT_FREE_MODELS;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return DEFAULT_FREE_MODELS;
    const body = await res.json() as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const free = (body.data || [])
      .filter(item => {
        const prompt = Number(item.pricing?.prompt || 0);
        const completion = Number(item.pricing?.completion || 0);
        return prompt === 0 && completion === 0;
      })
      .map(item => item.id);
    if (free.length) {
      discoveredFreeModels = Array.from(new Set([...free, ...DEFAULT_FREE_MODELS]));
      lastDiscoveryAt = Date.now();
      return discoveredFreeModels;
    }
  } catch {
    // fall back
  }
  return DEFAULT_FREE_MODELS;
}

export async function explainWithFreeOpenRouter(messages: ChatMessage[], context?: Record<string, unknown>) {
  const key = env("OPENROUTER_API_KEY");
  const systemPrompt = `You are the transparent PackagePro Agent. Explain clearly and honestly why specific packages, flights, hotels, or guides are recommended or selected. Always ground your explanation in the traveller's stated interests, the live budget cap, real guide availability dates, and language match.
Current trip context: ${JSON.stringify(context || {})}
Style: Concise, friendly, transparent, professional. Never invent unavailable inventory.`;

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  if (!key) {
    return {
      text: fallbackExplanation(messages[messages.length - 1]?.content || "", context),
      modelUsed: "offline-rule-engine",
      fallbackChain: ["no-openrouter-key"],
    };
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return {
      text: fallbackExplanation(messages[messages.length - 1]?.content || "", context),
      modelUsed: "test-deterministic-fallback",
      fallbackChain: ["vitest-isolated"],
    };
  }

  const freeModels = await getFreeModels();
  const attempted: string[] = [];

  for (const model of freeModels.slice(0, 4)) {
    attempted.push(model);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://packagepro.local",
          "X-Title": "PackagePro Transparent Trip Agent",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: fullMessages,
          temperature: 0.3,
          max_tokens: 380,
        }),
        signal: AbortSignal.timeout(4500),
      });

      if (!res.ok) continue;
      const body = await res.json() as {
        choices?: { message?: { content?: string } }[];
      };
      const reply = body.choices?.[0]?.message?.content?.trim();
      if (reply) {
        return {
          text: reply,
          modelUsed: model,
          fallbackChain: attempted,
        };
      }
    } catch {
      // try next free model
    }
  }

  return {
    text: fallbackExplanation(messages[messages.length - 1]?.content || "", context),
    modelUsed: "rule-fallback",
    fallbackChain: attempted,
  };
}

function fallbackExplanation(userQuery: string, context?: Record<string, unknown>): string {
  const q = userQuery.toLowerCase();
  const city = (context?.destination as string) || "your destination";
  const budget = context?.budgetCap ? `₹${Number(context.budgetCap).toLocaleString("en-IN")}` : "your budget";
  const guideIssue = context?.guideAvailabilityIssue as { guide?: { name?: string }; conflictingDates?: string[]; replacement?: { name?: string } } | undefined;

  if (guideIssue) {
    return `We refused ${guideIssue.guide?.name || "the guide"} because of a real clash on ${guideIssue.conflictingDates?.join(", ") || "the trip dates"}. To protect your itinerary, we offered ${guideIssue.replacement?.name || "a substitute"} with the exact same language and specialisation, applying the rate difference directly to your total.`;
  }

  if (q.includes("why") && (q.includes("guide") || q.includes("substitute"))) {
    return `Guides are matched first by local language and specialisation. If your chosen guide is booked on any day of the package duration, we refuse the clash and suggest the closest available guide so your trip stays fully supported.`;
  }

  if (q.includes("why") && (q.includes("hotel") || q.includes("flight"))) {
    return `We prioritize the lowest flight base fare and verified hotel inventory so you preserve room under ${budget} for curated local experiences and transfers without crossing your cap.`;
  }

  return `PackagePro chose this configuration for ${city} to keep the total within ${budget}. Your package baseline and travel components are checked continuously: every swap updates the live running ledger so you never face hidden overages.`;
}
