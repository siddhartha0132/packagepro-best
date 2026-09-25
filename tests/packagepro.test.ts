import { describe, expect, it } from "vitest";
import { appRouter } from "../backend/src/routers";
import { clearGuideBookingsForTests } from "../backend/src/appStore";

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
    const result = await caller().packagepro.recommend({ query: "temples and heritage", language: "ta", destination: "Thanjavur", budget: 50000 });
    expect(result.packages[0]?.city).toBe("Thanjavur");
    expect(result.packages[0]?.matchReasons).toContain("your destination");
    expect(result.guides.every(guide => guide.city === "Thanjavur" && guide.languages.includes("ta"))).toBe(true);
    expect(result.destinationInsight?.city).toBe("Thanjavur");
    expect(result.destinationInsight?.summary).toContain("Chola");
  });

  it("changes the picks with the mood instead of always leading with the chosen destination", async () => {
    const pick = (query: string) => caller().packagepro.recommend({ query, language: "en-IN", destination: "Jaipur", budget: 40000 });
    const beaches = await pick("Beaches & slow food");
    const mountains = await pick("Mountains & treks");
    const pilgrimage = await pick("Pilgrimage & dawn rituals");
    expect(new Set([beaches, mountains, pilgrimage].map(result => result.packages[0].city)).size).toBe(3);
    expect(beaches.packages.map(pkg => pkg.city)).not.toContain("Jaipur");
    expect(beaches.packages[0].matchReasons).toContain("fit beach");
    // The home grid reorders by this list: every package that fits the mood, best first.
    expect(beaches.moodMatches[0]).toBe(beaches.packages[0].id);
    expect(beaches.moodMatches.length).toBeGreaterThan(3);
    expect(mountains.packages[0].matchReasons).toContain("fit mountains");
    expect(pilgrimage.packages[0].tags[0]).toBe("pilgrimage");
    // A mood that fits the destination still puts it on the shortlist.
    expect((await pick("Heritage & living temples")).packages.map(pkg => pkg.city)).toContain("Jaipur");
  });
});

// Thanjavur Honeymoon takes groups of 4–8 (tour_packages.min_group_size / max_group_size), so the flows use a party of 4.
async function customiseThanjavur(budgetCap = 500000, dates = { departDate: "2026-09-02", returnDate: "2026-09-05" }) {
  const api = caller();
  let trip = await api.trip.create({ origin: "DEL", destination: "Thanjavur", ...dates, travelers: 4, budgetCap, language: "ta" });
  trip = await api.trip.selectFlight({ tripId: trip.tripId, flightId: [...trip.flightOptions].sort((a, b) => a.price - b.price)[0].id });
  return { api, trip };
}

