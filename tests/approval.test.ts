import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearGuideBookingsForTests, exportCanonicalRows, guideBookedCount } from "../backend/src/appStore";
import * as trips from "../backend/src/trips";
import { appRouter } from "../backend/src/routers";
import { normalisePhone } from "../backend/src/travellerMessages";
import type { TrpcContext } from "../backend/src/_core/context";

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

describe("travel agent counter-offers", () => {
  beforeEach(() => clearGuideBookingsForTests());

  async function requested() {
    const trip = await readyForReview();
    await trips.requestBooking(trip.tripId, { chatId: "888" });
    return trip.tripId;
  }
  const hotelSwap = (tripId: string) => {
    const hotel = trips.counterChoices(tripId).swaps.find(line => line.type === "hotel")!;
    return { fromId: hotel.componentId, toId: hotel.options[0].id, delta: hotel.options[0].delta };
  };

  it("prices a counter-offer change by change, keeps the request pending, and books the changed plan when accepted", async () => {
    const tripId = await requested();
    const before = trips.getTrip(tripId);
    const swap = hotelSwap(tripId);
    const preview = trips.previewCounter(tripId, { swaps: [swap], adjustment: -2000 });
    expect(preview.oldTotal).toBe(before.runningTotal);
    expect(preview.changes.map(change => change.kind)).toEqual(["swap", "adjustment"]);
    expect(preview.changes[0].delta).toBeCloseTo(swap.delta, 2);
    expect(preview.newTotal).toBeCloseTo(before.runningTotal + swap.delta - 2000, 2);

    const offered = trips.proposeCounter(tripId, { swaps: [swap], adjustment: -2000, note: "Better rooms, and ₹2,000 off" }, "Priya (travel agent)");
    expect(offered.status).toBe("awaiting_approval");
    expect(offered.approval?.counter).toMatchObject({ status: "open", note: "Better rooms, and ₹2,000 off", newTotal: preview.newTotal });
    expect(offered.runningTotal).toBe(before.runningTotal); // nothing changes until the traveller accepts
    expect(guideBookedCount(ARJUN, "2026-09-29")).toBe(1);

    const booked = await trips.acceptCounter(tripId);
    expect(booked.status).toBe("confirmed");
    expect(booked.runningTotal).toBeCloseTo(preview.newTotal, 2);
    expect(booked.priceBreakdown.adjustment).toBe(-2000);
    expect(booked.approval).toMatchObject({ decision: "approved", decidedBy: "Priya (travel agent)", counter: { status: "accepted" } });
    expect(booked.chosenHotel?.id).toBe(swap.toId);
    const rows = exportCanonicalRows().bookings.filter(row => row.trip_id === tripId);
    expect(rows.map(row => row.status).sort()).toEqual(["cancelled", "confirmed"]);
    expect(rows.find(row => row.status === "cancelled")?.cancellation_reason).toMatch(/counter-offer/);
    expect(Number(rows.find(row => row.status === "confirmed")?.total_amount)).toBeCloseTo(preview.newTotal, 2);
    expect(guideBookedCount(ARJUN, "2026-09-29")).toBe(1); // re-held, not doubled
  });

  it("declining keeps the original request with the agent; approving withdraws an open offer", async () => {
    const tripId = await requested();
    const total = trips.getTrip(tripId).runningTotal;
    trips.proposeCounter(tripId, { adjustment: 1500, note: "Festival surcharge" });
    expect(trips.declineCounter(tripId)).toMatchObject({ status: "awaiting_approval", approval: { counter: { status: "declined" } } });
    await expect(trips.acceptCounter(tripId)).rejects.toThrow(/no open counter-offer/);
    trips.proposeCounter(tripId, { adjustment: -500 });
    const approved = trips.approveBooking(tripId, "Priya (travel agent)");
    expect(approved).toMatchObject({ status: "confirmed", runningTotal: total, approval: { counter: { status: "withdrawn" } } });
    expect(approved.priceBreakdown.adjustment).toBe(0);
  });

  it("refuses empty or invalid counter-offers and offers only on pending requests", async () => {
    const tripId = await requested();
    expect(() => trips.proposeCounter(tripId, {})).toThrow(/at least one change/);
    expect(() => trips.proposeCounter(tripId, { swaps: [{ fromId: "nope", toId: "nope" }] })).toThrow(/Not a valid swap/);
    expect(() => trips.proposeCounter(tripId, { adjustment: -10_000_000 })).toThrow(/zero/);
    const other = await readyForReview(false);
    expect(() => trips.proposeCounter(other.tripId, { adjustment: -100 })).toThrow(/no booking request/);
  });
});

