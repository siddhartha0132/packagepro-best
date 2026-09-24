# PackagePro — architecture

PackagePro is **one TypeScript service with two channels**: the web app and a Telegram bot both drive the **same trip engine**,
so pricing, the guide availability check and bookings behave identically everywhere. The engine reads the organisers' PS-04
dataset (read-only) and writes the shared data model's canonical tables in a separate app database.

> Diagrams are Mermaid (rendered by GitHub). Static SVG copies live in [`docs/diagrams/`](diagrams/).

## 1 · System overview

```mermaid
flowchart LR
  subgraph Channels["Channels"]
    WEB["Web app<br/>React 19 · Vite · Tailwind<br/>frontend/"]
    TG["Telegram bot @wayypoint_Bot<br/>backend/src/telegramBot.ts"]
  end

  subgraph Service["Node 22 service — backend/src (Express + tRPC)"]
    API["tRPC API<br/>routers.ts"]
    ENGINE["Trip engine<br/>trips.ts<br/>pricing · swaps · negotiation · booking"]
    RULES["Catalogue + guide rules<br/>packagepro.ts · catalogue.ts"]
    TRAV["Traveller profiles<br/>travellers.ts"]
    EST["Live estimate<br/>estimate.ts"]
    STORE["Storage<br/>appStore.ts"]
    INT["Integrations<br/>integrations.ts · insights.ts"]
  end

  subgraph AI["AI — ai/"]
    PIPE["pipeline.ts<br/>parser · builder · agent"]
    PROMPTS["prompts/"]
  end

  subgraph Data["Data — data-model/"]
    DS[("PS-04 dataset<br/>seed/PS-04.db<br/>read-only")]
    APP[("App database<br/>canonical trips · itineraries ·<br/>itinerary_items · bookings<br/>+ app_* additions")]
  end

  subgraph External["External services"]
    SARVAM["Sarvam AI<br/>chat + mayura translation"]
    SERP["SerpAPI<br/>Google Flights"]
    WIKI["Wikipedia REST<br/>destination photos"]
    MAIL["Resend · Twilio<br/>confirmations"]
  end

  WEB -- "HTTPS / tRPC" --> API
  TG -- "long polling" --> ENGINE
  TG --> PIPE
  API --> ENGINE & EST & PIPE & TRAV & RULES
  ENGINE --> RULES & STORE & INT
  EST --> RULES & INT & PIPE
  PIPE --> PROMPTS
  PIPE --> SARVAM
  RULES --> DS
  TRAV --> DS
  STORE --> APP
  INT --> SERP & SARVAM & WIKI & MAIL
```

## 2 · Repository map

```mermaid
flowchart TB
  ROOT["kv-hack2026-rng-gods — pnpm workspace"]
  ROOT --> FE["frontend/<br/>package.json · src/pages · src/components<br/>i18n.ts (4 languages) · lib/translate.ts"]
  ROOT --> BE["backend/<br/>package.json · src/ (engine, API, bot)<br/>src/_core (server bootstrap)"]
  ROOT --> DM["data-model/<br/>DATA_MODEL.md · schema.sql (generated)<br/>seed/ PS-04.db · DDL · enums · demo caches"]
  ROOT --> AIF["ai/<br/>pipeline.ts · prompts/ · README.md"]
  ROOT --> DOCS["docs/<br/>ARCHITECTURE.md · API.md · DEMO_SCRIPT.md"]
  ROOT --> TESTS["tests/<br/>hardProof.guideAvailability.test.ts<br/>conformance · engine · AI · Telegram"]
  ROOT --> TOOLS["tools/ validate_conformance.py<br/>scripts/ conformance · db:show · db:schema"]
```

## 3 · Mandatory enhancement — the guide availability check

Adding a guide is never a blind dropdown: every trip date is checked against `guide_availability` **and** the slots already
held by confirmed PackagePro bookings.

```mermaid
sequenceDiagram
  autonumber
  actor T as Traveller
  participant UI as Web or Telegram
  participant API as trip.selectGuide / bookGuideDays
  participant E as Trip engine (trips.ts)
  participant G as guideCheck (packagepro.ts)
  participant S as App DB (app_guide_bookings)

  T->>UI: Add Meera Novak (Tamil, heritage)
  UI->>API: tripId, guideId, dates
  API->>E: selectGuide
  E->>G: check every trip date
  G->>S: confirmed bookings per guide and date
  S-->>G: booked counts
  Note over G: free = is_available and slots_available minus booked above 0
  alt any date clashes
    G-->>E: conflicts 2026-09-28 plus substitutes<br/>same language + specialisation, free on every date,<br/>nearest first (haversine, 400 km max), then smallest price change
    E-->>UI: refused, clashing date named,<br/>substitutes with repriced totals
    UI-->>T: Refused on 28 Sept, use Arjun Nair: total repriced
    T->>UI: Use Arjun Nair (or book Meera only on her free days)
    UI->>API: selectGuide or bookGuideDays
  else every date is free
    G-->>E: accepted
  end
  E->>E: priceBreakdown() recomputed from scratch
  E-->>UI: updated itinerary + live total
```

