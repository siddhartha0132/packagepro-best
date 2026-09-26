# PackagePro — data model

PackagePro is built on the **PS-04 shared travel data model v1.1.0-rc1** (`data-model/seed/PS-04.db`, DDL in `data-model/seed/schema.sqlite.sql`,
legal enum values in `data-model/seed/enums.json`). The dataset is opened **read-only**; everything PackagePro writes goes to a separate
app database (`data/packagepro-app.db`, or `PACKAGEPRO_APP_DB`) whose schema is in [`schema.sql`](schema.sql) — generated from the
code by `pnpm db:schema`, so the file cannot drift from what runs.

We **extend, never rename**: canonical tables keep their canonical names and columns; our additions are new `app_*` tables and
three added columns (rule R1).

## Canonical tables we read (read-only dataset)

Loaded once at start-up by `backend/src/catalogue.ts → loadCatalogue()`.

| Canonical table | Columns used | What PackagePro does with it |
|---|---|---|
| `tour_packages` | all; filtered `currency = 'INR' AND status = 'active'` | Curated package listing by theme; `base_price` (per person), `duration_days/nights`, `min_group_size`/`max_group_size` (enforced), `languages_offered`, inclusions/exclusions |
| `package_components` | all; `currency = 'INR'` | The swappable lines of a package. Price = **base + `price_delta` of every kept component** (signed, summed in integer paise). `swap_group` defines alternatives, `is_optional` = add-on recommendations, `day_index`/`slot` build the itinerary |
| `tour_guides` | all active INR rows | Guide dimension: `languages` (BCP-47), `specialisation`, `day_rate`, rating, city |
| `guide_availability` | `for_date`, `is_available`, `slots_available`, `price_multiplier` | The mandatory availability check: a guide is free on a date only if `is_available = 1` **and** a slot remains after PackagePro's confirmed bookings; `price_multiplier` prices each date |
| `hotels` + `hotel_room_types` | hotel detail, cheapest `base_rate` per hotel | Hotel-tier swaps inside a package, repriced per room and per night |
| `transfers` | `from_label`, `to_label`, `mode`, `duration_minutes`, `cost` | Transfer swaps inside a package |
| `cities` | `city_id`, `name`, `lat`, `lng`, `primary_language` | Destination anchor; haversine distance ranks guide substitutes (nearest first, ≤ 400 km) |
| `languages` | `bcp47` | The only legal language values (R6) — trip languages are validated against it |
| `users` | `user_id`, `display_name`, `locale`, `traveller_type`, `travel_style`, `budget_band`, `segment` | Traveller identity: owner of every trip and booking; `locale` sets the app language |
| `user_preferences` | `preferred_languages`, `guide_language`, `interests`, `max_daily_budget`, `pace` | **The language-preference requirement reads from here**: the "Travelling as" profile sets the app language, the guide/tour language and the interests that drive recommendations |
| `bookings` → `trips` → `cities` | the traveller's past bookings (city, date, trip type, amount) | **Booking history** for the AI package-builder (favourite themes, places already visited) |

Not used in the MVP: `price_history`, `hotel_media`, `amenities`, `categories`, `countries`, `currencies` (referenced only as the
INR foreign key).

## Canonical tables we write (app database)

Created **verbatim** from the `CREATE TABLE` statements in `data-model/seed/schema.sqlite.sql` (`backend/src/appStore.ts → canonicalDDL()`), so
their columns are exactly the shared model's.

| Canonical table | When a row is written | Notes |
|---|---|---|
| `trips` (`trp_…`) | On every change to a trip (`backend/src/trips.ts → canonicalTrip()`) | `owner_user_id` = the traveller's `users.user_id`; `origin_city_id` / `destination_city_id` from `cities`; `trip_type` ∈ `traveller_type`; `status` ∈ `trip_status` (`draft` → `planning` → `confirmed`); `home_currency = 'INR'` |
| `itineraries` (`itn_…`) | At confirmation | `version = 1`, `is_active = 1`, `generated_by = 'user'` (item_source), `total_cost` 2-place string + `INR`, `status = 'active'` |
| `itinerary_items` (`itm_…`) | At confirmation, one per itinerary line | `item_type` ∈ {flight, poi, hotel, transfer, meal, guide}; `entity_type`/`entity_id` point back at dataset rows (`package_component` → `pcm_…`, `hotel` → `htl_…`, `guide` → `gid_…`, `transfer` → `trf_…`); `source = 'user'`, `status = 'confirmed'` |
| `bookings` (`bkg_…`) | At confirmation | `user_id`, `trip_id`, `itinerary_id`, `booking_reference`, `channel` (`web`, or `mobile_app` for the Telegram bot), `total_amount` + `INR`, `tax_amount = '0.00'` (GST not modelled), **`idempotency_key` (mandatory, unique)**, `status = 'confirmed'`, `confirmed_at` with offset |

Canonical foreign keys to `users`, `cities` and `currencies` point into the read-only dataset, so the app database opens with
foreign-key enforcement off and the code only ever writes dataset IDs; `pnpm conformance` then checks every one of them.

