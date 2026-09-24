import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

describe("packagepro procedures", () => {
  const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: null });

  it("lists curated packages and filters by theme", async () => {
    const all = await caller.packagepro.list();
    expect(all.length).toBeGreaterThan(0);
    const heritage = await caller.packagepro.list({ theme: "Heritage" });
    expect(heritage.every(item => item.theme === "Heritage" || item.tags.includes("heritage"))).toBe(true);
  });

  it("returns package alternatives within the same swap group", async () => {
    const alts = await caller.packagepro.alternatives({ packageId: "pkg-thanjavur-heritage", componentId: "hotel-thanjavur-courtyard" });
    expect(alts.length).toBe(1);
    expect(alts[0]?.id).toBe("hotel-thanjavur-palace");
  });

  it("refuses an unavailable guide on clashing dates and offers a same-language substitute", async () => {
    const check = await caller.packagepro.checkGuide({ guideId: "guide-priya", departDate: "2026-09-02", duration: 3 });
    expect(check.accepted).toBe(false);
    expect(check.conflicts).toContain("2026-09-02");
    expect(check.replacement?.id).toBe("guide-riya");
    expect(check.replacement?.specialisation).toBe("heritage");
    expect(check.replacement?.languages).toContain("gu");
    expect(check.priceDelta).toBe(-900);
  });

  it("accepts an available guide and computes the correct duration total", async () => {
    const check = await caller.packagepro.checkGuide({ guideId: "guide-arjun", departDate: "2026-09-02", duration: 3 });
    expect(check.accepted).toBe(true);
    expect(check.conflicts).toHaveLength(0);
    expect(check.total).toBe(2400 * 3);
  });

  it("returns grounded recommendations without inventing components", async () => {
    const recs = await caller.packagepro.recommend({ query: "heritage temple bronze", language: "ta" });
    expect(recs.packages.length).toBeGreaterThan(0);
    expect(recs.guides.length).toBeGreaterThan(0);
    expect(recs.groundedIn).toContain("PackagePro package catalogue");
  });
});
