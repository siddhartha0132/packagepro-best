# PackagePro

PackagePro is a dynamic, budget-aware travel package planner for curated Indian destinations. It combines a staged trip workflow with live or catalogue-backed flight and hotel options, package component swaps, strict local-guide availability checks, multilingual UI copy, transparent recommendation explanations, conversational trip planning, and one-tap itinerary sharing.

The application is designed for a traveller who wants the convenience of a packaged trip without losing control over the individual components or the final price.

> **Current repository:** `DevodG/packagepro-best`  
> **Primary branch:** `best`  
> **Runtime:** React, Vite, Express, tRPC, TypeScript, Drizzle, and Vitest

## Contents

- [Product capabilities](#product-capabilities)
- [User flow](#user-flow)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Environment configuration](#environment-configuration)
- [Development commands](#development-commands)
- [API documentation](#api-documentation)
- [Guide availability and budget rules](#guide-availability-and-budget-rules)
- [Integrations and fallbacks](#integrations-and-fallbacks)
- [Testing](#testing)
- [Production build and deployment](#production-build-and-deployment)
- [Security and secret handling](#security-and-secret-handling)
- [Known limitations and extension points](#known-limitations-and-extension-points)
- [References](#references)

## Product capabilities

PackagePro currently supports the following capabilities:

1. **Curated package catalogue.** Travellers can browse destination packages, themes, images, descriptions, and package components.
2. **One customisable package flow.** A selected package can be shaped through flight, hotel, package-component, transport, and guide choices.
3. **Live price ledger.** Every selection or swap updates the running total and remaining budget. A component that would exceed the cap enters a negotiation state instead of silently exceeding the cap.
4. **Strict guide availability.** A guide is checked against every actual package date. Unknown availability is treated as unavailable. The selected guide must match the destination, requested language, and package specialisation.
5. **Compliant substitutes.** When a guide clashes with one or more dates, PackagePro names every conflicting date and ranks fully available substitutes with the same language and specialisation. The replacement price delta is applied to the live total.
6. **Multilingual interaction.** The planner includes English, Tamil, Hindi, and Telugu copy, with server-side Sarvam translation support for dynamic text where configured.
7. **Conversational planning.** The transparent trip agent can parse natural requests such as “make a two-day Jaipur trip from Delhi next weekend,” interpret hotel and transport preferences, auto-build a draft package, and apply conversational hotel-swap or guide-removal commands.
8. **Recommendation transparency.** Explanations use the active planner state, selected components, interests, language, budget, and availability information rather than a fixed generic response.
9. **Free-model AI fallback chain.** OpenRouter free models are discovered when configured, with a deterministic catalogue-backed parser and context explanation engine as fallbacks.
10. **Destination insight retrieval.** Destination context is loaded from a short-lived cached Wikipedia summary with a curated catalogue fallback.
11. **Notifications and sharing.** Confirmed trips can send optional email or SMS notifications when configured. The review screen can open WhatsApp with a day-by-day itinerary, component ledger, guide information, and budget summary.

## User flow

The planner is intentionally staged so the traveller can understand each decision:

```text
Trip brief
   ↓
Reality check
   ↓
Flight or transport selection
   ↓
Hotel selection
   ↓
Package and component swaps
   ↓
Guide selection and strict availability check
   ↓
Negotiation, if required
   ↓
Review and confirmation
```

Every stage has a back action until the trip is confirmed. A confirmed trip is immutable through the normal planner navigation.

The conversational agent can enter the same flow from natural language. It parses the request, resolves catalogue cities and dates, selects appropriate defaults, and places the resulting draft at the review stage for explicit traveller confirmation.

## Architecture

### Frontend

The frontend is a React application served through Vite. The main planner is implemented in `client/src/pages/Home.tsx`. It uses typed tRPC hooks through `client/src/lib/trpc.ts`, shared UI primitives from `client/src/components/ui`, and the multilingual dictionary in `client/src/i18n.ts`.

The visual system is defined in `client/src/index.css`. The UI is intentionally editorial and travel-focused, with a responsive planner layout, destination imagery, a live ledger, staged progress navigation, mobile-friendly controls, and explicit error and negotiation states.

### Backend

The backend is an Express server with the WebDev runtime entry point in `server/_core/index.ts`. Application procedures are defined in `server/routers.ts` and exposed through tRPC. Domain state and staged trip transitions live in `server/trips.ts`.

The current trip engine keeps active trip sessions in an in-memory `Map`. It is suitable for the current MVP and single-process preview. A production multi-instance deployment should persist trip drafts and confirmed itineraries in the database before scaling horizontally.

### Domain catalogue

`server/packagepro.ts` contains the canonical catalogue used as the deterministic source of truth for the MVP:

- origins and destinations
- curated packages and package components
- flights and hotel fallback inventory
- local guides and availability records
- train and cab fallback inventory
- package alternatives and recommendation scoring
- date calculations and guide availability checks

### External adapters

`server/integrations.ts` contains short-timeout adapters for live providers. Every live provider has a deterministic catalogue fallback so the planner remains usable when a provider is unavailable, rate-limited, unconfigured, or slow.

`server/aiChat.ts` handles free-model discovery, natural-language trip parsing, transparent explanations, conversational commands, and the deterministic offline fallback.

`server/insights.ts` retrieves and caches destination summaries. The scraper is deliberately bounded by a short timeout and does not block the planner when external content cannot be retrieved.

### Persistence and authentication

The generated WebDev template includes Manus OAuth, Drizzle schema support, MySQL/TiDB connectivity, session cookies, and S3 helpers. Core identity data is represented in `drizzle/schema.ts`. Feature trip state is currently session-oriented and should be moved into durable tables when user accounts, saved drafts, or multi-device continuity become requirements.

## Repository structure

```text
client/
  index.html                 Browser document shell
  src/
    App.tsx                  Application shell and providers
    main.tsx                 React entry point
    pages/Home.tsx           Main staged planner
    components/              Planner and reusable UI components
    components/ui/           shadcn-style UI primitives
    i18n.ts                  Supported language dictionaries
    lib/                     tRPC and itinerary export helpers
    index.css                Global design system

drizzle/
  schema.ts                  Database schema
  migrations/                Generated migration metadata

server/
  _core/                     WebDev runtime, OAuth, tRPC, storage, and helpers
  packagepro.ts               Catalogue and guide rules
  trips.ts                   Trip state machine and budget ledger
  routers.ts                 tRPC API contract
  integrations.ts            Live provider adapters and notifications
  aiChat.ts                  NLP, free-model chain, and explanations
  insights.ts                Cached destination insight retrieval
  *.test.ts                  Vitest coverage

shared/
  _core/                     Shared runtime errors and constants
  types.ts                   Shared application types

package.json                 Scripts and dependencies
vite.config.ts               Vite and WebDev configuration
vitest.config.ts             Test configuration
.gitignore                   Secret and generated-file exclusions
```

## Prerequisites

Install the following tools before starting local development:

- Node.js 20 or newer. Node.js 22 is recommended.
- pnpm 10 or newer.
- Git.
- A MySQL-compatible database only if durable user or feature data is required locally.
- Provider credentials only for the live integrations you intend to use. The catalogue fallback works without third-party travel credentials.

## Local setup

Clone the repository and check out the application branch:

```bash
git clone https://github.com/DevodG/packagepro-best.git
cd packagepro-best
git checkout best
```

Install dependencies:

```bash
pnpm install
```

Create a local `.env` file from the variable list below. Do not commit it:

```bash
touch .env
```

Populate only the variables needed for your environment. The repository intentionally does not include an environment template containing provider names or credential placeholders. For the catalogue-only experience, the application can run with the core WebDev runtime variables supplied by the hosting environment and without optional travel-provider keys.

Start the development server:

```bash
pnpm dev
```

The WebDev runtime prints the local preview URL. Open that URL in a browser and use the staged planner from the trip brief screen.

## Environment configuration

Secrets are read only on the server. Never put provider credentials in React code, `client/public`, committed Markdown, test fixtures, or a browser-visible `VITE_*` variable.

### Core runtime variables

| Variable | Required use | Notes |
|---|---|---|
| `VITE_APP_ID` | Manus OAuth client identity | Supplied by the managed WebDev runtime. |
| `JWT_SECRET` | Session cookie signing | Use a strong private value outside managed hosting. |
| `DATABASE_URL` | MySQL/TiDB persistence | Required for durable database operations; the current trip engine remains in memory. |
| `OAUTH_SERVER_URL` | OAuth server base URL | Supplied by the managed runtime when Manus OAuth is enabled. |
| `OWNER_OPEN_ID` | Owner/admin mapping | Used by the generated user upsert flow. |
| `BUILT_IN_FORGE_API_URL` | Built-in Manus APIs | Used by the generated runtime helpers. |
| `BUILT_IN_FORGE_API_KEY` | Built-in Manus API authorization | Server-side only. |

### Optional travel and AI variables

| Variable | Provider or feature | Behavior when missing |
|---|---|---|
| `HOTELBEDS_API_KEY` | Hotelbeds test availability | Uses the catalogue hotel inventory. |
| `HOTELBEDS_API_SECRET` | Hotelbeds request signature | Uses the catalogue hotel inventory. |
| `HOTELBEDS_API_KEY_ALT` | Optional second Hotelbeds credential | Tries after the primary pair. |
| `HOTELBEDS_API_SECRET_ALT` | Optional second Hotelbeds secret | Tries after the primary pair. |
| `SKYSCANNER_API_KEY` | Skyscanner through RapidAPI | Tries AviationStack, then catalogue flights. |
| `AVIANSTACK_API_KEY` | AviationStack flight fallback | Uses catalogue flights when unavailable. |
| `EXCHANGE_RATE_API_KEY` | ExchangeRate API | Uses conservative built-in INR fallback rates. |
| `SARVAM_API_KEY` | Dynamic translation | Returns source text when unavailable. |
| `OPENROUTER_API_KEY` | Free-model chat and structured NLP | Uses deterministic parser and context explanation fallback. |
| `RESEND_API_KEY` | Email confirmation | Email notification is skipped when absent. |
| `TWILIO_ACCOUNT_SID` | SMS confirmation | SMS notification is skipped unless all Twilio variables exist. |
| `TWILIO_AUTH_TOKEN` | SMS confirmation | Server-side only. |
| `TWILIO_FROM_NUMBER` | SMS sender | Server-side only. |

Provider calls use short timeouts and return catalogue or rule-based fallbacks. This prevents an external provider outage from blocking the core planning flow.

## Development commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Vite/Express development server with watch mode. |
| `pnpm check` | Run TypeScript type checking without emitting files. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm build` | Build the client bundle and bundle the production server. |
| `pnpm start` | Start the bundled production server. |
| `pnpm format` | Format project files with Prettier. |
| `pnpm db:push` | Generate and apply Drizzle migrations when database schema changes. |

## API documentation

The application exposes a typed tRPC router under the WebDev `/api/trpc` gateway. Frontend code should use the generated `trpc` client rather than hand-written REST or Axios calls.

The procedure names below are shown as `router.procedure`. Inputs are validated with Zod before the procedure executes.

### Authentication procedures

| Procedure | Type | Input | Description |
|---|---|---|---|
| `auth.me` | Query | None | Returns the current authenticated user or `null`. |
| `auth.logout` | Mutation | None | Clears the session cookie. |

### PackagePro catalogue procedures

| Procedure | Type | Input | Description |
|---|---|---|---|
| `packagepro.cities` | Query | None | Returns origin and destination catalogue records. |
| `packagepro.reality` | Query | `{ destination, budget, duration }` | Returns a budget reality verdict, typical cost, and closest package. |
| `packagepro.list` | Query | Optional `{ theme, language }` | Lists curated packages and filters by theme or tag. |
| `packagepro.detail` | Query | `{ id }` | Returns one package or a not-found error. |
| `packagepro.alternatives` | Query | `{ packageId, componentId }` | Returns valid component swaps in the same swap group. |
| `packagepro.guides` | Query | `{ city, language?, specialisation? }` | Lists catalogue guides matching the requested city and optional filters. |
| `packagepro.checkGuide` | Query | `{ guideId, departDate, duration, language?, specialisation? }` | Checks date conflicts, compliant replacements, price deltas, and acceptance. |
| `packagepro.recommend` | Query | `{ query, language, destination?, budget? }` | Scores packages and guides using interests, destination, budget, and language, and returns a cached destination insight. |
| `packagepro.translate` | Mutation | `{ texts, language }` | Translates a bounded list of dynamic strings when Sarvam is configured. |
| `packagepro.explain` | Mutation | `{ messages, context? }` | Returns a transparent explanation, parsed trip request, or conversational command result. |

### Trip procedures

| Procedure | Type | Input | Description |
|---|---|---|---|
| `trip.create` | Mutation | `{ origin, destination, departDate, returnDate, travelers, budgetCap, language, interests? }` | Creates a trip draft at flight selection. |
| `trip.autoBuild` | Mutation | Trip fields plus `budgetCap?`, `hotelTier?`, `transportMode?` | Builds a complete draft from a parsed conversational request. |
| `trip.get` | Query | `{ tripId }` | Returns the current trip snapshot, remaining budget, reality check, and trace. |
| `trip.selectFlight` | Mutation | `{ tripId, flightId }` | Adds a flight or enters negotiation if the cap would be exceeded. |
| `trip.selectHotel` | Mutation | `{ tripId, hotelId }` | Adds the hotel and duration-aware package baseline. |
| `trip.swapHotel` | Mutation | `{ tripId, target }` | Finds a descriptive hotel match and applies the price delta. |
| `trip.swap` | Mutation | `{ tripId, fromId, toId }` | Swaps a package component in the same swap group and reprices the ledger. |
| `trip.continuePackage` | Mutation | `{ tripId }` | Advances from package configuration to guide selection. |
| `trip.guides` | Query | `{ tripId, specialisation? }` | Lists exact-language guides and annotates every actual trip date with availability. |
| `trip.selectGuide` | Mutation | `{ tripId, guideId, days }` | Validates destination, language, specialisation, all package dates, and budget before adding a guide. |
| `trip.skipGuide` | Mutation | `{ tripId }` | Skips optional guide booking and advances to review. |
| `trip.removeGuide` | Mutation | `{ tripId }` | Removes a selected guide and subtracts its full cost. |
| `trip.negotiate` | Mutation | `{ tripId, choice, newCap? }` | Approves overage, raises the cap, removes the pending item, or returns to the prior stage. |
| `trip.goBack` | Mutation | `{ tripId }` | Returns to the previous stage and rolls back the relevant selection. |
| `trip.setLanguage` | Mutation | `{ tripId, language }` | Updates the trip language preference and returns the new snapshot. |
| `trip.confirm` | Mutation | `{ tripId, email?, phone? }` | Confirms the review-stage itinerary and optionally sends email or SMS notifications. |

### Example frontend call

The typed client is used from React components as follows:

```tsx
const trip = trpc.trip.create.useMutation();

trip.mutate({
  origin: "DEL",
  destination: "JAI",
  departDate: "2026-10-10",
  returnDate: "2026-10-12",
  travelers: 1,
  budgetCap: 45000,
  language: "en-IN",
  interests: "heritage and local food",
});
```

### Trip status values

The `TripStatus` union is:

```text
select_flight | select_hotel | select_package | select_guide |
negotiate | review | confirmed
```

The backend rejects actions that do not match the current state. This keeps the UI and the server state machine aligned.

## Guide availability and budget rules

Guide selection is deliberately stricter than a normal dropdown.

1. The package duration is converted into an inclusive date list with `datesBetween(departDate, durationDays)`.
2. A guide is available only when `guide.availability[date] === true` for every package date. Missing keys are therefore unavailable by default.
3. The guide must belong to the selected destination city.
4. The guide must speak the exact requested language. English fallback is not silently substituted for a different explicit language.
5. The guide specialisation must match the package-derived requirement, such as `heritage` or `food`.
6. A clash response includes all conflicting dates, all requested package dates, and every compliant substitute that is available for the full date window.
7. Substitute ranking first minimizes day-rate distance from the requested guide and then uses rating as a tie-breaker.
8. The replacement cost is calculated from the requested billed guide days. The replacement must still be available across the complete package date window.
9. The `tryAdd` budget gate runs before a guide is added. If the new total exceeds the cap, the guide remains unselected and the trip enters `negotiate` with explicit overage choices.
10. Guide requests longer than the actual trip duration are rejected rather than silently truncated.

This design makes the mandatory judge scenario deterministic: the traveller selects a guide with a real date clash, sees the named dates, receives a same-language and same-specialisation replacement, and sees the resulting price delta before accepting it.

## Integrations and fallbacks

### Hotelbeds

`searchHotelsLive` signs test-environment Hotelbeds requests with the configured API key and secret. It maps successful results into the internal `HotelRecord` shape and combines them with the local catalogue. If the provider fails or credentials are absent, catalogue hotels remain available.

### Flights

`searchFlightsLive` tries Skyscanner through RapidAPI first, then AviationStack, and finally the deterministic flight catalogue. Provider results are normalized into `FlightRecord` objects so the planner does not depend on provider-specific response shapes.

### Exchange rates

The ExchangeRate adapter converts USD and EUR amounts into INR and caches successful rates for one hour. Conservative fallback rates keep catalogue and test flows deterministic when the provider is unavailable.

### Sarvam translation

`translateText` and `translateMany` translate bounded dynamic strings from Indian English into supported language codes. Results are cached in memory and source text is returned when the provider is not configured or times out.

### OpenRouter

The AI service discovers zero-priced prompt and completion models from OpenRouter when `OPENROUTER_API_KEY` is configured. It maintains a known free-model chain as a fallback and never requires a paid model for the planner’s AI path. The deterministic parser and context engine remain available when OpenRouter is unavailable.

The AI system receives the active planner context and is instructed to use only catalogue-backed facts. It can explain current selections, parse trip intent, and return structured actions. It does not independently confirm or book a trip.

### Destination insights

`getDestinationInsight` requests a Wikipedia REST page summary with a short timeout and six-hour cache. A curated catalogue sentence is used in tests, on provider failure, or when the city is not found.

### Notifications

Confirmation notifications are optional. Resend handles email and Twilio handles SMS when their complete server-side variable sets are present. Notification failure does not invalidate the confirmed trip state.

## Testing

The test suite runs in a Node environment and includes catalogue scoring, trip state transitions, automatic package building, strict guide availability, budget negotiation, AI parsing, notification adapters, OpenRouter fallback behavior, and WhatsApp itinerary formatting.

Run all checks before opening a pull request:

```bash
pnpm test
pnpm check
pnpm build
```

The current release was validated with **22 passing tests**, a successful TypeScript check, and a successful production build. External smoke tests are written to tolerate temporary provider outages; domain tests use deterministic catalogue fallbacks.

When adding a provider adapter, add tests for both the successful response mapping and the no-credential or timeout fallback. When changing a trip transition, add a test for both the accepted path and the rejected state or budget path.

## Production build and deployment

Build the production client and server bundle:

```bash
pnpm build
```

The command writes the browser bundle and the bundled server under `dist/`. Start the production server with:

```bash
pnpm start
```

Node 22.13 or newer is required (the server uses the built-in `node:sqlite`). Trips and bookings live in `data/packagepro-app.db` (override with `PACKAGEPRO_APP_DB`); the PS-04 dataset in `data/PS-04.db` is read-only. Clear test trips and bookings with `pnpm db:reset` while the server is stopped.

### Deploy on Railway

`railway.json` holds the build (`pnpm build`) and start (`pnpm start`) commands and a health check on `/`.

1. In Railway, **New Project → Deploy from GitHub repo**, pick this repository and the branch to deploy.
2. **Variables:** add the keys listed in `.env.example` (at minimum `SARVAM_API_KEY`, `SERP_API_KEY`, `JWT_SECRET`), plus `PACKAGEPRO_APP_DB=/data/packagepro-app.db`.
3. **Volume:** add a volume to the service mounted at `/data` so trips and bookings survive redeploys. Do not mount it over `/app/data` — that would hide the bundled dataset.
4. **Networking → Generate Domain** to get the public URL. Railway sets `PORT`; the server reads it.

Keep a single instance: the planner caches active trips in memory in front of the SQLite store.

## Security and secret handling

- Keep all API credentials in server-side environment variables or the managed secret store.
- Never prefix private provider credentials with `VITE_`; Vite variables are browser-visible.
- Do not commit `.env`, `.env.local`, provider response dumps, credentials, or generated local databases.
- Do not return provider credentials through tRPC responses or include them in AI context.
- Treat user email, phone, and itinerary details as sensitive application data.
- Validate all procedure inputs with Zod before calling domain functions.
- Keep provider requests behind bounded timeouts and deterministic fallbacks.
- Rotate any credential immediately if it appears in a commit, log, screenshot, issue, or chat message.
- Review `git diff --check`, `git status`, and a secret scan before every push.

## Known limitations and extension points

### Durable trip persistence

Active trips are currently stored in memory. Add tables for trip drafts, selections, ledger events, guide checks, and confirmation records when saved itineraries or multi-instance operation is required.

### Provider normalization

The live adapters intentionally normalize only the fields needed by the MVP. A production booking workflow should add supplier identifiers, fare rules, cancellation policies, room occupancy details, and booking confirmation reconciliation.

### Availability freshness

The guide catalogue is deterministic for the current demo and does not yet connect to a calendar or workforce scheduling provider. A production implementation should update guide availability through a signed internal feed and record an availability-check timestamp with each selection.

### Confirmation workflow

The current confirmation mutation records the planner state and optionally sends notifications. It is not a payment, supplier booking, ticketing, or legally binding reservation workflow.

### AI scope

The AI layer is an explanation and planning assistant. It must remain grounded in the supplied catalogue and current planner state. Any future booking, payment, cancellation, or external commitment must remain behind explicit product workflows and appropriate confirmation controls.

## References

[1]: https://trpc.io/docs "tRPC documentation"

[2]: https://orm.drizzle.team/docs/overview "Drizzle ORM documentation"

[3]: https://openrouter.ai/docs "OpenRouter API documentation"

[4]: https://docs.sarvam.ai/api-reference/text/translate-text "Sarvam translation API documentation"

[5]: https://developer.hotelbeds.com/documentation/hotels/booking-api/ "Hotelbeds Hotels Booking API documentation"

[6]: https://en.wikipedia.org/api/rest_v1/ "Wikipedia REST API documentation"

[7]: https://cli.github.com/manual/gh_repo_create "GitHub CLI repository creation documentation"

## Telegram bot (@wayypoint_Bot)

The bot runs inside the server (`server/telegramBot.ts`) and uses the same engine as the web app — live fares, PS-04 packages,
per-date guide availability with same-language/same-specialisation substitutes, budget negotiation and bookings — in
English, हिन्दी, தமிழ் and తెలుగు (hand-written bot copy; dataset content via the cached Sarvam translations).

- **Buttons:** browse packages by theme → package card with photo → plan: origin, calendar date, days, travellers, budget,
  guide language → live estimate → flights → customise (hotel, add-ons, guide, days) → review → confirm (PNR).
- **Free text / AI:** "beach honeymoon under 40k" gets package picks; "Mumbai to Goa for 3 days" pre-fills the planner;
  questions about the current trip ("why was Meera refused?") get grounded answers; "cheaper hotel" edits the trip.
- **Setup:** set `TELEGRAM_BOT_TOKEN`. Long polling needs no webhook. Only one instance may poll a token, so set
  `TELEGRAM_BOT_DISABLED=true` locally once the deployed server runs the bot. Sessions persist in the app database.

## Guide bookings hold real slots

`guide_availability.slots_available` (0–2 per guide per day) is the guide's capacity. A guide is free on a date only when the
dataset marks them available **and** a slot is left after PackagePro's confirmed bookings (`app_guide_bookings`). Confirming a
trip reserves the guide's dates inside one database transaction and re-checks capacity there, so two travellers can never take
the same last slot: the later one is refused, the guide is removed and repriced, and same-language substitutes are offered.

- `pnpm db:show` — bookings, which guide dates they hold, and slot usage per guide/date (open / FULL).
- `pnpm db:reset` — clears trips, bookings, guide reservations and Telegram chats (run before a demo). The PS-04 dataset is untouched.