## Additions (rule R1 — additive only)

| Addition | Why |
|---|---|
| `bookings.contact_email`, `bookings.contact_phone` | Where to send the confirmation (Resend / Twilio) |
| `bookings.guide_id` | Which guide a booking holds, for fast reporting |
| `app_guide_bookings` (`gbk_…`) | One row per guide per booked date. Live availability = `guide_availability.slots_available` − held (`active`) and `confirmed` rows, so a booking — or a request waiting for a travel agent — blocks the next traveller. Capacity is re-checked inside the booking transaction. A rejected request sets its rows to `released` |
| Agent approval (Telegram) | A booking request is written as `bookings.status = 'pending'` (items `proposed`, `confirmed_at` NULL). Approve → `confirmed` (+ `confirmed_at`, items `confirmed`). Reject → `cancelled` (+ `cancelled_at`, `cancellation_reason`, items `removed`, itinerary inactive) — kept on record, never deleted. Each request has its own idempotency key. An accepted counter-offer cancels the pending booking (`Replaced by the travel agent's counter-offer`) and writes a new confirmed one with the changed plan and total |
| `app_trips` | The working state (JSON) of a trip while it is being customised — flight options, swaps, negotiation — so a shared link reopens it and it survives restarts. The canonical `trips` row is kept in sync with it |
| `app_bot_sessions` | Telegram conversation state per chat |

## The eight rules, and where the code enforces them

| Rule | Enforcement |
|---|---|
| R1 additive only | Canonical DDL copied verbatim at start-up; additions are `app_*` tables and `ALTER TABLE … ADD COLUMN` |
| R2 prefixed opaque IDs | `trp_`, `itn_`, `itm_`, `bkg_`, `gbk_` generated in `backend/src/appStore.ts` / `backend/src/trips.ts`; dataset IDs are never parsed |
| R3 money is a 2-place decimal + ISO-4217 | All arithmetic in integer paise (`backend/src/catalogue.ts → toPaise/fromPaise`); stored as `"12345.67"` strings with `INR` |
| R4 ISO-8601 with offset | `_at` values written as `…+05:30`; `_date` values are zoneless `YYYY-MM-DD` |
| R5 enums from enums.json | `trip_status`, `traveller_type`, `item_type`, `entity_type`, `item_source`, `item_status`, `channel`, `booking_status`, `record_status` values only |
| R6 BCP-47 languages | `backend/src/trips.ts → assertTripRules()` rejects any language not in the `languages` table |
| R7 WGS-84 | City `lat`/`lng` read as given; used for substitute distance |
| R8 nothing hard-deleted | Rows carry `status` + `updated_at`; no `DELETE` in application code (test helper excepted) |

## PS-04 boundary rules enforced in the backend (and the test that proves each)

| Rule | Code | Test |
|---|---|---|
| Guide refused on any unavailable date, clash named, same-language + same-specialisation substitute offered, total repriced | `backend/src/packagepro.ts → guideCheck()`, `backend/src/trips.ts → selectGuide()` | `tests/hardProof.guideAvailability.test.ts` (the hard proof) |
| Guide capacity: `slots_available` minus confirmed bookings; no double booking, re-checked at confirmation in one transaction | `backend/src/packagepro.ts → isGuideFree()`, `backend/src/appStore.ts → recordBooking()` | `tests/packagepro.test.ts → "guide bookings hold real slots"` |
| Party size within `min_group_size … max_group_size` | `backend/src/trips.ts → assertTripRules()` | `tests/packagepro.test.ts → "PS-04 boundary rules…"` |
| Price = base + kept `price_delta`s, in paise (never a float) | `backend/src/trips.ts → priceBreakdown()` | `tests/packagepro.test.ts → "prices the package as base + every kept component"` |
| INR only | catalogue filters `currency = 'INR'`; `assertTripRules()` | catalogue listing test |
| BCP-47 languages only | `assertTripRules()` | boundary-rules test |
| Idempotent booking | `recordBooking()` looks up `idempotency_key` first | `tests/conformance.test.ts → "is idempotent"` |
| Everything written conforms to the shared model | canonical DDL + enum/prefix/money choices above | `tests/conformance.test.ts` runs `tools/validate_conformance.py` → **PASS**; `pnpm conformance` does the same on the live app database |

## Seed / fixtures for the demo

- **Seed data:** `data-model/seed/PS-04.db` — the organisers' dataset, used as-is (28,103 rows). No generated fixtures are needed.
- **Demo scenario** (all dataset facts): package *Thanjavur Honeymoon* (`pkg_f2d745d6`, groups of 4–8); guides Meera Novak
  (`gid_dbf7be53`, ta, heritage — unavailable 2026-09-28) and Arjun Nair (`gid_ad5b7c5f`, ta, heritage — available 28–30 Sept,
  1 slot on 29 and 30); demo traveller Anita Bhat (`usr_6c3fae7b`, `preferred_languages = ta`, 15 bookings in the dataset, 13 linked to a trip).
- **Reset before a demo:** `pnpm db:reset` clears the app database (trips, bookings, guide reservations, chats); the dataset is untouched.
