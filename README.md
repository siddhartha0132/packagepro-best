# PackagePro — Dynamic Tour Packages

## Team & Problem Statement

- **Team:** RNG Gods · BMS College of Engineering
- **Event:** KogniVera Hackathon 2026
- **Problem statement:** **PS-04 — PackagePro: Dynamic Tour Packages**

## What we built

- **Curated package listing and detail pages.** 45 PS-04 packages, browsed by theme. Each detail page shows the itinerary, inclusions/exclusions and transparent pricing: the base price plus every component, and the lines add up to the total.
- **One fully customisable package, repriced live.** You can swap the hotel tier, an activity or the transfer, toggle recommended add-ons, change the duration, and add or remove a guide. The itinerary and total recompute on every change, and budget overruns go to negotiation.
- **Guide as a component, with the mandatory availability check.** Guides are picked by language, specialisation and price. Each is checked against `guide_availability` and the remaining slots on every trip date. An unavailable guide is **refused with the clashing date named**, the nearest **same-language, same-specialisation substitute** is offered, and the total is **repriced**. Confirmed bookings consume slots, so a guide can't be double-booked.
- **Language preferences.** There are 4 app languages (English, हिन्दी, தமிழ், తెలుగు) and 12 guide languages (BCP-47). A traveller profile read from `users` + `user_preferences` sets both. Packages offered in the guide language rank first, and guides are filtered by it. Dataset content, AI replies and the PDF quotation follow the chosen language.
- **AI package builder.** It works from free-text interests, budget and **booking history** (the traveller's past trips), picks only real catalogue packages, keeps to the stated budget, and builds the chosen trip in one tap. A grounded agent explains every decision.
- **Save, share and book.** Drafts auto-save, and a share link reopens the exact trip. Booking writes the canonical `trips` / `itineraries` / `itinerary_items` / `bookings` rows with an idempotency key and returns a PNR. There's a downloadable PDF quotation, and a **Telegram bot** runs on the same engine.

| PS-04 "What you need to build" | Where it is |
|---|---|
| Browse curated packages by theme, detail pages (itinerary, inclusions, transparent pricing) | Home listing + detail dialog (`client/src/pages/Home.tsx`), `packagepro.list/detail` |
| Customise hotel tier, activities, transfers, duration with live repricing | `client/src/components/PackageCustomiser.tsx`, `trip.swap/toggleAddOn/setDuration`, `server/trips.ts → priceBreakdown()` |
| AI package-builder from interests, budget and booking history | `server/aiChat.ts → matchPackagesFromInterests()` + `server/travellers.ts` |
| Add-on recommendations for the chosen package | `package_components.is_optional` rows → "Recommended add-ons" |
| Tour-guide selection by language, specialisation, availability and price | `trip.guides/selectGuide`, `server/packagepro.ts → guideCheck()/isGuideFree()` |
| Language preferences for app and guide/tour delivery | "Travelling as" profile (`user_preferences`), app-language and guide-language pickers |
| Save, share and book | Draft + `#trip=` share links, `trip.confirm` (idempotent), PDF quotation |
| **Mandatory: Guide Availability Check** | `trip.selectGuide` refusal → named dates, substitutes, repriced totals · hard-proof test below |

## Architecture

**Web app** (React 19, Vite, Tailwind, `client/`) and **Telegram bot** (`server/telegramBot.ts`) → **tRPC API** (`server/routers.ts`) → **trip engine** (`server/trips.ts`: pricing, swaps, negotiation, booking) → **catalogue and guide rules** (`server/packagepro.ts`) over the read-only **PS-04 dataset** (`data/PS-04.db`), plus a read-write **app database** (canonical tables + additions). **AI** (`server/aiChat.ts`, Sarvam) and **integrations** (`server/integrations.ts`: SerpAPI Google Flights, Sarvam translation, Wikipedia photos) sit beside the engine. Diagram and flows: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md).

## Data model

- **Canonical tables read:**
  - `tour_packages`, `package_components` (swaps; price = base + kept `price_delta`s), `tour_guides`, `guide_availability` (dates, slots, price multipliers)
  - `hotels` + `hotel_room_types`, `transfers`, `cities`, `languages` (BCP-47 validation)
  - `users` + `user_preferences` (language preference and interests), `bookings` → `trips` (booking history)
- **Canonical tables written:** `trips`, `itineraries`, `itinerary_items`, `bookings`, created verbatim from the dataset DDL, with an idempotency key on `bookings`.
- **Additions** (rule R1, additive only):
  - `app_guide_bookings` — confirmed guide slots per date
  - `app_trips` — working state of a trip being customised
  - `app_bot_sessions` — Telegram conversation state
  - `bookings.contact_email`, `bookings.contact_phone`, `bookings.guide_id`
- **Enforced in the backend, with tests:** party size within `min_group_size…max_group_size`, BCP-47 languages, INR only, money in integer paise (never a float), guide capacity, idempotent booking.
- **Organisers' validator:** `tools/validate_conformance.py` **passes** on the dataset merged with our rows (`pnpm conformance`).

Full mapping, rules R1–R8 and where each is enforced: [data-model/DATA_MODEL.md](data-model/DATA_MODEL.md) · schema: [data-model/schema.sql](data-model/schema.sql).

## AI features

| Capability | Mechanism | Grounding |
|---|---|---|
| Package builder (interests, budget, booking history) | Sarvam `sarvam-105b-conversations`, JSON prompt; OpenRouter fallback | Chooses only from the 45 catalogue packages; the budget is enforced before and after the model; the traveller's `user_preferences` and past trips are attached server-side; keyword fallback |
| Trip-request parser ("Mumbai to Goa for 3 days") | Rules with city aliases, then the model | Catalogue cities only |
| Transparent agent ("why was Meera refused?") | Sarvam chat | Live trip context: the refusal dates, substitutes and new totals; "never invent inventory or prices" |
| Estimate insight | Grounded 3-bullet completion | Only the live facts: fares, package, guides, past-traveller popularity |
| Multilingual content | Sarvam `mayura:v1` translation (cached) + native-language replies | Dataset strings; names never translated; contractual text hand-written |

