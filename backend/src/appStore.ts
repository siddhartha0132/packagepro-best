import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// PackagePro's read-write store, kept apart from the read-only PS-04 dataset.
// Canonical tables (trips, itineraries, itinerary_items, bookings) are created from the dataset's own DDL so their columns
// are exactly the shared data model's; PackagePro's additions (rule R1: additive only) are separate app_* tables plus three
// added columns on bookings. Conventions: prefixed opaque IDs, money as a 2-place decimal string + ISO-4217, ISO-8601 with
// offsets, and no hard deletes (rows carry status + updated_at).
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const APP_DB_PATH = process.env.PACKAGEPRO_APP_DB || path.resolve(process.cwd(), "data/packagepro-app.db");
export const CANONICAL_SCHEMA_PATH = process.env.PACKAGEPRO_SCHEMA || path.resolve(process.cwd(), "data-model/seed/schema.sqlite.sql");
export const CANONICAL_TABLES = ["trips", "itineraries", "itinerary_items", "bookings"] as const;

/** The canonical CREATE TABLE statements, copied verbatim from the dataset schema (so columns can never drift). */
function canonicalDDL() {
  const schema = readFileSync(CANONICAL_SCHEMA_PATH, "utf8");
  return CANONICAL_TABLES.map(table => {
    const statement = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!statement) throw new Error(`Canonical table '${table}' not found in ${CANONICAL_SCHEMA_PATH}`);
    return statement.replace(`CREATE TABLE ${table}`, `CREATE TABLE IF NOT EXISTS ${table}`);
  }).join("\n");
}

