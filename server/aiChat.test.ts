import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { parseTripRequest } from "./aiChat";

describe("AI transparent explanation endpoint", () => {
  it("understands a natural Jaipur weekend request against catalogue cities", () => {
    const request = parseTripRequest("can you make a two days Jaipur trip from Delhi next weekend", {
      availableOrigins: [{ code: "DEL", city: "New Delhi" }],
      availableDestinations: [{ code: "JAI", city: "Jaipur" }],
    });
    expect(request?.origin?.code).toBe("DEL");
    expect(request?.destination?.code).toBe("JAI");
    expect(request?.durationDays).toBe(2);
    expect(request?.departDate).toBeTruthy();
    expect(request?.returnDate).toBeTruthy();
  });

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

  it("returns a planner action payload for a natural-language request", async () => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: null });
    const reply = await caller.packagepro.explain({
      messages: [{ role: "user", content: "I want a quick two-night break in the Pink City from Delhi next weekend" }],
      context: {
        availableOrigins: [{ code: "DEL", city: "New Delhi" }],
        availableDestinations: [{ code: "JAI", city: "Jaipur" }],
      },
    });
    expect(reply.tripRequest?.destination?.code).toBe("JAI");
    expect(reply.tripRequest?.origin?.code).toBe("DEL");
    expect(reply.tripRequest?.durationDays).toBe(2);
  });

  it("turns conversational itinerary edits into commands", async () => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: null });
    const swap = await caller.packagepro.explain({ messages: [{ role: "user", content: "swap hotel to the heritage haveli" }], context: { tripId: "trp_demo" } });
    expect(swap.command).toEqual({ type: "swap_hotel", target: "the heritage haveli" });
    const remove = await caller.packagepro.explain({ messages: [{ role: "user", content: "please remove the guide" }], context: { tripId: "trp_demo" } });
    expect(remove.command?.type).toBe("remove_guide");
  });
});