describe("master trip flow", () => {
  it("creates a trip and starts at flight selection", async () => {
    const trip = await caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 500000, language: "ta" });
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

  it("offers priced budget fixes when a change breaks the cap, and applying one fits the plan without leaving the budget", async () => {
    const api = caller();
    const draft = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 500000, language: "ta" });
    const flights = [...draft.flightOptions].sort((a, b) => a.price - b.price);
    // A cap just under the cheapest plan: no cheaper flight exists, so the fixes must come from the package itself.
    const probe = await api.trip.selectFlight({ tripId: draft.tripId, flightId: flights[0].id });
    const cheapestTotal = probe.runningTotal;
    const tight = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: Math.floor(cheapestTotal - 500), language: "ta" });
    const over = await api.trip.selectFlight({ tripId: tight.tripId, flightId: flights[0].id });
    expect(over.status).toBe("negotiate");
    const fixes = over.pending!.fixes;
    expect(fixes.length).toBeGreaterThan(0);
    // Every fix is priced on the whole plan: saving = pending total − new total.
    for (const fix of fixes) expect(fix.newTotal).toBeCloseTo(over.pending!.total! - fix.saving, 1);
    expect(over.negotiationOptions.map(option => option.choice)).toEqual(["approve_overage", "swap_cheaper", "raise_cap"]);
    const fitting = fixes.find(fix => fix.fits)!;
    expect(fitting).toBeTruthy();
    const applied = await api.trip.negotiate({ tripId: tight.tripId, choice: "apply_fix", fixId: fitting.id });
    expect(applied.status).toBe("select_package");
    expect(applied.runningTotal).toBeLessThanOrEqual(applied.budgetCap);
    expect(applied.runningTotal).toBeCloseTo(fitting.newTotal, 1);
    expect(applied.chosenFlight?.id).toBe(flights[0].id);
  });

  it("keeps customising after an approved overage: cheaper changes apply at once, dearer ones ask for just the new extra", async () => {
    const api = caller();
    const draft = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 1000, language: "ta" });
    const flight = [...draft.flightOptions].sort((a, b) => a.price - b.price)[0];
    const over = await api.trip.selectFlight({ tripId: draft.tripId, flightId: flight.id });
    expect(over.status).toBe("negotiate");
    const approved = await api.trip.negotiate({ tripId: draft.tripId, choice: "approve_overage" });
    expect(approved.status).toBe("select_package");
    expect(approved.runningTotal).toBeGreaterThan(approved.budgetCap);
    const hotel = approved.packageComponents.find(item => item.type === "hotel")!;
    const options = approved.package!.components.filter(item => item.swapGroup === hotel.swapGroup && item.id !== hotel.id).sort((a, b) => a.price - b.price);
    const cheaper = options.find(item => item.price < hotel.price);
    if (cheaper) {
      const swapped = await api.trip.swap({ tripId: draft.tripId, fromId: hotel.id, toId: cheaper.id });
      expect(swapped.status).toBe("select_package");
      expect(swapped.runningTotal).toBeLessThan(approved.runningTotal);
    }
    const current = (await api.trip.get({ tripId: draft.tripId })).packageComponents.find(item => item.type === "hotel")!;
    const dearer = options.filter(item => item.price > current.price).pop();
    if (dearer) {
      const before = (await api.trip.get({ tripId: draft.tripId })).runningTotal;
      const asked = await api.trip.swap({ tripId: draft.tripId, fromId: current.id, toId: dearer.id });
      expect(asked.status).toBe("negotiate");
      const extra = asked.negotiationOptions.find(option => option.choice === "approve_overage")!.amount!;
      expect(extra).toBeCloseTo(asked.pending!.total! - before, 1);
      expect(extra).toBeLessThan(asked.pending!.overage!);
    }
  });

  it("recommends upgrades that fit, and supports undo and discarding back to the recommended package", async () => {
    const api = caller();
    const draft = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 900000, language: "ta" });
    const loaded = await api.trip.selectFlight({ tripId: draft.tripId, flightId: [...draft.flightOptions].sort((a, b) => a.price - b.price)[0].id });
    expect(loaded.canUndo).toBe(false);
    expect(loaded.suggestions.length).toBeGreaterThan(0);
    for (const item of loaded.suggestions) {
      expect(item.direction).toBe("upgrade");
      expect(item.fits).toBe(true);
      expect(item.newTotal).toBeGreaterThan(loaded.runningTotal);
    }
    const pick = loaded.suggestions[0];
    const applied = await api.trip.applySuggestion({ tripId: draft.tripId, suggestionId: pick.id });
    expect(applied.runningTotal).toBeCloseTo(pick.newTotal, 1);
    expect(applied.canUndo).toBe(true);
    const undone = await api.trip.undo({ tripId: draft.tripId });
    expect(undone.runningTotal).toBeCloseTo(loaded.runningTotal, 1);
    // Several changes, then discard: back to the package's recommended components.
    await api.trip.applySuggestion({ tripId: draft.tripId, suggestionId: (await api.trip.get({ tripId: draft.tripId })).suggestions[0].id });
    await api.trip.setDuration({ tripId: draft.tripId, days: 2 });
    const discarded = await api.trip.discardChanges({ tripId: draft.tripId });
    expect(discarded.durationDays).toBe(loaded.durationDays);
    expect(discarded.packageComponents.map(item => item.id)).toEqual(loaded.packageComponents.map(item => item.id));
    expect(discarded.runningTotal).toBeCloseTo(loaded.runningTotal, 1);
  });

  it("keeps swaps in context: same day and slot, transfers from where you arrive, nothing dropped off a shorter trip", async () => {
    const api = caller();
    const draft = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 900000, language: "ta" });
    const trip = await api.trip.selectFlight({ tripId: draft.tripId, flightId: [...draft.flightOptions].sort((a, b) => a.price - b.price)[0].id });
    const labelOf = (id: string) => trip.package!.components.find(item => item.id === id)!.label;
    // Arriving by air: every transfer alternative starts at the airport.
    for (const [componentId, options] of Object.entries(trip.swapOptions)) {
      const line = trip.packageComponents.find(item => item.id === componentId)!;
      if (line.type === "transfer") for (const id of options) expect(labelOf(id)).toMatch(/^Airport →/);
    }
    // A swapped activity takes the replaced one's day and slot.
    const activity = trip.packageComponents.find(item => item.type === "experience" && trip.swapOptions[item.id]?.length);
    if (activity) {
      const swapped = await api.trip.swap({ tripId: draft.tripId, fromId: activity.id, toId: trip.swapOptions[activity.id][0] });
      const line = swapped.packageComponents.find(item => item.id === trip.swapOptions[activity.id][0])!;
      expect([line.dayIndex, line.slot]).toEqual([activity.dayIndex, activity.slot]);
      await api.trip.undo({ tripId: draft.tripId });
    }
    // Every included, priced line appears in the itinerary even after the trip is shortened.
    const short = await api.trip.setDuration({ tripId: draft.tripId, days: 2 });
    const shown = new Set(short.itinerary.flatMap(day => day.items).map(item => item.componentId).filter(Boolean));
    for (const line of short.packageComponents.filter(item => item.included)) expect(shown.has(line.id)).toBe(true);
  });

  it("suggests a cheaper flight as the gentlest fix for an expensive fare", async () => {
    const api = caller();
    const draft = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 1, language: "ta" });
    const flights = [...draft.flightOptions].sort((a, b) => b.price - a.price);
    const cheapest = flights[flights.length - 1];
    // Cap between the cheapest and the dearest plan, then pick the dearest fare.
    const cap = Math.round(await (async () => { const t = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: 900000, language: "ta" }); return (await api.trip.selectFlight({ tripId: t.tripId, flightId: cheapest.id })).runningTotal + 1000; })());
    const trip = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-02", returnDate: "2026-09-05", travelers: 4, budgetCap: cap, language: "ta" });
    const over = await api.trip.selectFlight({ tripId: trip.tripId, flightId: flights[0].id });
    if (flights[0].price === cheapest.price) return; // offline fares may all cost the same
    expect(over.status).toBe("negotiate");
    const flightFix = over.pending!.fixes.find(fix => fix.kind === "flight" && fix.fits);
    expect(flightFix).toBeTruthy();
    const applied = await api.trip.negotiate({ tripId: trip.tripId, choice: "apply_fix", fixId: flightFix!.id });
    expect(applied.status).toBe("select_package");
    expect(applied.chosenFlight!.price).toBeLessThan(flights[0].price);
  });

  it("prices the package as base + every kept component (PS-04 rule), so the itinerary lines add up to the total", async () => {
    const { trip } = await customiseThanjavur();
    expect(trip.status).toBe("select_package");
    expect(trip.package?.city).toBe("Thanjavur");
    const b = trip.priceBreakdown;
    expect(b.party).toEqual({ pax: 4, rooms: 2, vehicles: 1 });
    const expectedBase = Math.round(trip.package!.basePrice * 100 * 3 / trip.package!.duration) / 100 * 4;
    expect(b.packageBase).toBeCloseTo(expectedBase, 2);
    expect(b.transport).toBeCloseTo(trip.chosenFlight!.price * 4, 2);
    expect(trip.itinerary).toHaveLength(3);
    expect(trip.itinerary[0].items.some(item => item.kind === "hotel")).toBe(true);
    // transparent pricing: base + the priced itinerary lines = the package total, to the paisa
    const lines = trip.itinerary.flatMap(day => day.items).filter(item => item.kind !== "guide" && item.kind !== "arrival" && item.price != null);
    const linesPaise = lines.reduce((sum, item) => sum + Math.round(item.price! * 100), 0);
    expect(Math.round(b.packageBase * 100) + linesPaise).toBe(Math.round(b.packageTotal * 100));
    expect(Math.round(b.total * 100)).toBe(Math.round((b.transport + b.packageTotal + b.guide) * 100));
  });

  it("reprices live when swapping the hotel tier, an activity and the transfer, and when adding an add-on", async () => {
    const { api, trip: start } = await customiseThanjavur();
    let trip = start;
    for (const type of ["hotel", "transfer", "experience"] as const) {
      const current = trip.packageComponents.find(item => item.type === type)!;
      const options = trip.package!.components.filter(item => item.swapGroup === current.swapGroup && item.id !== current.id);
      if (!options.length) continue;
      const before = trip.runningTotal;
      const { party, nightsFactor } = trip.priceBreakdown;
      const factor = type === "hotel" ? party.rooms * nightsFactor : type === "transfer" ? party.vehicles : party.pax;
      trip = await api.trip.swap({ tripId: trip.tripId, fromId: current.id, toId: options[0].id });
      expect(trip.packageComponents.some(item => item.id === options[0].id)).toBe(true);
      expect(trip.runningTotal).toBeCloseTo(before + (options[0].price - current.price) * factor, 1);
    }
    const addOn = trip.packageComponents.find(item => item.optional && !item.included)!;
    const before = trip.runningTotal;
    trip = await api.trip.toggleAddOn({ tripId: trip.tripId, componentId: addOn.id, include: true });
    expect(trip.runningTotal).toBeCloseTo(before + addOn.price * 4, 2);
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
    expect(trip.priceBreakdown.packageBase).toBeCloseTo(Math.round(trip.package!.basePrice * 100 * 5 / trip.package!.duration) / 100 * 4, 2);
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
    expect(trip.booking?.bookingId).toMatch(/^bkg_/);
    const bookings = await api.trip.bookings();
    expect(bookings.some(row => (row as { trip_id: string }).trip_id === trip.tripId)).toBe(true);
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

describe("party pricing", () => {
  it("prices flights and the package per person, hotel swaps per room and the guide per group", async () => {
    const plan = async (travelers: number) => {
      const created = await caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers, budgetCap: 900000, language: "ta" });
      return caller().trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });
    };
    const solo = await plan(4);
    const trio = await plan(8);
    expect(solo.priceBreakdown.party).toEqual({ pax: 4, rooms: 2, vehicles: 1 });
    expect(trio.priceBreakdown.party).toEqual({ pax: 8, rooms: 4, vehicles: 2 });
    expect(trio.priceBreakdown.transport).toBeCloseTo(solo.priceBreakdown.transport * 2, 2);
    expect(trio.priceBreakdown.packageBase).toBeCloseTo(solo.priceBreakdown.packageBase * 2, 2);
    expect(trio.priceBreakdown.components).toBeCloseTo(solo.priceBreakdown.components * 2, 1);

    const hotel = trio.packageComponents.find(item => item.type === "hotel")!;
    const upgrade = (await caller().packagepro.alternatives({ packageId: trio.package!.id, componentId: hotel.id }))[0];
    const swapped = await caller().trip.swap({ tripId: trio.tripId, fromId: hotel.id, toId: upgrade.id });
    expect(swapped.priceBreakdown.swapAdjustments).toBeCloseTo((upgrade.price - hotel.price) * 4 * swapped.priceBreakdown.nightsFactor, 1);

    const guided = await caller().trip.selectGuide({ tripId: trio.tripId, guideId: ARJUN, days: 3 });
    const soloGuided = await caller().trip.selectGuide({ tripId: solo.tripId, guideId: ARJUN, days: 3 });
    expect(guided.priceBreakdown.guide).toBeCloseTo(soloGuided.priceBreakdown.guide, 2);
  });

  it("scales the live estimate with the party", async () => {
    const base = { origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", budget: 100000, language: "ta" };
    const one = await caller().packagepro.estimate({ ...base, travelers: 4 });
    const two = await caller().packagepro.estimate({ ...base, travelers: 8 });
    expect(two.package.forTrip).toBeCloseTo(one.package.forTrip * 2, 0);
    expect(two.low).toBeGreaterThan(one.low * 1.9);
    expect(one.groupSize).toEqual({ min: 4, max: 8, ok: true });
    expect((await caller().packagepro.estimate({ ...base, travelers: 1 })).groupSize.ok).toBe(false);
  });
});

