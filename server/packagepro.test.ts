import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

// PS-04 dataset: two Tamil-speaking heritage guides in Thanjavur. Arjun is unavailable on 2026-09-02; Meera is free 2–4 Sep.
const ARJUN = "gid_ad5b7c5f";
const MEERA = "gid_dbf7be53";

function caller() {
  return appRouter.createCaller({ req: {} as any, res: {} as any, user: null });
}

describe("packagepro catalogue", () => {
  it("lists curated packages and filters by theme", async () => {
    const all = await caller().packagepro.list();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(item => item.id.startsWith("pkg_") && item.currency === "INR")).toBe(true);
    const heritage = await caller().packagepro.list({ theme: "Heritage" });
    expect(heritage.length).toBeGreaterThan(0);
    expect(heritage.every(item => item.tags.includes("heritage"))).toBe(true);
    const food = await caller().packagepro.list({ theme: "Food trail" });
    expect(food.length).toBeGreaterThan(0);
    expect(food.every(item => item.tags.includes("food_trail"))).toBe(true);
  });

  it("personalizes recommendations using interests, destination, budget, and guide language", async () => {
    const result = await caller().packagepro.recommend({ query: "local food", language: "ta", destination: "Thanjavur", budget: 50000 });
    expect(result.packages[0]?.city).toBe("Thanjavur");
    expect(result.packages[0]?.matchReasons).toContain("your destination");
    expect(result.guides.every(guide => guide.city === "Thanjavur" && guide.languages.includes("ta"))).toBe(true);
    expect(result.destinationInsight?.city).toBe("Thanjavur");
    expect(result.destinationInsight?.summary).toContain("Chola");
  });
});

async function customiseThanjavur(budgetCap = 200000, dates = { departDate: "2026-09-02", returnDate: "2026-09-05" }) {
  const api = caller();
  let trip = await api.trip.create({ origin: "DEL", destination: "Thanjavur", ...dates, travelers: 1, budgetCap, language: "ta" });
  trip = await api.trip.selectFlight({ tripId: trip.tripId, flightId: [...trip.flightOptions].sort((a, b) => a.price - b.price)[0].id });
  return { api, trip };
}

