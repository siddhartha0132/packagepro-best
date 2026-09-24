import { beforeEach, describe, expect, it } from "vitest";
import { clearGuideBookingsForTests } from "./appStore";
import { appRouter } from "./routers";

// PS-04 mandatory enhancement — Guide Availability Check. The hard proof, in the statement's own words:
// "Guide added to a package whose dates clash. Refusal names the date. Substitute offered with the same language and
//  specialisation. Total reprices live."
//
// Dataset facts (guide_availability): in Thanjavur, Meera Novak (ta, heritage) is unavailable on 2026-09-28;
// Arjun Nair (ta, heritage) is available 28–30 Sept. The package takes groups of 4–8.

const MEERA = "gid_dbf7be53";
const ARJUN = "gid_ad5b7c5f";
const api = () => appRouter.createCaller({ req: {} as never, res: {} as never, user: null });

describe("hard proof: guide availability check", () => {
  beforeEach(() => clearGuideBookingsForTests());

  it("refuses a clashing guide, names the date, offers a same-language same-specialisation substitute and reprices", async () => {
    const created = await api().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 500000, language: "ta" });
    const planned = await api().trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });
    const before = planned.runningTotal;

    // 1. Guide added to a package whose dates clash → refused, not booked.
    const refused = await api().trip.selectGuide({ tripId: planned.tripId, guideId: MEERA, days: 3 });
    expect(refused.chosenGuide).toBeNull();
    expect(refused.runningTotal).toBe(before);

    // 2. Refusal names the date.
    const issue = refused.guideAvailabilityIssue!;
    expect(issue.guide.id).toBe(MEERA);
    expect(issue.conflictingDates).toEqual(["2026-09-28"]);
    expect(issue.requestedDates).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);

    // 3. Substitute offered with the same language and specialisation.
    const substitute = issue.replacementOptions[0];
    expect(substitute.guide.id).toBe(ARJUN);
    expect(substitute.guide.languages).toContain("ta");
    expect(substitute.guide.specialisation).toBe(issue.guide.specialisation);
    expect(substitute.distanceKm).toBe(0);

    // 4. Total reprices live: the offer states the new total, and booking the substitute lands exactly on it.
    expect(substitute.newTotal).toBeCloseTo(before + substitute.totalCost, 2);
    const booked = await api().trip.selectGuide({ tripId: planned.tripId, guideId: ARJUN, days: 3 });
    expect(booked.chosenGuide?.id).toBe(ARJUN);
    expect(booked.runningTotal).toBeCloseTo(substitute.newTotal, 2);
    expect(booked.itinerary.filter(day => day.items.some(item => item.kind === "guide"))).toHaveLength(3);
  });
});