let db: DatabaseSyncType | null = null;
function store() {
  if (db) return db;
  const file = process.env.VITEST ? ":memory:" : APP_DB_PATH;
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  // Canonical foreign keys point at users / cities / currencies, which live in the read-only PS-04 dataset, so they are not
  // enforced inside this file: the code only writes dataset IDs, and `pnpm conformance` checks them against the dataset.
  db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`PRAGMA journal_mode = WAL;\n${canonicalDDL()}`);
  // R1 additions on the canonical bookings table: who to notify, and which guide the booking holds.
  const bookingColumns = new Set((db.prepare("PRAGMA table_info(bookings)").all() as { name: string }[]).map(column => column.name));
  for (const [name, type] of [["contact_email", "TEXT"], ["contact_phone", "TEXT"], ["guide_id", "TEXT"]]) {
    if (!bookingColumns.has(name)) db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_trips (
      trip_id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      running_total TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_guide_bookings (
      guide_booking_id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
      trip_id TEXT NOT NULL,
      guide_id TEXT NOT NULL,
      for_date TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_guide_bookings_slot ON app_guide_bookings(guide_id, for_date, status);
    CREATE TABLE IF NOT EXISTS app_bot_sessions (
      chat_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'telegram',
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

/** ISO-8601 with the +05:30 offset used across the dataset. */
function nowIst() {
  const shifted = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19);
  return `${shifted}+05:30`;
}

/** Rule R3: a 2-place decimal string. Callers pass rupees already computed in integer paise. */
const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const newId = (prefix: string, length = 8) => `${prefix}_${nanoid(length).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;

/** The canonical `trips` row for a PackagePro trip (enum values from enums.json: traveller_type, trip_status). */
export type CanonicalTrip = {
  owner_user_id: string;
  title: string;
  origin_city_id: string | null;
  destination_city_id: string;
  start_date: string;
  end_date: string;
  party_size: number;
  trip_type: string;
  status: "draft" | "planning" | "confirmed" | "in_progress" | "completed" | "cancelled";
};

/** Save the working state (app_trips) and upsert the canonical trips row. */
export function saveTrip(trip: { tripId: string; destination: string; departDate: string; returnDate: string; status: string; runningTotal: number }, canonical?: CanonicalTrip) {
  const now = nowIst();
  const database = store();
  database.prepare(`
    INSERT INTO app_trips (trip_id, destination, start_date, end_date, status, running_total, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trip_id) DO UPDATE SET destination = excluded.destination, start_date = excluded.start_date, end_date = excluded.end_date,
      status = excluded.status, running_total = excluded.running_total, state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(trip.tripId, trip.destination, trip.departDate, trip.returnDate, trip.status, money(trip.runningTotal), JSON.stringify(trip), now, now);
  if (!canonical) return;
  database.prepare(`
    INSERT INTO trips (trip_id, owner_user_id, title, origin_city_id, destination_city_id, start_date, end_date, party_size, adults, children, trip_type, is_group_trip, status, home_currency, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'INR', NULL, ?, ?)
    ON CONFLICT(trip_id) DO UPDATE SET title = excluded.title, origin_city_id = excluded.origin_city_id, start_date = excluded.start_date, end_date = excluded.end_date,
      party_size = excluded.party_size, adults = excluded.adults, trip_type = excluded.trip_type, is_group_trip = excluded.is_group_trip, status = excluded.status, updated_at = excluded.updated_at
  `).run(trip.tripId, canonical.owner_user_id, canonical.title, canonical.origin_city_id, canonical.destination_city_id, canonical.start_date, canonical.end_date,
    canonical.party_size, canonical.party_size, canonical.trip_type, canonical.party_size >= 5 ? 1 : 0, canonical.status, now, now);
}

export function loadTrip<T>(tripId: string): T | null {
  const row = store().prepare("SELECT state_json FROM app_trips WHERE trip_id = ?").get(tripId) as { state_json: string } | undefined;
  return row ? JSON.parse(row.state_json) as T : null;
}

/** Raised when a guide's last slot on a date was taken by another confirmed booking. */
export class GuideSlotTakenError extends Error {
  constructor(readonly guideId: string, readonly dates: string[]) {
    super(`Guide ${guideId} is fully booked on ${dates.join(", ")}`);
  }
}

// Confirmed guide bookings per guide and date, cached until the next booking.
let guideLoad: Map<string, number> | null = null;

/** Confirmed PackagePro bookings holding this guide on this date (each uses one of the dataset's slots_available). */
export function guideBookedCount(guideId: string, date: string) {
  if (!guideLoad) {
    guideLoad = new Map();
    const rows = store().prepare("SELECT guide_id, for_date, COUNT(*) AS n FROM app_guide_bookings WHERE status = 'confirmed' GROUP BY guide_id, for_date").all() as { guide_id: string; for_date: string; n: number }[];
    for (const row of rows) guideLoad.set(`${row.guide_id}|${row.for_date}`, row.n);
  }
  return guideLoad.get(`${guideId}|${date}`) ?? 0;
}

/** One canonical itinerary_items row (enum values from enums.json: item_type, entity_type, item_source). */
export type CanonicalItem = {
  day_index: number;
  item_type: "hotel" | "flight" | "poi" | "package" | "guide" | "transfer" | "meal" | "free";
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  cost: number;
  duration_minutes: number;
  explanation: string | null;
};

export type BookingInput = {
  tripId: string;
  userId: string;
  total: number;
  /** Mandatory on the canonical bookings table: a repeated confirm with the same key returns the original booking. */
  idempotencyKey: string;
  channel: "web" | "mobile_app" | "partner" | "call_centre" | "agent";
  email?: string;
  phone?: string;
  guide?: { guideId: string; dates: string[]; capacity: Record<string, number> };
  itinerary: { name: string; totalDurationMinutes: number; items: CanonicalItem[] };
};

/**
 * Confirm a booking in one transaction: canonical itineraries + itinerary_items + bookings rows, and (when a guide is
 * included) the guide's dates, with each date's remaining capacity re-checked inside the transaction so two travellers
 * can never take the same last slot. Idempotent on `idempotencyKey`.
 */
export function recordBooking(input: BookingInput) {
  const database = store();
  const now = nowIst();
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT booking_id, booking_reference, itinerary_id FROM bookings WHERE idempotency_key = ?").get(input.idempotencyKey) as { booking_id: string; booking_reference: string; itinerary_id: string } | undefined;
    if (existing) {
      database.exec("COMMIT");
      return { bookingId: existing.booking_id, reference: existing.booking_reference, itineraryId: existing.itinerary_id, replayed: true };
    }
    if (input.guide) {
      const count = database.prepare("SELECT COUNT(*) AS n FROM app_guide_bookings WHERE guide_id = ? AND for_date = ? AND status = 'confirmed'");
      const full = input.guide.dates.filter(date => (count.get(input.guide!.guideId, date) as { n: number }).n >= (input.guide!.capacity[date] ?? 0));
      if (full.length) throw new GuideSlotTakenError(input.guide.guideId, full);
    }
    const bookingId = newId("bkg");
    const itineraryId = newId("itn");
    const reference = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X");
    database.prepare(`
      INSERT INTO itineraries (itinerary_id, trip_id, name, version, is_active, generated_by, total_cost, currency, total_duration_minutes, total_carbon_kg, optimizer_weights, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 'user', ?, 'INR', ?, 0, NULL, 'active', ?, ?)
    `).run(itineraryId, input.tripId, input.itinerary.name, money(input.total), input.itinerary.totalDurationMinutes, now, now);
    const insertItem = database.prepare(`
      INSERT INTO itinerary_items (item_id, itinerary_id, day_index, sort_order, starts_at, ends_at, item_type, entity_type, entity_id, title, cost, currency, carbon_kg, duration_minutes, source, explanation, locked, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'INR', 0, ?, 'user', ?, 0, 'confirmed', ?, ?)
    `);
    input.itinerary.items.forEach((item, index) => insertItem.run(newId("itm", 10), itineraryId, item.day_index, index + 1, item.item_type, item.entity_type, item.entity_id, item.title, money(item.cost), item.duration_minutes, item.explanation, now, now));
    database.prepare(`
      INSERT INTO bookings (booking_id, user_id, trip_id, itinerary_id, booking_reference, channel, total_amount, currency, tax_amount, idempotency_key, status, confirmed_at, cancelled_at, cancellation_reason, created_at, updated_at, contact_email, contact_phone, guide_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', '0.00', ?, 'confirmed', ?, NULL, NULL, ?, ?, ?, ?, ?)
    `).run(bookingId, input.userId, input.tripId, itineraryId, reference, input.channel, money(input.total), input.idempotencyKey, now, now, now, input.email ?? null, input.phone ?? null, input.guide?.guideId ?? null);
    if (input.guide) {
      const insert = database.prepare("INSERT INTO app_guide_bookings (guide_booking_id, booking_id, trip_id, guide_id, for_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)");
      for (const date of input.guide.dates) insert.run(newId("gbk", 10), bookingId, input.tripId, input.guide.guideId, date, now, now);
    }
    database.prepare("UPDATE trips SET status = 'confirmed', updated_at = ? WHERE trip_id = ?").run(now, input.tripId);
    database.exec("COMMIT");
    return { bookingId, reference, itineraryId, replayed: false };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    guideLoad = null;
  }
}

export function listBookings(limit = 20) {
  return store().prepare(`
    SELECT b.booking_id, b.booking_reference, b.total_amount, b.currency, b.status, b.channel, b.user_id, b.idempotency_key, b.confirmed_at,
      t.trip_id, t.destination, t.start_date, t.end_date, b.guide_id,
      (SELECT GROUP_CONCAT(for_date, ', ') FROM app_guide_bookings g WHERE g.booking_id = b.booking_id) AS guide_dates
    FROM bookings b JOIN app_trips t USING (trip_id) ORDER BY b.created_at DESC LIMIT ?
  `).all(limit);
}

/** Every canonical row this app has written, for the conformance check (tools/validate_conformance.py). */
export function exportCanonicalRows() {
  const database = store();
  return Object.fromEntries(CANONICAL_TABLES.map(table => [table, database.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]]));
}

/** Test helper: forget confirmed guide reservations (the in-memory store is shared across a test file). */
export function clearGuideBookingsForTests() {
  if (!process.env.VITEST) return;
  store().exec("DELETE FROM app_guide_bookings");
  guideLoad = null;
}

/** Chat-bot conversation state (Telegram), so a conversation survives restarts and redeploys. */
export function loadBotSession<T>(chatId: string): T | null {
  const row = store().prepare("SELECT state_json FROM app_bot_sessions WHERE chat_id = ?").get(chatId) as { state_json: string } | undefined;
  return row ? JSON.parse(row.state_json) as T : null;
}

export function saveBotSession(chatId: string, state: unknown, channel = "telegram") {
  const now = nowIst();
  store().prepare(`
    INSERT INTO app_bot_sessions (chat_id, channel, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(chatId, channel, JSON.stringify(state), now, now);
}