Details, prompts and how we know each works: [ai/README.md](ai/README.md).

## Run it locally

Needs **Node 22.13+** (built-in `node:sqlite`) and **pnpm**.

```bash
pnpm install
cp .env.example .env          # optional keys: SARVAM_API_KEY (AI + translation), SERP_API_KEY (live fares)
pnpm db:reset                 # optional: start from a clean app database
pnpm dev                      # web + API (+ Telegram bot if TELEGRAM_BOT_TOKEN is set)
```

Open **http://localhost:3000**.
- **Data:** the PS-04 dataset ships in `data/PS-04.db`. No migration step: the app database and its canonical tables are created on first start.
- **Without API keys** the app runs on catalogue fares and rule-based text.
- **Production:** `pnpm build && pnpm start`.

## Demo path

The terminal outcome: **a customised package, booked, with the guide rule shown**. Run `pnpm db:reset` first so the demo guide's slots are free.

1. Click **▶ Try the live demo**. This fills in New Delhi → Thanjavur, 28 Sept → 1 Oct, **4 travellers** (the package takes 4–8), a Tamil guide and ₹1,50,000. The live estimate shows Low / Typical / High against the budget.
2. **Continue to flights** and pick a live Google Flights fare.
3. **Customise:** swap the hotel, add an add-on, change the duration. Watch the itinerary and total reprice.
4. **Guides → Meera Novak.** She is **refused: unavailable on 2026-09-28** (red on her calendar). **Arjun Nair** is offered with the same language (ta) and specialisation (heritage), all green, with *−₹11,160 vs Meera* and the total repriced. Click **Use Arjun Nair**.
5. **Continue to review → Confirm.** You get a booking reference (PNR). Try **Download quotation PDF**.
6. **Language:** pick **Travelling as → Anita Bhat**. The app switches to Tamil, the guide language to `ta`, and her interests and past trips drive "Picked for you".
7. **AI:** in *Plan it with AI*, type "beach honeymoon under 40k" (or in Hindi or Tamil), then tap **Build this package**.
8. **Telegram:** send `/demo` to **@wayypoint_Bot** → Build my trip → pick a flight → Add a guide → Meera Novak. You get the same refusal, date strips and substitute.

## Tests / proof

```bash
pnpm verify                                                   # type check + all offline tests + production build (also runs before every push)
npx vitest run server/hardProof.guideAvailability.test.ts     # the PS-04 hard proof
pnpm conformance                                              # organisers' validator on dataset + our rows → PASS
```

- **Hard proof** (`server/hardProof.guideAvailability.test.ts`): a guide is added on clashing dates → refused → the refusal names 2026-09-28 → the substitute has the same language and specialisation → the offered total equals the booked total.
- **Data model** (`server/conformance.test.ts`): canonical rows for a confirmed trip; idempotent re-confirm; `validate_conformance.py` **PASS**.
- **Engine** (`server/packagepro.test.ts`):
  - pricing identity (base + itinerary lines = total), swaps and add-ons per person / room / vehicle
  - duration changes, negotiation, group-size and BCP-47 rules
  - guide slots (a second traveller is refused; a late confirm is refused, not double-booked), traveller profiles
- **AI** (`server/aiChat.test.ts`) and **Telegram** (`server/telegramBot.test.ts`): every flow with a fake Telegram API, messages within Telegram limits, all 4 languages.

The tests run offline: the LLM and live fares are off under test, so every fallback path is covered.

---

### Deploy (Railway)

`railway.json` builds with `pnpm build` and starts with `pnpm start`.
1. **Variables:** set those from `.env.example`, plus `PACKAGEPRO_APP_DB=/data/packagepro-app.db`.
2. **Volume:** add one at `/data`. Don't mount it over `/app/data`, which holds the dataset.
3. **Domain:** generate one.

Only one running instance may poll a Telegram token: set `TELEGRAM_BOT_DISABLED=true` locally once Railway runs the bot. Keep a single instance, because active trips are cached in memory in front of SQLite.

### Useful commands

`pnpm db:show` shows bookings, guide dates and slot usage. `pnpm db:reset` clears the app database. `pnpm db:schema` regenerates `data-model/schema.sql`. `pnpm conformance` runs the organisers' validator.

### Repository layout

| Path | What |
|---|---|
| `client/` | Frontend (React + Vite): `src/pages`, `src/components`, `src/i18n.ts`, `src/lib` |
| `server/` | Backend (Node + tRPC): engine, catalogue, AI, integrations, Telegram bot, and the `*.test.ts` suites |
| `data/` | PS-04 dataset (`PS-04.db`, `schema.sqlite.sql`, `enums.json`, starter queries) + runtime caches; app DB (git-ignored) |
| `data-model/` | `DATA_MODEL.md` (tables used, additions, rules) + generated `schema.sql` |
| `ai/` | AI features, prompts and grounding (code in `server/aiChat.ts`, `server/estimate.ts`) |
| `docs/` | `ARCHITECTURE.md`, `API.md` |
| `tools/` | Organisers' `validate_conformance.py` |
| `scripts/` | `conformance.mjs`, `show-bookings.mjs`, `dump-schema.mjs` |

### Security

Secrets live only in `.env` (git-ignored) or Railway Variables and are never sent to the browser or the AI context. Rotate any key that appears in a commit, log or chat.
