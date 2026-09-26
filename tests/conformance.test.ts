import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CANONICAL_TABLES, clearGuideBookingsForTests, exportCanonicalRows, listBookings } from "../backend/src/appStore";
import { appRouter } from "../backend/src/routers";
import * as trips from "../backend/src/trips";

// Data-model conformance: everything PackagePro writes into the shared model (trips, itineraries, itinerary_items,
// bookings) must pass the organisers' tools/validate_conformance.py when merged with the PS-04 dataset — prefixed IDs (R2),
// 2-place money with ISO-4217 (R3), offsets on _at (R4), legal enums (R5), and resolvable foreign keys.

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const api = () => appRouter.createCaller({ req: {} as never, res: {} as never, user: null });
const hasPython = spawnSync("python3", ["--version"]).status === 0;

async function bookThanjavur(withGuide: boolean) {
  const created = await api().trip.create({ origin: "DEL", destination: "Thanjavur", departDate: "2026-09-28", returnDate: "2026-10-01", travelers: 4, budgetCap: 500000, language: "ta" });
  let trip = await api().trip.selectFlight({ tripId: created.tripId, flightId: created.flightOptions[0].id });
  if (withGuide) trip = await api().trip.selectGuide({ tripId: trip.tripId, guideId: "gid_ad5b7c5f", days: 3 });
  trip = await api().trip.continuePackage({ tripId: trip.tripId });
  return api().trip.confirm({ tripId: trip.tripId });
}

describe("data-model conformance", () => {
  beforeAll(() => clearGuideBookingsForTests());

  it("writes canonical trips, itineraries, itinerary_items and bookings rows for a confirmed trip", async () => {
    const booked = await bookThanjavur(true);
    expect(booked.status).toBe("confirmed");
    const rows = exportCanonicalRows();
    const trip = rows.trips.find(row => row.trip_id === booked.tripId)!;
    expect(trip).toMatchObject({ owner_user_id: booked.userId, destination_city_id: expect.stringMatching(/^cty_/), party_size: 4, status: "confirmed", home_currency: "INR" });
    const booking = rows.bookings.find(row => row.trip_id === booked.tripId)!;
    expect(booking).toMatchObject({ booking_id: booked.booking!.bookingId, user_id: booked.userId, channel: "web", currency: "INR", status: "confirmed", idempotency_key: `idem_${booked.tripId}` });
    expect(booking.total_amount).toMatch(/^\d+\.\d{2}$/);
    const items = rows.itinerary_items.filter(row => row.itinerary_id === booking.itinerary_id);
    expect(items.some(item => item.item_type === "guide" && item.entity_type === "guide" && item.entity_id === "gid_ad5b7c5f")).toBe(true);
    expect(items.some(item => item.item_type === "flight")).toBe(true);
    expect(items.every(item => /^\d+\.\d{2}$/.test(String(item.cost)) && item.currency === "INR")).toBe(true);
  });

  it("is idempotent: confirming the same trip again returns the same booking and writes nothing new", async () => {
    const first = await bookThanjavur(false);
    const count = exportCanonicalRows().bookings.length;
    const again = await api().trip.confirm({ tripId: first.tripId });
    expect(again.booking?.bookingId).toBe(first.booking?.bookingId);
    expect(again.booking?.reference).toBe(first.booking?.reference);
    expect(exportCanonicalRows().bookings.length).toBe(count);
    expect(listBookings().filter(row => (row as { trip_id: string }).trip_id === first.tripId)).toHaveLength(1);
  });

  it.skipIf(!hasPython)("passes the organisers' validate_conformance.py when merged with the PS-04 dataset", async () => {
    await bookThanjavur(false);
    // Agent-approval bookings too: one pending, one approved, one rejected (booking_status pending / confirmed / cancelled).
    for (const decision of ["pending", "approve", "reject"] as const) {
      const created = await trips.createTrip({ origin: "DEL", destination: "Thanjavur", departDate: "2026-10-05", returnDate: "2026-10-08", travelers: 4, budgetCap: 900000, language: "ta", channel: "mobile_app" });
      await trips.selectFlight(created.tripId, created.flightOptions[0].id);
      trips.continueFromPackage(created.tripId);
      await trips.requestBooking(created.tripId);
      if (decision === "approve") trips.approveBooking(created.tripId);
      if (decision === "reject") trips.rejectBooking(created.tripId, "Not available");
    }
    expect(new Set(exportCanonicalRows().bookings.map(row => row.status))).toEqual(new Set(["confirmed", "pending", "cancelled"]));
    const merged = path.join(mkdtempSync(path.join(tmpdir(), "packagepro-conformance-")), "merged.db");
    copyFileSync("data-model/seed/PS-04.db", merged);
    const db = new DatabaseSync(merged);
    const rows = exportCanonicalRows();
    for (const table of CANONICAL_TABLES) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
      const insert = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
      for (const row of rows[table]) insert.run(...columns.map(column => row[column] as never));
    }
    db.close();
    const result = spawnSync("python3", ["tools/validate_conformance.py", merged], { encoding: "utf8" });
    expect(result.stdout + result.stderr).toMatch(/PASS/);
    expect(result.status).toBe(0);
  });
});