## 4 · Booking — one transaction, idempotent

```mermaid
sequenceDiagram
  autonumber
  participant UI as Web or Telegram
  participant E as confirmTrip (trips.ts)
  participant DB as App DB (appStore.recordBooking)

  UI->>E: confirm(tripId, idempotencyKey)
  alt trip already confirmed
    E-->>UI: same booking (no duplicate)
  else
    E->>E: re-check every guide on the plan (isGuideFree)
    E->>DB: BEGIN IMMEDIATE
    DB->>DB: idempotency_key seen? return that booking
    DB->>DB: re-count each guide and date against slots_available
    alt a slot was taken meanwhile
      DB-->>E: GuideSlotTakenError (rollback)
      E-->>UI: guide removed, repriced, substitutes offered
    else
      DB->>DB: INSERT itineraries (itn_), itinerary_items (itm_), bookings (bkg_)
      DB->>DB: INSERT app_guide_bookings (gbk_) per guide date, UPDATE trips status confirmed
      DB-->>E: COMMIT, booking reference (PNR)
      E-->>UI: confirmed + PNR (optional email / SMS)
    end
  end
```

## 5 · Pricing model

The PS-04 rule is *base + the deltas you keep*. Every change re-runs `priceBreakdown()` over the whole plan — nothing is
accumulated — and every sum is in **integer paise** (never a float).

```mermaid
flowchart LR
  F["Transport<br/>live fare x travellers"] --> TOTAL
  B["Package base<br/>base_price x days / package days x travellers"] --> TOTAL
  C["Kept components<br/>price_delta x units<br/>per person: activities, meals, tickets<br/>per room of 2: hotel (x nights stayed)<br/>per vehicle of 4: transfers"] --> TOTAL
  A["Add-ons<br/>optional components x units"] --> TOTAL
  G["Guides<br/>day_rate x price_multiplier per date<br/>per group, one guide per date"] --> TOTAL
  TOTAL(["Trip total"]) --> CAP{"within budget?"}
  CAP -- yes --> APPLY["applied"]
  CAP -- no --> NEG["negotiation<br/>approve · keep old plan · drop change · raise budget"]
```

## 6 · AI pipeline

```mermaid
flowchart LR
  TXT["Free text<br/>any of 4 languages"] --> ROUTE{"what is it?"}
  ROUTE -- "names a city" --> PARSE["Trip parser<br/>rules + model<br/>prompts/tripParser.ts"]
  ROUTE -- "interests, budget, vibe" --> BUILD["Package builder<br/>prompts/packageBuilder.ts"]
  ROUTE -- "edit: cheaper hotel, remove guide" --> CMD["Command parser"]
  ROUTE -- "question about the trip" --> AGENT["Transparent agent<br/>prompts/agent.ts"]
  subgraph Grounding
    CAT["45 catalogue packages"]
    PROF["Traveller profile<br/>user_preferences + booking history"]
    LIVE["Live trip context<br/>refusal dates · substitutes · totals"]
  end
  CAT --> BUILD
  PROF --> BUILD
  LIVE --> AGENT
  PARSE & BUILD & AGENT --> LLM["Sarvam sarvam-105b-conversations<br/>OpenRouter fallback"]
  LLM --> VAL["Validation in code<br/>catalogue IDs only · budget enforced<br/>before and after the model"]
  CMD --> ENG["Trip engine reprices"]
  VAL --> OUT["Reply in the user's language<br/>+ Build this package buttons"]
  LLM -. "no model available" .-> FB["Deterministic fallbacks<br/>keyword scoring · rule text"]
  FB --> OUT
```

## 7 · Data model — what we read, write and add

```mermaid
erDiagram
  cities ||--o{ tour_packages : hosts
  cities ||--o{ tour_guides : "based in"
  tour_packages ||--o{ package_components : "swappable lines"
  tour_guides ||--o{ guide_availability : "30-day calendar"
  hotels ||--o{ hotel_room_types : rooms
  users ||--|| user_preferences : "language + interests"
  users ||--o{ trips : owns
  trips ||--o{ itineraries : versions
  itineraries ||--o{ itinerary_items : lines
  trips ||--o{ bookings : "booked as"
  bookings ||--o{ app_guide_bookings : "reserves slots"
  tour_guides ||--o{ app_guide_bookings : "held by"

  package_components {
    string component_id PK
    string package_id FK
    string price_delta "signed, 2dp"
    int is_optional
    string swap_group
  }
  guide_availability {
    string guide_id FK
    string for_date
    int is_available
    int slots_available
    string price_multiplier
  }
  bookings {
    string booking_id PK "bkg_"
    string user_id FK
    string idempotency_key "unique"
    string total_amount "2dp + INR"
    string channel "web or mobile_app"
  }
  app_guide_bookings {
    string guide_booking_id PK "gbk_ (addition)"
    string booking_id FK
    string guide_id FK
    string for_date
  }
```

