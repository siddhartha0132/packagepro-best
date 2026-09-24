-- KV Hackathon 2026 · travel data model v1.1.0-rc1
-- Only the 21 tables this problem statement needs.

-- SQLite has no DECIMAL type, and NUMERIC affinity would turn '8500.00' into the
-- float 8500.0. Money columns are therefore TEXT so the exact value survives.
PRAGMA foreign_keys = ON;

-- amenities  (Reference & geography)
CREATE TABLE amenities (
  amenity_id                   TEXT PRIMARY KEY,
  code                         TEXT NOT NULL UNIQUE,
  label                        TEXT NOT NULL,
  amenity_group                TEXT NOT NULL,
  icon_hint                    TEXT,
  updated_at                   TEXT NOT NULL
);

-- categories  (Reference & geography)
CREATE TABLE categories (
  category_id                  TEXT PRIMARY KEY,
  code                         TEXT NOT NULL UNIQUE,
  label                        TEXT NOT NULL,
  parent_category_id           TEXT,
  applies_to                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (parent_category_id) REFERENCES categories(category_id)
);

-- currencies  (Reference & geography)
CREATE TABLE currencies (
  currency_id                  TEXT PRIMARY KEY,
  iso4217                      TEXT NOT NULL UNIQUE,
  name                         TEXT NOT NULL,
  symbol                       TEXT NOT NULL,
  minor_unit_exponent          INTEGER NOT NULL,
  display_locale               TEXT NOT NULL,
  updated_at                   TEXT NOT NULL
);

-- languages  (Reference & geography)
CREATE TABLE languages (
  language_id                  TEXT PRIMARY KEY,
  bcp47                        TEXT NOT NULL UNIQUE,
  english_name                 TEXT NOT NULL,
  native_name                  TEXT NOT NULL,
  script                       TEXT NOT NULL,
  rtl                          INTEGER NOT NULL,
  tts_supported                INTEGER NOT NULL,
  updated_at                   TEXT NOT NULL
);

-- price_history  (Availability & pricing)
CREATE TABLE price_history (
  history_id                   TEXT PRIMARY KEY,
  entity_type                  TEXT NOT NULL,
  entity_id                    TEXT NOT NULL,
  effective_date               TEXT NOT NULL,
  price                        TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  baseline_price               TEXT NOT NULL,
  demand_index                 NUMERIC(6,3) NOT NULL,
  occupancy_pct                NUMERIC(5,2) NOT NULL,
  lead_time_factor             NUMERIC(6,3) NOT NULL,
  seasonality_factor           NUMERIC(6,3) NOT NULL,
  event_factor                 NUMERIC(6,3) NOT NULL,
  competitor_factor            NUMERIC(6,3) NOT NULL,
  bound_clamped                INTEGER NOT NULL,
  explanation                  TEXT NOT NULL,
  computed_at                  TEXT NOT NULL,
  FOREIGN KEY (currency) REFERENCES currencies(iso4217),
  UNIQUE (entity_type, entity_id, effective_date)
);

-- countries  (Reference & geography)
CREATE TABLE countries (
  country_id                   TEXT PRIMARY KEY,
  iso2                         TEXT NOT NULL UNIQUE,
  iso3                         TEXT NOT NULL UNIQUE,
  name                         TEXT NOT NULL,
  default_currency             TEXT NOT NULL,
  calling_code                 TEXT NOT NULL,
  region                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (default_currency) REFERENCES currencies(iso4217)
);

-- cities  (Reference & geography)
CREATE TABLE cities (
  city_id                      TEXT PRIMARY KEY,
  name                         TEXT NOT NULL,
  state                        TEXT,
  country_id                   TEXT NOT NULL,
  country_code                 TEXT NOT NULL,
  lat                          NUMERIC(9,6) NOT NULL,
  lng                          NUMERIC(9,6) NOT NULL,
  timezone                     TEXT NOT NULL,
  region                       TEXT NOT NULL,
  population                   INTEGER,
  season_profile               TEXT NOT NULL,
  peak_months                  TEXT NOT NULL,
  primary_language             TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (country_id) REFERENCES countries(country_id),
  FOREIGN KEY (primary_language) REFERENCES languages(bcp47)
);

-- hotels  (Supply & catalogue)
CREATE TABLE hotels (
  hotel_id                     TEXT PRIMARY KEY,
  city_id                      TEXT NOT NULL,
  name                         TEXT NOT NULL,
  property_type                TEXT NOT NULL,
  star_rating                  INTEGER NOT NULL,
  guest_score                  NUMERIC(2,1),
  review_count                 INTEGER NOT NULL,
  address_line                 TEXT NOT NULL,
  lat                          NUMERIC(9,6) NOT NULL,
  lng                          NUMERIC(9,6) NOT NULL,
  distance_to_centre_km        NUMERIC(6,2) NOT NULL,
  description                  TEXT NOT NULL,
  base_currency                TEXT NOT NULL,
  checkin_time                 TEXT NOT NULL,
  checkout_time                TEXT NOT NULL,
  chain_code                   TEXT,
  has_xr_scene                 INTEGER NOT NULL,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (city_id) REFERENCES cities(city_id),
  FOREIGN KEY (base_currency) REFERENCES currencies(iso4217)
);

