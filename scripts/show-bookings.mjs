// Prints what the app database holds: bookings, the guide dates they reserve, and slot usage per guide/date.
// Usage: pnpm db:show   (reads PACKAGEPRO_APP_DB or data/packagepro-app.db; names come from the read-only PS-04 dataset)
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const appPath = process.env.PACKAGEPRO_APP_DB || "data/packagepro-app.db";
if (!existsSync(appPath)) { console.log(`No app database yet at ${appPath} — nothing booked.`); process.exit(0); }
const app = new DatabaseSync(appPath, { readOnly: true });
const ps04 = new DatabaseSync("data-model/seed/PS-04.db", { readOnly: true });
const guideName = new Map(ps04.prepare("SELECT guide_id, display_name FROM tour_guides").all().map(row => [row.guide_id, row.display_name]));
const slots = ps04.prepare("SELECT slots_available FROM guide_availability WHERE guide_id = ? AND for_date = ? AND is_available = 1");
const has = name => app.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

const bookingsTable = has("bookings") && app.prepare("PRAGMA table_info(bookings)").all().some(column => column.name === "idempotency_key") ? "bookings" : "app_bookings";
const counts = app.prepare(`SELECT (SELECT COUNT(*) FROM app_trips) trips, (SELECT COUNT(*) FROM ${bookingsTable}) bookings`).get();
console.log(`\nApp database: ${appPath}\nTrips saved: ${counts.trips} · Bookings: ${counts.bookings}${has("app_bot_sessions") ? ` · Telegram chats: ${app.prepare("SELECT COUNT(*) n FROM app_bot_sessions").get().n}` : ""}`);

console.log("\nBookings (newest first)");
console.table(app.prepare(`
  SELECT b.booking_reference AS pnr, t.destination, t.start_date AS depart, t.end_date AS "return", b.total_amount AS total, b.guide_id, b.confirmed_at
  FROM ${bookingsTable} b JOIN app_trips t USING (trip_id) ORDER BY b.created_at DESC LIMIT 25
`).all().map(({ guide_id, ...row }) => ({ ...row, guide: guideName.get(guide_id) ?? "—" })));

if (has("app_guide_bookings")) {
  console.log("\nGuide slot usage (dataset slots_available vs confirmed PackagePro bookings)");
  console.table(app.prepare("SELECT guide_id, for_date, COUNT(*) AS booked FROM app_guide_bookings WHERE status = 'confirmed' GROUP BY guide_id, for_date ORDER BY guide_id, for_date").all().map(row => {
    const capacity = slots.get(row.guide_id, row.for_date)?.slots_available ?? 0;
    return { guide: guideName.get(row.guide_id) ?? row.guide_id, date: row.for_date, slots: capacity, booked: row.booked, free: Math.max(0, capacity - row.booked), status: capacity - row.booked > 0 ? "open" : "FULL" };
  }));
}
