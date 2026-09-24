import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// PackagePro's own read-write store (trips, bookings), kept apart from the read-only PS-04 dataset.
// Follows the dataset conventions: prefixed opaque IDs, money as a 2-place decimal string + ISO-4217, ISO-8601 with offsets,
// and no hard deletes (rows carry status + updated_at).
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const APP_DB_PATH = process.env.PACKAGEPRO_APP_DB || path.resolve(process.cwd(), "data/packagepro-app.db");

let db: DatabaseSyncType | null = null;
function store() {
  if (db) return db;
  const file = process.env.VITEST ? ":memory:" : APP_DB_PATH;
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
    CREATE TABLE IF NOT EXISTS app_bookings (
      booking_id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES app_trips(trip_id),
      booking_reference TEXT NOT NULL,
      total_amount TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      guide_id TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      status TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_bookings_trip ON app_bookings(trip_id);
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

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function saveTrip(trip: { tripId: string; destination: string; departDate: string; returnDate: string; status: string; runningTotal: number }) {
  const now = nowIst();
  store().prepare(`
    INSERT INTO app_trips (trip_id, destination, start_date, end_date, status, running_total, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trip_id) DO UPDATE SET destination = excluded.destination, start_date = excluded.start_date, end_date = excluded.end_date,
      status = excluded.status, running_total = excluded.running_total, state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(trip.tripId, trip.destination, trip.departDate, trip.returnDate, trip.status, money(trip.runningTotal), JSON.stringify(trip), now, now);
}

export function loadTrip<T>(tripId: string): T | null {
  const row = store().prepare("SELECT state_json FROM app_trips WHERE trip_id = ?").get(tripId) as { state_json: string } | undefined;
  return row ? JSON.parse(row.state_json) as T : null;
}

export function recordBooking(input: { tripId: string; total: number; guideId?: string | null; email?: string; phone?: string }) {
  const now = nowIst();
  const bookingId = `bkg_${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;
  const reference = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X");
  store().prepare(`
    INSERT INTO app_bookings (booking_id, trip_id, booking_reference, total_amount, guide_id, contact_email, contact_phone, status, confirmed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
  `).run(bookingId, input.tripId, reference, money(input.total), input.guideId ?? null, input.email ?? null, input.phone ?? null, now, now, now);
  return { bookingId, reference };
}

export function listBookings(limit = 20) {
  return store().prepare(`
    SELECT b.booking_id, b.booking_reference, b.total_amount, b.currency, b.status, b.confirmed_at, t.trip_id, t.destination, t.start_date, t.end_date
    FROM app_bookings b JOIN app_trips t USING (trip_id) ORDER BY b.created_at DESC LIMIT ?
  `).all(limit);
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