-- tour_guides  (Supply & catalogue)
CREATE TABLE tour_guides (
  guide_id                     TEXT PRIMARY KEY,
  city_id                      TEXT NOT NULL,
  display_name                 TEXT NOT NULL,
  languages                    TEXT NOT NULL,
  specialisation               TEXT NOT NULL,
  secondary_specialisation     TEXT,
  years_experience             INTEGER NOT NULL,
  rating                       NUMERIC(2,1),
  review_count                 INTEGER NOT NULL,
  day_rate                     TEXT NOT NULL,
  half_day_rate                TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  certified                    INTEGER NOT NULL,
  bio                          TEXT NOT NULL,
  status                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (city_id) REFERENCES cities(city_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- tour_packages  (Supply & catalogue)
CREATE TABLE tour_packages (
  package_id                   TEXT PRIMARY KEY,
  city_id                      TEXT NOT NULL,
  name                         TEXT NOT NULL,
  theme                        TEXT NOT NULL,
  tier                         TEXT NOT NULL,
  duration_days                INTEGER NOT NULL,
  duration_nights              INTEGER NOT NULL,
  base_price                   TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  min_group_size               INTEGER NOT NULL,
  max_group_size               INTEGER NOT NULL,
  difficulty                   TEXT NOT NULL,
  languages_offered            TEXT NOT NULL,
  inclusions                   TEXT NOT NULL,
  exclusions                   TEXT NOT NULL,
  description                  TEXT NOT NULL,
  status                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (city_id) REFERENCES cities(city_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- transfers  (Supply & catalogue)
CREATE TABLE transfers (
  transfer_id                  TEXT PRIMARY KEY,
  city_id                      TEXT NOT NULL,
  from_label                   TEXT NOT NULL,
  to_label                     TEXT NOT NULL,
  mode                         TEXT NOT NULL,
  duration_minutes             INTEGER NOT NULL,
  distance_km                  NUMERIC(7,3) NOT NULL,
  cost                         TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  carbon_kg                    NUMERIC(8,3) NOT NULL,
  capacity_pax                 INTEGER NOT NULL,
  accessible                   INTEGER NOT NULL,
  status                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (city_id) REFERENCES cities(city_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- users  (Identity & preference)
CREATE TABLE users (
  user_id                      TEXT PRIMARY KEY,
  display_name                 TEXT NOT NULL,
  email                        TEXT NOT NULL UNIQUE,
  home_city_id                 TEXT NOT NULL,
  home_currency                TEXT NOT NULL,
  locale                       TEXT NOT NULL,
  budget_band                  TEXT NOT NULL,
  travel_style                 TEXT NOT NULL,
  traveller_type               TEXT NOT NULL,
  segment                      TEXT NOT NULL,
  date_of_signup               TEXT NOT NULL,
  loyalty_tier                 TEXT,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (home_city_id) REFERENCES cities(city_id),
  FOREIGN KEY (home_currency) REFERENCES currencies(iso4217),
  FOREIGN KEY (locale) REFERENCES languages(bcp47)
);

-- guide_availability  (Supply & catalogue)
CREATE TABLE guide_availability (
  availability_id              TEXT PRIMARY KEY,
  guide_id                     TEXT NOT NULL,
  for_date                     TEXT NOT NULL,
  is_available                 INTEGER NOT NULL,
  slots_available              INTEGER NOT NULL,
  price_multiplier             NUMERIC(4,2) NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (guide_id) REFERENCES tour_guides(guide_id),
  UNIQUE (guide_id, for_date)
);

-- hotel_room_types  (Supply & catalogue)
CREATE TABLE hotel_room_types (
  room_type_id                 TEXT PRIMARY KEY,
  hotel_id                     TEXT NOT NULL,
  name                         TEXT NOT NULL,
  max_occupancy                INTEGER NOT NULL,
  max_adults                   INTEGER NOT NULL,
  max_children                 INTEGER NOT NULL,
  bed_config                   TEXT NOT NULL,
  size_sqm                     INTEGER,
  base_rate                    TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  total_units                  INTEGER NOT NULL,
  smoking_allowed              INTEGER NOT NULL,
  status                       TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- package_components  (Supply & catalogue)
CREATE TABLE package_components (
  component_id                 TEXT PRIMARY KEY,
  package_id                   TEXT NOT NULL,
  component_type               TEXT NOT NULL,
  entity_type                  TEXT,
  entity_id                    TEXT,
  day_index                    INTEGER NOT NULL,
  slot                         TEXT NOT NULL,
  title                        TEXT NOT NULL,
  quantity                     INTEGER NOT NULL,
  price_delta                  TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  is_optional                  INTEGER NOT NULL,
  is_swappable                 INTEGER NOT NULL,
  swap_group                   TEXT,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- trips  (Trip & itinerary)
CREATE TABLE trips (
  trip_id                      TEXT PRIMARY KEY,
  owner_user_id                TEXT NOT NULL,
  title                        TEXT NOT NULL,
  origin_city_id               TEXT,
  destination_city_id          TEXT NOT NULL,
  start_date                   TEXT NOT NULL,
  end_date                     TEXT NOT NULL,
  party_size                   INTEGER NOT NULL,
  adults                       INTEGER NOT NULL,
  children                     INTEGER NOT NULL,
  trip_type                    TEXT NOT NULL,
  is_group_trip                INTEGER NOT NULL,
  status                       TEXT NOT NULL,
  home_currency                TEXT NOT NULL,
  notes                        TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  FOREIGN KEY (origin_city_id) REFERENCES cities(city_id),
  FOREIGN KEY (destination_city_id) REFERENCES cities(city_id),
  FOREIGN KEY (home_currency) REFERENCES currencies(iso4217)
);

-- user_preferences  (Identity & preference)
CREATE TABLE user_preferences (
  preference_id                TEXT PRIMARY KEY,
  user_id                      TEXT NOT NULL UNIQUE,
  preferred_languages          TEXT NOT NULL,
  guide_language               TEXT,
  interests                    TEXT NOT NULL,
  dietary_flags                TEXT,
  accessibility_needs          TEXT,
  preferred_currency           TEXT NOT NULL,
  max_daily_budget             TEXT,
  max_daily_budget_currency    TEXT,
  pace                         TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (guide_language) REFERENCES languages(bcp47),
  FOREIGN KEY (preferred_currency) REFERENCES currencies(iso4217),
  FOREIGN KEY (max_daily_budget_currency) REFERENCES currencies(iso4217)
);

-- hotel_media  (Supply & catalogue)
CREATE TABLE hotel_media (
  media_id                     TEXT PRIMARY KEY,
  hotel_id                     TEXT NOT NULL,
  room_type_id                 TEXT,
  media_role                   TEXT NOT NULL,
  file_path                    TEXT NOT NULL,
  alt_text                     TEXT NOT NULL,
  width_px                     INTEGER NOT NULL,
  height_px                    INTEGER NOT NULL,
  sort_order                   INTEGER NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id),
  FOREIGN KEY (room_type_id) REFERENCES hotel_room_types(room_type_id)
);

-- itineraries  (Trip & itinerary)
CREATE TABLE itineraries (
  itinerary_id                 TEXT PRIMARY KEY,
  trip_id                      TEXT NOT NULL,
  name                         TEXT NOT NULL,
  version                      INTEGER NOT NULL,
  is_active                    INTEGER NOT NULL,
  generated_by                 TEXT NOT NULL,
  total_cost                   TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  total_duration_minutes       INTEGER NOT NULL,
  total_carbon_kg              NUMERIC(10,3) NOT NULL,
  optimizer_weights            TEXT,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- itinerary_items  (Trip & itinerary)
CREATE TABLE itinerary_items (
  item_id                      TEXT PRIMARY KEY,
  itinerary_id                 TEXT NOT NULL,
  day_index                    INTEGER NOT NULL,
  sort_order                   INTEGER NOT NULL,
  starts_at                    TEXT,
  ends_at                      TEXT,
  item_type                    TEXT NOT NULL,
  entity_type                  TEXT,
  entity_id                    TEXT,
  title                        TEXT NOT NULL,
  cost                         TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  carbon_kg                    NUMERIC(8,3) NOT NULL,
  duration_minutes             INTEGER NOT NULL,
  source                       TEXT NOT NULL,
  explanation                  TEXT,
  locked                       INTEGER NOT NULL,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);

-- bookings  (Booking & money)
CREATE TABLE bookings (
  booking_id                   TEXT PRIMARY KEY,
  user_id                      TEXT NOT NULL,
  trip_id                      TEXT,
  itinerary_id                 TEXT,
  booking_reference            TEXT NOT NULL UNIQUE,
  channel                      TEXT NOT NULL,
  total_amount                 TEXT NOT NULL,
  currency                     TEXT NOT NULL,
  tax_amount                   TEXT NOT NULL,
  idempotency_key              TEXT NOT NULL UNIQUE,
  status                       TEXT NOT NULL,
  confirmed_at                 TEXT,
  cancelled_at                 TEXT,
  cancellation_reason          TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (trip_id) REFERENCES trips(trip_id),
  FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id),
  FOREIGN KEY (currency) REFERENCES currencies(iso4217)
);