describe("guide bookings hold real slots", () => {
  // Dataset slots for Arjun Nair: 28 Sept = 2, 29 Sept = 1, 30 Sept = 1. A confirmed booking uses one slot per date.
  const planWithArjun = async () => {
    const created = await caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 900000, language: "ta" });
    await caller().trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });
    return caller().trip.selectGuide({ tripId: created.tripId, guideId: ARJUN, days: 3 });
  };

  it("blocks the next traveller once a confirmed trip holds the guide's last slot", async () => {
    clearGuideBookingsForTests();
    const first = await planWithArjun();
    expect(first.chosenGuide?.id).toBe(ARJUN);
    const booked = await caller().trip.confirm({ tripId: first.tripId });
    expect(booked.status).toBe("confirmed");

    const second = await planWithArjun();
    expect(second.chosenGuide).toBeNull();
    expect(second.guideAvailabilityIssue?.guide.id).toBe(ARJUN);
    expect(second.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-09-29", "2026-09-30"]);
    expect(second.guideAvailabilityIssue?.guide.availability).toMatchObject({ "2026-09-28": true, "2026-09-29": false, "2026-09-30": false });
    const listed = (await caller().trip.guides({ tripId: second.tripId })).find(guide => guide.id === ARJUN)!;
    expect(listed.isAvailableForTrip).toBe(false);
    expect(listed.unavailableDates).toEqual(["2026-09-29", "2026-09-30"]);

    const bookings = await caller().trip.bookings();
    expect(bookings.find(row => row.trip_id === first.tripId)).toMatchObject({ guide_id: ARJUN, guide_dates: "2026-09-28, 2026-09-29, 2026-09-30" });
  });

  it("re-checks at confirmation: the second of two travellers holding the same guide is refused, not booked", async () => {
    clearGuideBookingsForTests();
    const a = await planWithArjun();
    const b = await planWithArjun();
    expect(a.chosenGuide?.id).toBe(ARJUN);
    expect(b.chosenGuide?.id).toBe(ARJUN);
    expect((await caller().trip.confirm({ tripId: a.tripId })).status).toBe("confirmed");
    const late = await caller().trip.confirm({ tripId: b.tripId });
    expect(late.status).toBe("select_package");
    expect(late.booking ?? null).toBeNull();
    expect(late.chosenGuide).toBeNull();
    expect(late.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-09-29", "2026-09-30"]);
    expect(late.runningTotal).toBeLessThan(b.runningTotal);
  });
});

