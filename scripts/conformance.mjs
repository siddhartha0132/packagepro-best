// Proves data-model conformance: builds a temporary database = the PS-04 dataset + every canonical row PackagePro has
// written (trips, itineraries, itinerary_items, bookings), then runs the organisers' tools/validate_conformance.py on it.
// Usage: pnpm conformance   (reads PACKAGEPRO_APP_DB or data/packagepro-app.db)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATASET = "data-model/seed/PS-04.db";
const APP = process.env.PACKAGEPRO_APP_DB || "data/packagepro-app.db";
const TABLES = ["trips", "itineraries", "itinerary_items", "bookings"];

const merged = path.join(mkdtempSync(path.join(tmpdir(), "packagepro-conformance-")), "merged.db");
copyFileSync(DATASET, merged);
const db = new DatabaseSync(merged);
if (existsSync(APP)) {
  db.exec(`ATTACH DATABASE '${APP.replaceAll("'", "''")}' AS app`);
  for (const table of TABLES) {
    const columns = db.prepare(`PRAGMA main.table_info(${table})`).all().map(column => column.name).join(", ");
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM app.${table}`).get();
    db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM app.${table}`);
    console.log(`merged ${String(n).padStart(4)} PackagePro row(s) into ${table}`);
  }
  db.exec("DETACH DATABASE app");
} else {
  console.log(`No app database at ${APP} yet — validating the dataset alone.`);
}
db.close();
const result = spawnSync("python3", ["tools/validate_conformance.py", merged], { stdio: "inherit" });
process.exit(result.status ?? 1);
