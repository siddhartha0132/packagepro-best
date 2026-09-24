import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded at runtime: Vite/Vitest's resolver drops the `node:` prefix, and `sqlite` only exists as `node:sqlite`.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// Read-only access to the PS-04 hackathon dataset (data/PS-04.db).
// Money columns are TEXT on purpose (rule R3): convert through paise integers, never parseFloat arithmetic.

export const DATASET_PATH = process.env.PACKAGEPRO_DB || path.resolve(process.cwd(), "data/PS-04.db");

let db: DatabaseSyncType | null = null;
function dataset() {
  if (!db) {
    if (!existsSync(DATASET_PATH)) throw new Error(`PS-04 dataset not found at ${DATASET_PATH}`);
    db = new DatabaseSync(DATASET_PATH, { readOnly: true });
  }
  return db;
}

export function all<T>(sql: string, ...params: (string | number)[]) {
  return dataset().prepare(sql).all(...params) as T[];
}

/** "8500.25" -> 850025 */
export function toPaise(amount: string | number | null | undefined) {
  if (amount === null || amount === undefined || amount === "") return 0;
  const [whole, fraction = ""] = String(amount).trim().split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number((fraction + "00").slice(0, 2)));
}

/** 850025 -> 8500.25 (display/ledger number; always derived from integer paise) */
export function fromPaise(paise: number) {
  return Math.round(paise) / 100;
}

export function rupees(amount: string | number | null | undefined) {
  return fromPaise(toPaise(amount));
}

export type CityRow = { city_id: string; name: string; state: string; lat: number; lng: number; primary_language: string; description: string };
export type PackageRow = { package_id: string; city_id: string; name: string; theme: string; tier: string; duration_days: number; duration_nights: number; base_price: string; currency: string; min_group_size: number; max_group_size: number; difficulty: string; languages_offered: string; inclusions: string; exclusions: string; description: string };
export type ComponentRow = { component_id: string; package_id: string; component_type: string; entity_type: string | null; entity_id: string | null; day_index: number; slot: string; title: string; quantity: number; price_delta: string; is_optional: number; is_swappable: number; swap_group: string | null };
export type GuideRow = { guide_id: string; city_id: string; display_name: string; languages: string; specialisation: string; secondary_specialisation: string | null; years_experience: number; rating: number | null; review_count: number; day_rate: string; half_day_rate: string; certified: number; bio: string };
export type AvailabilityRow = { guide_id: string; for_date: string; is_available: number; slots_available: number; price_multiplier: number };
export type HotelRow = { hotel_id: string; city_id: string; name: string; property_type: string; star_rating: number; guest_score: number; distance_to_centre_km: number; description: string; min_rate: string; room_name: string };
export type TransferRow = { transfer_id: string; city_id: string; from_label: string; to_label: string; mode: string; duration_minutes: number; cost: string };

// India-only catalogue: the trip ledger, flights and budget cap are all INR.
const INR_ACTIVE = "currency = 'INR' AND status = 'active'";

export function loadCatalogue() {
  const cities = all<CityRow>("SELECT city_id, name, state, lat, lng, primary_language, description FROM cities WHERE status = 'active'");
  const packages = all<PackageRow>(`SELECT * FROM tour_packages WHERE ${INR_ACTIVE} ORDER BY name`);
  const components = all<ComponentRow>(`SELECT * FROM package_components WHERE currency = 'INR' ORDER BY package_id, day_index, CASE slot WHEN 'morning' THEN 0 WHEN 'afternoon' THEN 1 WHEN 'evening' THEN 2 ELSE 3 END`);
  const guides = all<GuideRow>(`SELECT * FROM tour_guides WHERE ${INR_ACTIVE}`);
  const availability = all<AvailabilityRow>("SELECT guide_id, for_date, is_available, slots_available, price_multiplier FROM guide_availability");
  const hotels = all<HotelRow>(`
    SELECT h.hotel_id, h.city_id, h.name, h.property_type, h.star_rating, h.guest_score, h.distance_to_centre_km, h.description,
           r.base_rate AS min_rate, r.name AS room_name
    FROM hotels h
    JOIN hotel_room_types r ON r.room_type_id = (
      SELECT r2.room_type_id FROM hotel_room_types r2
      WHERE r2.hotel_id = h.hotel_id AND r2.status = 'active' AND r2.currency = 'INR'
      ORDER BY CAST(r2.base_rate AS REAL) LIMIT 1)
    WHERE h.status = 'active' AND h.base_currency = 'INR'`);
  const transfers = all<TransferRow>(`SELECT transfer_id, city_id, from_label, to_label, mode, duration_minutes, cost FROM transfers WHERE ${INR_ACTIVE}`);
  const languages = all<{ bcp47: string }>("SELECT bcp47 FROM languages").map(row => row.bcp47);
  return { cities, packages, components, guides, availability, hotels, transfers, languages };
}