describe("PS-04 boundary rules are enforced in the backend", () => {
  const trip = (overrides: Record<string, unknown>) => caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 500000, language: "ta", ...overrides } as never);

  it("rejects a party outside tour_packages.min_group_size … max_group_size", async () => {
    await expect(trip({ travelers: 1 })).rejects.toThrow(/takes groups of 4–8 travellers/);
    await expect(trip({ travelers: 9 })).rejects.toThrow(/takes groups of 4–8 travellers/);
    await expect(trip({ travelers: 4 })).resolves.toMatchObject({ travelers: 4 });
    await expect(trip({ travelers: 8 })).resolves.toMatchObject({ travelers: 8 });
  });

  it("accepts only BCP-47 language tags from the languages table (R6)", async () => {
    await expect(trip({ language: "Tamil" })).rejects.toThrow(/BCP-47/);
    await expect(trip({ language: "ta" })).resolves.toMatchObject({ language: "ta" });
  });

  it("returns an estimate that flags a party outside the package's group size", async () => {
    const estimate = await caller().packagepro.estimate({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 2, budget: 100000, language: "ta" });
    expect(estimate.groupSize).toEqual({ min: 4, max: 8, ok: false });
  });
});

describe("traveller profile (users + user_preferences + booking history)", () => {
  it("serves demo travellers whose languages and interests come from user_preferences", async () => {
    const travellers = await caller().packagepro.travellers();
    expect(travellers.length).toBeGreaterThanOrEqual(4);
    const tamil = travellers.find(item => item.guideLanguage === "ta")!;
    expect(tamil.userId).toMatch(/^usr_/);
    expect(tamil.preferredLanguages).toContain("ta");
    expect(tamil.pastTrips).toBeGreaterThan(0);
    expect(tamil.recentTrips.length).toBeGreaterThan(0);
    expect(travellers.some(item => item.pastTrips === 0)).toBe(true); // a cold-start traveller
  });

  it("owns trips by the chosen dataset user and rejects unknown users", async () => {
    const [first] = await caller().packagepro.travellers();
    const trip = await caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 500000, language: "ta", userId: first.userId });
    expect(trip.userId).toBe(first.userId);
    await expect(caller().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 500000, language: "ta", userId: "usr_nobody00" })).rejects.toThrow(/Unknown traveller/);
  });
});

