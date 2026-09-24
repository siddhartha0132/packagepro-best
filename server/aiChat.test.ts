import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

describe("AI transparent explanation endpoint", () => {
  it("answers transparency questions with model attribution or graceful fallback", async () => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: null });
    const reply = await caller.packagepro.explain({
      messages: [{ role: "user", content: "Why did you suggest this hotel and guide for Thanjavur?" }],
      context: {
        destination: "Thanjavur",
        budgetCap: 50000,
        runningTotal: 28000,
      },
    });
    expect(typeof reply.text).toBe("string");
    expect(reply.text.length).toBeGreaterThan(10);
    expect(typeof reply.modelUsed).toBe("string");
    expect(Array.isArray(reply.fallbackChain)).toBe(true);
  });
});