Read-only dataset tables: `tour_packages`, `package_components`, `tour_guides`, `guide_availability`, `hotels`,
`hotel_room_types`, `transfers`, `cities`, `languages`, `users`, `user_preferences`, `bookings → trips` (history).
Written canonical tables: `trips`, `itineraries`, `itinerary_items`, `bookings` (created verbatim from the dataset DDL).
Additions: `app_guide_bookings`, `app_trips`, `app_bot_sessions`, and `bookings.contact_email / contact_phone / guide_id`.
Full mapping and rules R1–R8: [`data-model/DATA_MODEL.md`](../data-model/DATA_MODEL.md).

## 8 · Deployment

```mermaid
flowchart LR
  GH["GitHub<br/>branch best"] --> RP["Railway · Railpack<br/>pnpm install · pnpm build"]
  RP --> SVC["One service<br/>pnpm start = node dist/index.js<br/>serves web + API + Telegram polling"]
  SVC --> VOL[("Volume /data<br/>packagepro-app.db")]
  SVC --> SEED[("data-model/seed<br/>PS-04.db in the image")]
  USERS["Browsers + phones"] -- HTTPS --> SVC
  SVC <-- "getUpdates / sendMessage" --> TGAPI["Telegram Bot API"]
  SVC --> EXT["Sarvam · SerpAPI · Wikipedia · Resend"]
```

Build: `vite build` (frontend → `dist/public`) + `esbuild` (backend → `dist/index.js`). Health check `/`; restart on failure.
Secrets only in Railway Variables. One instance (the trip engine caches active trips in memory in front of SQLite, and only
one process may poll a Telegram token).

## Components at a glance

| Component | Where | Responsibility |
|---|---|---|
| Web app | `frontend/src/pages/Home.tsx`, `HowItWorks.tsx`, `components/*` | Listing, detail, live estimate, flights, customiser (swaps, add-ons, duration, **guide planner grid**), review, PDF quotation, AI chat, traveller profile |
| API | `backend/src/routers.ts` | tRPC `packagepro.*` (catalogue, estimate, travellers, translate, AI) and `trip.*` (engine) — see [`API.md`](API.md) |
| Trip engine | `backend/src/trips.ts` | State machine `select_flight → select_package ⇄ negotiate → review → confirmed`; boundary rules (`assertTripRules`); pricing; guides whole-trip or day-by-day; idempotent booking; canonical rows |
| Catalogue & guide rules | `backend/src/catalogue.ts`, `packagepro.ts` | Dataset load; swappable packages; `isGuideFree()`, `guideCheck()` (clashes + nearest same-language/specialisation substitutes) |
| Traveller profiles | `backend/src/travellers.ts` | `users` + `user_preferences` + booking history |
| Estimate | `backend/src/estimate.ts` | Low ≤ typical ≤ high from live fares, base, components, guides; budget verdict; AI insight |
| AI | `ai/pipeline.ts`, `ai/prompts/*` | Parser, builder, agent, grounded completions — see [`ai/README.md`](../ai/README.md) |
| Storage | `backend/src/appStore.ts` | Canonical DDL at start-up, one transaction per booking, guide slot counts |
| Telegram | `backend/src/telegramBot.ts`, `botCopy.ts` | Same engine over buttons + free text, hand-written copy in 4 languages |

## Design decisions

- **One engine, two channels** — web and Telegram call the same functions, so a rule (like the guide check) is enforced once.
- **Recompute, never accumulate** — the total is rebuilt from the plan on every change, so swaps can't drift.
- **Integer paise** — rule R3 and the dataset's signed `price_delta` make floats unsafe.
- **SQLite (`node:sqlite`)** — the dataset ships as SQLite; zero-setup runs, one transaction guards the last guide slot.
- **Canonical tables created from the dataset's own DDL** — columns can never drift from the shared model.
- **Models are grounded and validated in code** — the builder only returns catalogue IDs within budget; every AI path has a
  deterministic fallback.
- **Hand-written copy for anything contractual** (terms, bot prompts) — machine translation is used only for dataset content.

## Quality gates

`pnpm verify` = type check + all offline test suites + production build, and it runs automatically before every `git push`
(`.githooks/pre-push`). `pnpm conformance` runs the organisers' `validate_conformance.py` on the dataset plus our rows → PASS.