describe("day-by-day guide planning", () => {
  it("books a guide only on the days they are free, covers the rest with another guide, and reserves each guide's own dates", async () => {
    clearGuideBookingsForTests();
    const api = caller();
    const created = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 900000, language: "ta" });
    let trip = await api.trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });

    // Whole trip: the mandatory rule still refuses Meera (unavailable on 28 Sept).
    trip = await api.trip.selectGuide({ tripId: trip.tripId, guideId: MEERA, days: 3 });
    expect(trip.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-09-28"]);

    // Day by day: Meera on the two days she is free, Arjun on the 28th.
    trip = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: MEERA, dates: ["2026-09-29", "2026-09-30"] });
    expect(trip.chosenGuide).toMatchObject({ id: MEERA, bookedDates: ["2026-09-29", "2026-09-30"], wholeTrip: false });
    trip = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: ARJUN, dates: ["2026-09-28"] });
    expect(trip.guidePlan.map(day => day.guideId)).toEqual([ARJUN, MEERA, MEERA]);
    const costs = Object.fromEntries((await api.trip.guides({ tripId: trip.tripId })).map(guide => [guide.id, guide.dayCosts]));
    expect(trip.priceBreakdown.guide).toBeCloseTo(costs[ARJUN]["2026-09-28"] + costs[MEERA]["2026-09-29"] + costs[MEERA]["2026-09-30"], 2);
    expect(trip.itinerary[0].items.find(item => item.kind === "guide")?.label).toBe("Guide: Arjun Nair");
    expect(trip.itinerary[1].items.find(item => item.kind === "guide")?.label).toBe("Guide: Meera Novak");

    // Reassigning a day moves it; the other guide keeps the rest.
    trip = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: ARJUN, dates: ["2026-09-29"] });
    expect(trip.guidePlan.map(day => day.guideId)).toEqual([ARJUN, ARJUN, MEERA]);

    // A picked date that clashes is refused with that date named, and the plan is unchanged.
    const refused = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: MEERA, dates: ["2026-09-28"] });
    expect(refused.guideAvailabilityIssue?.conflictingDates).toEqual(["2026-09-28"]);
    expect(refused.guidePlan.map(day => day.guideId)).toEqual([ARJUN, ARJUN, MEERA]);

    // Booking reserves each guide on its own dates only.
    const booked = await api.trip.confirm({ tripId: (await api.trip.continuePackage({ tripId: trip.tripId })).tripId });
    expect(booked.status).toBe("confirmed");
    const afterMeera = (await api.packagepro.guides({ city: "Thanjavur", language: "ta" })).find(guide => guide.id === MEERA)!;
    expect(afterMeera.availability["2026-09-29"]).toBe(true); // Meera has 2 slots on the 29th and was not booked that day
    const afterArjun = (await api.packagepro.guides({ city: "Thanjavur", language: "ta" })).find(guide => guide.id === ARJUN)!;
    expect(afterArjun.availability["2026-09-29"]).toBe(false); // Arjun's single slot on the 29th is now taken
  });

  it("removes one guide from a day-by-day plan and keeps the other", async () => {
    clearGuideBookingsForTests();
    const api = caller();
    const created = await api.trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 900000, language: "ta" });
    let trip = await api.trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });
    trip = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: ARJUN, dates: ["2026-09-28"] });
    trip = await api.trip.bookGuideDays({ tripId: trip.tripId, guideId: MEERA, dates: ["2026-09-29", "2026-09-30"] });
    trip = await api.trip.removeGuide({ tripId: trip.tripId, guideId: ARJUN });
    expect(trip.guidePlan.map(day => day.guideId)).toEqual([null, MEERA, MEERA]);
    expect(trip.chosenGuide?.id).toBe(MEERA);
  });
});

describe("estimate ordering", () => {
  it("never prices the typical option below the cheapest (Value ≤ Recommended ≤ Premium)", async () => {
    const estimate = await caller().packagepro.estimate({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budget: 300000, language: "ta" });
    expect(estimate.low).toBeLessThanOrEqual(estimate.typical);
    expect(estimate.typical).toBeLessThanOrEqual(estimate.high);
    expect(estimate.flights.typical).toBeGreaterThanOrEqual(estimate.flights.low);
  });
});
