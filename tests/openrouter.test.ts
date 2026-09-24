import { describe, expect, it } from "vitest";

describe("OpenRouter integration", () => {
  it("authenticates with OpenRouter and can list models", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    expect(Boolean(key)).toBe(true);
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      console.warn("OpenRouter smoke test skipped because the provider was unreachable:", error instanceof Error ? error.message : error);
      return;
    }
    expect(res.ok).toBe(true);
    const body = await res.json() as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const freeModels = (body.data || []).filter(item => {
      const prompt = Number(item.pricing?.prompt || 0);
      const completion = Number(item.pricing?.completion || 0);
      return prompt === 0 && completion === 0;
    });
    expect(freeModels.length).toBeGreaterThan(0);
  }, 15000);
});
