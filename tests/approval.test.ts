import { beforeEach, describe, expect, it } from "vitest";
import { clearGuideBookingsForTests, exportCanonicalRows, guideBookedCount } from "../backend/src/appStore";
import * as trips from "../backend/src/trips";

// Booking with a travel agent's approval: a request is written as booking_status 'pending' with the guide's dates held,
// then the agent approves (confirmed) or rejects (cancelled, dates released). Nothing is deleted.

const ARJUN = "gid_ad5b7c5f";
const DATES = { departDate: "2026-09-28", returnDate: "2026-10-01" };

async function readyForReview(withGuide = true) {
  const created = await trips.createTrip({ origin: "DEL", destination: "Thanjavur", ...DATES, travelers: 4, budgetCap: 900000, language: "ta", channel: "mobile_app" });
  await trips.selectFlight(created.tripId, [...created.flightOptions].sort((a, b) => a.price - b.price)[0].id);
  if (withGuide) trips.selectGuide(created.tripId, ARJUN, 3);
  return trips.continueFromPackage(created.tripId);
}

const bookingRow = (bookingId: string) => exportCanonicalRows().bookings.find(row => row.booking_id === bookingId)!;

describe("booking with a travel agent's approval", () => {
  beforeEach(() => clearGuideBookingsForTests());

  it("a request is pending, holds the guide's dates, and can't be edited or confirmed directly", async () => {
    const trip = await readyForReview();
    const asked = await trips.requestBooking(trip.tripId, { chatId: "777" });
    expect(asked.status).toBe("awaiting_approval");
    expect(asked.booking).toMatchObject({ status: "pending" });
    expect(asked.approval).toMatchObject({ chatId: "777", attempt: 1 });
    expect(bookingRow(asked.booking!.bookingId)).toMatchObject({ status: "pending", confirmed_at: null, channel: "mobile_app" });
    expect(guideBookedCount(ARJUN, "2026-09-29")).toBe(1); // held while the agent decides
    // A second traveller wanting Arjun on the same days is refused (his only slot on the 29th is held).
    const other = await readyForReview(false);
    const refused = trips.selectGuide(other.tripId, ARJUN, 3);
    expect(refused.chosenGuide).toBeNull();
    expect(refused.guideAvailabilityIssue?.conflictingDates).toContain("2026-09-29");
    await expect(trips.confirmTrip(trip.tripId)).rejects.toThrow(/waiting for the travel agent/);
    expect(() => trips.swapHotel(trip.tripId, "luxury")).toThrow();
    // Asking again while pending changes nothing.
    expect((await trips.requestBooking(trip.tripId)).booking?.bookingId).toBe(asked.booking!.bookingId);
  });

  it("approval confirms the booking and the held guide dates; a second approval changes nothing", async () => {
    const trip = await readyForReview();
    const asked = await trips.requestBooking(trip.tripId);
    const approved = trips.approveBooking(trip.tripId, "Priya (agent)");
    expect(approved.status).toBe("confirmed");
    expect(approved.approval).toMatchObject({ decision: "approved", decidedBy: "Priya (agent)" });
    const row = bookingRow(asked.booking!.bookingId);
    expect(row).toMatchObject({ status: "confirmed" });
    expect(row.confirmed_at).toBeTruthy();
    expect(exportCanonicalRows().trips.find(t => t.trip_id === trip.tripId)).toMatchObject({ status: "confirmed" });
    expect(guideBookedCount(ARJUN, "2026-09-29")).toBe(1);
    expect(trips.approveBooking(trip.tripId).status).toBe("confirmed");
  });

  it("rejection cancels the request (kept on record), frees the guide's dates, and the traveller can ask again", async () => {
    const trip = await readyForReview();
    const asked = await trips.requestBooking(trip.tripId);
    const rejected = trips.rejectBooking(trip.tripId, "Hotel has no rooms on those dates");
    expect(rejected.status).toBe("review");
    expect(rejected.booking).toBeNull();
    expect(rejected.approval).toMatchObject({ decision: "rejected", reason: "Hotel has no rooms on those dates" });
    expect(bookingRow(asked.booking!.bookingId)).toMatchObject({ status: "cancelled", cancellation_reason: "Hotel has no rooms on those dates" });
    expect(guideBookedCount(ARJUN, "2026-09-29")).toBe(0); // released
    const again = await trips.requestBooking(trip.tripId);
    expect(again.status).toBe("awaiting_approval");
    expect(again.booking!.bookingId).not.toBe(asked.booking!.bookingId);
    expect(again.approval?.attempt).toBe(2);
  });
});
