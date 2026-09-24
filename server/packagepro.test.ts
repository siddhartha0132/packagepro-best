import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

function caller() {
  return appRouter.createCaller({ req: {} as any, res: {} as any, user: null });
}

describe("packagepro catalogue", () => {
  it("lists curated packages and filters by theme", async () => {
    const all = await caller().packagepro.list();
    expect(all.length).toBeGreaterThan(0);
    const heritage = await caller().packagepro.list({ theme: "Heritage" });
    expect(heritage.every(item => item.theme === "Heritage" || item.tags.includes("heritage"))).toBe(true);
  });

  it("personalizes recommendations using interests, destination, budget, and guide language", async () => {
    const result = await caller().packagepro.recommend({ query: "local food", language: "ta", destination: "Thanjavur", budget: 50000 });
    expect(result.packages[0]?.city).toBe("Thanjavur");
    expect(result.packages[0]?.matchReasons).toContain("your destination");
    expect(result.guides.every(guide => guide.city === "Thanjavur" && guide.languages.includes("ta"))).toBe(true);
  });
});

describe("master trip flow", () => {
  it("creates a trip and starts at flight selection", async () => {
    const trip = await caller().trip.create({ origin: "DEL", destination: "BLR", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 50000, language: "ta" });
    expect(trip.status).toBe("select_flight");
    expect(trip.flightOptions.length).toBeGreaterThan(0);
  });

  it("auto-builds a complete Jaipur package from a natural trip request", async () => {
    const trip = await caller().trip.autoBuild({ origin: "DEL", destination: "JAI", departDate: "2026-09-25", returnDate: "2026-09-27", travelers: 1, language: "en-IN", interests: "heritage and food" });
    expect(trip.status).toBe("review");
    expect(trip.origin).toBe("DEL");
    expect(trip.destination).toBe("Jaipur");
    expect(trip.chosenFlight).toBeTruthy();
    expect(trip.chosenHotel).toBeTruthy();
    expect(trip.package?.city).toBe("Jaipur");
    expect(trip.runningTotal).toBeGreaterThan(0);
  });

  it("rejects the same origin and destination", async () => {
    await expect(caller().trip.create({ origin: "DEL", destination: "DEL", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 20000, language: "en-IN" })).rejects.toThrow(/same/);
  });

  it("returns an over-budget flight to negotiate, then back to flight picker", async () => {
    const trip = await caller().trip.create({ origin: "DEL", destination: "JAI", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 2000, language: "en-IN" });
    const next = await caller().trip.selectFlight({ tripId: trip.tripId, flightId: trip.flightOptions[0].id });
    expect(next.status).toBe("negotiate");
    expect(next.runningTotal).toBe(0);
    const declined = await caller().trip.negotiate({ tripId: trip.tripId, choice: "remove_item" });
    expect(declined.status).toBe("select_flight");
  });

  it("completes the five-stage flow and never exceeds the cap", async () => {
    const api = caller();
    let trip = await api.trip.create({ origin: "DEL", destination: "BLR", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 80000, language: "ta" });
    trip = await api.trip.selectFlight({ tripId: trip.tripId, flightId: [...trip.flightOptions].sort((a, b) => a.price - b.price)[0].id });
    expect(trip.status).toBe("select_hotel");
    trip = await api.trip.selectHotel({ tripId: trip.tripId, hotelId: trip.hotelOptions[0].id });
    expect(trip.status).toBe("select_package");
    expect(trip.package?.city).toBe("Thanjavur");
    expect(trip.runningTotal).toBe(trip.chosenFlight!.price + trip.chosenHotel!.total + trip.package!.basePrice);
    trip = await api.trip.continuePackage({ tripId: trip.tripId });
    expect(trip.status).toBe("select_guide");
    trip = await api.trip.skipGuide({ tripId: trip.tripId });
    expect(trip.status).toBe("review");
    trip = await api.trip.confirm({ tripId: trip.tripId });
    expect(trip.status).toBe("confirmed");
    expect(trip.runningTotal).toBeLessThanOrEqual(trip.budgetCap);
  });

  it("refuses an unavailable Tamil heritage guide and offers a same-language substitute", async () => {
    const api = caller();
    let trip = await api.trip.create({ origin: "DEL", destination: "BLR", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 80000, language: "ta" });
    trip = await api.trip.selectFlight({ tripId: trip.tripId, flightId: [...trip.flightOptions].sort((a, b) => a.price - b.price)[0].id });
    trip = await api.trip.selectHotel({ tripId: trip.tripId, hotelId: trip.hotelOptions[0].id });
    trip = await api.trip.continuePackage({ tripId: trip.tripId });
    trip = await api.trip.selectGuide({ tripId: trip.tripId, guideId: "guide-arjun", days: 3 });
    expect(trip.status).toBe("select_guide");
    expect(trip.guideAvailabilityIssue?.conflictingDates).toContain("2026-09-02");
    expect(trip.guideAvailabilityIssue?.replacement?.id).toBe("guide-meera");
    expect(trip.guideAvailabilityIssue?.replacement?.specialisation).toBe("heritage");
    expect(trip.guideAvailabilityIssue?.replacement?.languages).toContain("ta");
    trip = await api.trip.selectGuide({ tripId: trip.tripId, guideId: "guide-meera", days: 3 });
    expect(trip.status).toBe("review");
    expect(trip.chosenGuide?.id).toBe("guide-meera");
  });
});
