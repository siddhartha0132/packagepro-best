import { describe, expect, it } from "vitest";

describe("OpenRouter integration", () => {
  it("authenticates with OpenRouter and can list models", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    expect(Boolean(key)).toBe(true);
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
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