describe("master trip flow", () => {
  it("creates a trip and starts at flight selection", async () => {
    const trip = await caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 50000, language: "ta" });
    expect(trip.status).toBe("select_flight");
    expect(trip.flightOptions.length).toBeGreaterThan(0);
  });

  it("rejects the same origin and destination", async () => {
    await expect(caller().trip.create({ origin: "DEL", destination: "New Delhi", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 20000, language: "en-IN" })).rejects.toThrow(/same/);
  });

  it("returns an over-budget flight to negotiate, then back to flight picker", async () => {
    const trip = await caller().trip.create({ origin: "DEL", destination: "Jaipur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 1, budgetCap: 2000, language: "en-IN" });
    const next = await caller().trip.selectFlight({ tripId: trip.tripId, flightId: trip.flightOptions[0].id });
    expect(next.status).toBe("negotiate");
    expect(next.runningTotal).toBe(0);
    const declined = await caller().trip.negotiate({ tripId: trip.tripId, choice: "remove_item" });
    expect(declined.status).toBe("select_flight");
  });

  it("loads the package into a customisable itinerary whose total is flight + prorated base", async () => {
    const { trip } = await customiseThanjavur();
    expect(trip.status).toBe("select_package");
    expect(trip.package?.city).toBe("Thanjavur");
    const expectedBase = Math.round(trip.package!.basePrice * 100 * 3 / trip.package!.duration) / 100;
    expect(trip.priceBreakdown.packageBase).toBeCloseTo(expectedBase, 2);
    expect(trip.runningTotal).toBeCloseTo(trip.chosenFlight!.price + expectedBase, 2);
    expect(trip.itinerary).toHaveLength(3);
    expect(trip.itinerary[0].items.some(item => item.kind === "hotel")).toBe(true);
    // the hotel is part of the package, not charged a second time
    expect(trip.priceBreakdown.total).toBe(trip.priceBreakdown.transport + trip.priceBreakdown.packageTotal + trip.priceBreakdown.guide);
  });

  it("reprices live when swapping the hotel tier, an activity and the transfer, and when adding an add-on", async () => {
    const { api, trip: start } = await customiseThanjavur();
    let trip = start;
    for (const type of ["hotel", "transfer", "experience"] as const) {
      const current = trip.packageComponents.find(item => item.type === type)!;
      const options = trip.package!.components.filter(item => item.swapGroup === current.swapGroup && item.id !== current.id);
      if (!options.length) continue;
      const before = trip.runningTotal;
      trip = await api.trip.swap({ tripId: trip.tripId, fromId: current.id, toId: options[0].id });
      expect(trip.packageComponents.some(item => item.id === options[0].id)).toBe(true);
      expect(trip.runningTotal).toBeCloseTo(before + options[0].price - current.price, 2);
    }
    const addOn = trip.packageComponents.find(item => item.optional && !item.included)!;
    const before = trip.runningTotal;
    trip = await api.trip.toggleAddOn({ tripId: trip.tripId, componentId: addOn.id, include: true });
    expect(trip.runningTotal).toBeCloseTo(before + addOn.price, 2);
    expect(trip.itinerary.some(day => day.items.some(item => item.componentId === addOn.id))).toBe(true);
    trip = await api.trip.toggleAddOn({ tripId: trip.tripId, componentId: addOn.id, include: false });
    expect(trip.runningTotal).toBeCloseTo(before, 2);
  });

  it("changes duration and reprices the package base", async () => {
    const { api, trip: start } = await customiseThanjavur();
    const trip = await api.trip.setDuration({ tripId: start.tripId, days: 5 });
    expect(trip.durationDays).toBe(5);
    expect(trip.returnDate).toBe("2026-09-07");
    expect(trip.itinerary).toHaveLength(5);
    expect(trip.priceBreakdown.packageBase).toBeCloseTo(Math.round(trip.package!.basePrice * 100 * 5 / trip.package!.duration) / 100, 2);
  });

  it("refuses an unavailable Tamil heritage guide, names the date, and reprices with the same-language substitute", async () => {
    const { api, trip: start } = await customiseThanjavur();
    let trip = await api.trip.selectGuide({ tripId: start.tripId, guideId: ARJUN, days: 3 });
    expect(trip.status).toBe("select_package");
    expect(trip.chosenGuide).toBeNull();
    const issue = trip.guideAvailabilityIssue!;
    expect(issue.conflictingDates).toEqual(["2026-09-02"]);
    expect(issue.requestedDates).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(issue.replacement?.id).toBe(MEERA);
    expect(issue.replacement?.specialisation).toBe("heritage");
    expect(issue.replacement?.languages).toContain("ta");
    expect(issue.replacementOptions[0]?.distanceKm).toBe(0);
    // Delta uses the dataset's per-date price multipliers (Meera 6000.00/day ×1, ×1.1, ×1 vs Arjun 2400.00/day ×1, ×1.1, ×1).
    expect(issue.priceDelta).toBe(3600 + 3960 + 3600);
    expect(issue.replacementOptions[0].newTotal).toBeCloseTo(start.runningTotal + 18600, 2);
    trip = await api.trip.selectGuide({ tripId: trip.tripId, guideId: MEERA, days: 3 });
    expect(trip.chosenGuide?.id).toBe(MEERA);
    expect(trip.runningTotal).toBeCloseTo(start.runningTotal + 18600, 2);
    expect(trip.itinerary.filter(day => day.items.some(item => item.kind === "guide"))).toHaveLength(3);
    trip = await api.trip.removeGuide({ tripId: trip.tripId });
    expect(trip.runningTotal).toBeCloseTo(start.runningTotal, 2);
  });

  it("blocks a guide with unknown availability instead of treating it as open", async () => {
    const { api, trip: start } = await customiseThanjavur(200000, { departDate: "2026-10-01", returnDate: "2026-10-03" });
    const guides = await api.trip.guides({ tripId: start.tripId });
    expect(guides.every(guide => guide.isAvailableForTrip === false)).toBe(true);
    const trip = await api.trip.selectGuide({ tripId: start.tripId, guideId: ARJUN, days: 2 });
    expect(trip.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-10-01", "2026-10-02"]);
    expect(trip.chosenGuide).toBeNull();
  });

  it("drops a booked guide with a named refusal when a duration change creates a clash", async () => {
    const { api, trip: start } = await customiseThanjavur(200000, { departDate: "2026-09-03", returnDate: "2026-09-05" });
    let trip = await api.trip.selectGuide({ tripId: start.tripId, guideId: ARJUN, days: 2 });
    expect(trip.chosenGuide?.id).toBe(ARJUN);
    trip = await api.trip.setDuration({ tripId: trip.tripId, days: 3 }); // adds 2026-09-05, when Arjun is unavailable
    expect(trip.chosenGuide).toBeNull();
    expect(trip.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-09-05"]);
    expect(trip.guideAvailabilityIssue?.replacement?.id).toBe(MEERA);
  });

  it("routes a guide that breaks the cap into negotiation instead of silently overcharging", async () => {
    const probe = await customiseThanjavur();
    const { api, trip: start } = await customiseThanjavur(Math.floor(probe.trip.runningTotal) + 1000);
    const trip = await api.trip.selectGuide({ tripId: start.tripId, guideId: MEERA, days: 3 });
    expect(trip.status).toBe("negotiate");
    expect(trip.chosenGuide).toBeNull();
    expect(trip.pending?.label).toContain("guide Meera Novak");
    const approved = await api.trip.negotiate({ tripId: trip.tripId, choice: "approve_overage" });
    expect(approved.chosenGuide?.id).toBe(MEERA);
    expect(approved.status).toBe("select_package");
  });

  it("completes the flow to confirmation", async () => {
    const { api, trip: start } = await customiseThanjavur();
    let trip = await api.trip.continuePackage({ tripId: start.tripId });
    expect(trip.status).toBe("review");
    trip = await api.trip.goBack({ tripId: trip.tripId });
    expect(trip.status).toBe("select_package");
    trip = await api.trip.continuePackage({ tripId: trip.tripId });
    trip = await api.trip.confirm({ tripId: trip.tripId });
    expect(trip.status).toBe("confirmed");
    await expect(api.trip.swap({ tripId: trip.tripId, fromId: "x", toId: "y" })).rejects.toThrow(/confirmed/);
  });

  it("auto-builds a complete Jaipur package from a natural trip request", async () => {
    const trip = await caller().trip.autoBuild({ origin: "DEL", destination: "JAI", departDate: "2026-09-25", returnDate: "2026-09-27", travelers: 1, language: "en-IN", interests: "heritage and food" });
    expect(trip.status).toBe("review");
    expect(trip.destination).toBe("Jaipur");
    expect(trip.chosenFlight).toBeTruthy();
    expect(trip.chosenHotel).toBeTruthy();
    expect(trip.package?.city).toBe("Jaipur");
    expect(trip.runningTotal).toBeLessThanOrEqual(trip.budgetCap);
  });

  it("supports a train fallback and a luxury hotel tier in auto-build", async () => {
    const trip = await caller().trip.autoBuild({ origin: "DEL", destination: "JAI", departDate: "2026-09-25", returnDate: "2026-09-27", travelers: 1, language: "en-IN", hotelTier: "luxury", transportMode: "train" });
    expect(trip.status).toBe("review");
    expect(trip.chosenTransport?.operator).toContain("Vande Bharat");
    const hotels = trip.package!.components.filter(item => item.type === "hotel");
    expect(trip.chosenHotel?.rating).toBe(Math.max(...hotels.map(item => Number(item.detail.match(/(\d)★/)?.[1] || 0))));
  });
});