describe("itinerary reads in the order the trip happens", () => {
  beforeEach(() => clearGuideBookingsForTests());

  it("starts day 1 when the traveller lands, fills empty days, and ends with check-out on the return date", async () => {
    const created = await trips.createTrip({ origin: "DEL", destination: "Thanjavur", ...DATES, travelers: 4, budgetCap: 900000, language: "ta" });
    const late = created.flightOptions.find(flight => Number(flight.arrive?.slice(0, 2)) >= 17)!;
    const trip = await trips.selectFlight(created.tripId, late.id);
    const [first, ...rest] = trip.itinerary;
    expect(first.items[0]).toMatchObject({ kind: "arrival", slot: "evening", time: late.arrive });
    // Nothing on day 1 is planned before the evening landing, and the airport transfer comes right after it.
    expect(first.items.filter(item => item.kind !== "hotel").every(item => item.slot === "evening")).toBe(true);
    expect(first.items[1].kind).toBe("transfer");
    expect(first.items.at(-1)?.kind).toBe("hotel");
    for (const day of rest) expect(day.items.some(item => ["experience", "meal", "entry_ticket", "leisure"].includes(item.kind))).toBe(true);
    expect(trip.departureDay).toMatchObject({ day: trip.durationDays + 1, date: trip.returnDate });
    expect(trip.departureDay?.items[0].label).toMatch(/^Check out: /);
    // Free time is shown, never priced or booked.
    expect(trip.itinerary.flatMap(day => day.items).filter(item => item.kind === "leisure").every(item => item.price == null)).toBe(true);
    const booked = await trips.confirmTrip(trips.continueFromPackage(trip.tripId).tripId);
    const items = exportCanonicalRows().itinerary_items.filter(row => row.itinerary_id === booked.booking!.itineraryId);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(row => /Free time/.test(String(row.title)))).toBe(false);
  });

  it("an early flight keeps the morning plans", async () => {
    const created = await trips.createTrip({ origin: "DEL", destination: "Thanjavur", ...DATES, travelers: 4, budgetCap: 900000, language: "ta" });
    const early = created.flightOptions.find(flight => Number(flight.arrive?.slice(0, 2)) < 12)!;
    const trip = await trips.selectFlight(created.tripId, early.id);
    expect(trip.itinerary[0].items[0]).toMatchObject({ kind: "arrival", slot: "morning" });
    expect(trip.itinerary[0].items.some(item => item.kind === "experience" && item.slot === "morning")).toBe(true);
  });
});

describe("travel desk API", () => {
  const caller = (key?: string) => appRouter.createCaller({ user: null, req: { protocol: "https", headers: key ? { "x-agent-key": key } : {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
  beforeAll(() => { process.env.AGENT_DASHBOARD_KEY = "desk-test-key"; });
  afterAll(() => { delete process.env.AGENT_DASHBOARD_KEY; });
  beforeEach(() => clearGuideBookingsForTests());

  it("needs the desk key, lists waiting requests, and turns approvals on for travellers", async () => {
    expect(await caller().agent.mode()).toMatchObject({ approvalRequired: true, dashboard: true });
    await expect(caller().agent.list()).rejects.toThrow(/Travel desk key required/);
    await expect(caller("wrong-key-00").agent.list()).rejects.toThrow(/Travel desk key required/);
    const trip = await readyForReview();
    await caller().trip.requestBooking({ tripId: trip.tripId, email: "asha@example.com" });
    const desk = caller("desk-test-key");
    const list = await desk.agent.list();
    expect(list.waiting.map(item => item.tripId)).toContain(trip.tripId);
    const detail = await desk.agent.get({ tripId: trip.tripId });
    expect(detail.trip.approval?.contact?.email).toBe("asha@example.com");
    expect(detail.choices?.swaps.length).toBeGreaterThan(0);
  });

  it("approves once; a second decision is refused", async () => {
    const trip = await readyForReview();
    await caller().trip.requestBooking({ tripId: trip.tripId, phone: "98765 43210" });
    const desk = caller("desk-test-key");
    expect((await desk.agent.approve({ tripId: trip.tripId, agentName: "Priya" })).approval).toMatchObject({ decision: "approved", decidedBy: "Priya (travel agent)" });
    await expect(desk.agent.reject({ tripId: trip.tripId, reason: "Too late" })).rejects.toThrow(/already decided/);
  });

  it("a website request needs a mobile number or email, and the traveller finds it again by reference + contact", async () => {
    const trip = await readyForReview();
    await expect(caller().trip.requestBooking({ tripId: trip.tripId })).rejects.toThrow(/mobile number or email/);
    await expect(caller().trip.requestBooking({ tripId: trip.tripId, phone: "12345" })).rejects.toThrow(/10-digit mobile number/);
    const asked = await caller().trip.requestBooking({ tripId: trip.tripId, phone: "098765-43210", lang: "ta" });
    expect(asked.approval).toMatchObject({ contact: { phone: "+919876543210" }, lang: "ta" });
    const reference = asked.booking!.reference;
    expect(await caller().trip.findMine({ reference: reference.toLowerCase(), contact: "9876543210" })).toEqual({ tripId: trip.tripId });
    await expect(caller().trip.findMine({ reference, contact: "9999999999" })).rejects.toThrow(/No booking matches/);
    await expect(caller().trip.findMine({ reference: "ZZZZZZ", contact: "9876543210" })).rejects.toThrow(/No booking matches/);
  });
});

describe("mobile numbers", () => {
  it("normalises Indian mobiles to +91 and rejects the rest", () => {
    expect(["9876543210", "+91 98765 43210", "09876543210", "919876543210"].map(normalisePhone)).toEqual(Array(4).fill("+919876543210"));
    expect(normalisePhone("+14155550123")).toBe("+14155550123");
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("5876543210")).toBeNull();
  });
});
