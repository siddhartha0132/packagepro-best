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
  VOICE["Voice note / web mic<br/>any of 4 languages"] --> HEAR["Sarvam saarika + saaras<br/>words as spoken + English meaning<br/>+ detected language"]
  HEAR --> TXT
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
  LLM -. "no model available" .-> FB["Deterministic fallbacks<br/>interest scoring · rule text"]
  FB --> OUT
  OUT -. "after a voice note" .-> SPEAK["Sarvam bulbul:v3<br/>spoken reply (MP3)"]
```

**Voice** (`backend/src/voice.ts`): one clip is heard twice in parallel — `saarika:v2.5` gives the words as spoken (shown back
to the traveller), `saaras:v2.5` gives the English meaning and the language. The English meaning goes through the same planner
as typed text, the reply comes in the detected language, and the first reply is read back with `bulbul:v3`. Notes over 30 s
are refused; without a key the traveller is asked to type. Measured by `pnpm voice:eval` → [VOICE_EVAL.md](VOICE_EVAL.md).

**Telegram booking with a travel agent** (`backend/src/telegramBot.ts`, `trips.requestBooking/approveBooking/rejectBooking`,
`backend/src/pdf.ts`): after the flight the bot walks the traveller step by step — stay → extras → guide → review — and sends
the quotation as a PDF in their language. With `AGENT_TELEGRAM_CHAT_ID` set, "Request booking" writes a `pending` booking
(guide dates held) and posts it to the agent's chat with Approve / Reject buttons; only that chat can decide.

```mermaid
sequenceDiagram
  participant T as Traveller (Telegram)
  participant B as Bot + trip engine
  participant A as Travel agent chat
  T->>B: flight → stay → extras → guide → review
  B-->>T: review + quotation PDF (traveller's language)
  T->>B: Request booking
  B->>B: booking 'pending', guide dates held
  B-->>A: request + quotation PDF · Approve / Reject
  alt approved
    A->>B: Approve
    B->>B: booking 'confirmed', dates confirmed, trip confirmed
    B-->>T: PNR + bill PDF + signed link
  else rejected (reason)
    A->>B: Reject · reason
    B->>B: booking 'cancelled' (kept), dates released, trip back to review
    B-->>T: reason + Request again
  end
```

PDFs are printed by headless Chrome from the web app's `/print` page (same template as the browser's "Save as PDF"), cached
per trip state, and linked with HMAC-signed URLs. Without an agent chat the bot books straight away; without Chrome it sends
the link instead of the file.

**Cost guard** (`backend/src/rateLimit.ts`): speech, spoken replies, translation and AI answers are rate limited per client (IP
on the web, chat on Telegram) in a 10-minute window and by a daily total across everyone, so a public URL can't drain the
AI credit.

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
`railpack.json` adds Chromium and Noto fonts (Devanagari, Tamil, Telugu) to the image for the PDF files.
Secrets only in Railway Variables. One instance (the trip engine caches active trips in memory in front of SQLite, and only
one process may poll a Telegram token).

## 9 · Frontend and backend — module map

Which file calls which. The browser only ever talks to the backend through one typed tRPC endpoint (`/api/trpc`); the
Telegram bot sits inside the backend and calls the trip engine directly.

```mermaid
flowchart TB
  subgraph FE["Frontend — frontend/src (React 19 · Vite · Tailwind)"]
    MAIN["main.tsx<br/>React Query + tRPC client"]
    APPR["App.tsx — routes<br/>/ · /how-it-works · 404"]
    HOME["pages/Home.tsx<br/>search · listing · detail · trip stepper"]
    HOW["pages/HowItWorks.tsx<br/>every PS-04 requirement + 3D demos"]
    TS["components/TripScreens.tsx<br/>estimate · flights · negotiation · review"]
    PC["components/PackageCustomiser.tsx<br/>swaps · add-ons · duration · price lines"]
    GP["components/GuidePlanner.tsx<br/>guides x dates grid · refusal card"]
    QD["components/QuoteDocument.tsx<br/>printable PDF quotation"]
    CHAT["components/AgentTransparencyChat.tsx<br/>AI chat"]
    IMG["components/SmartImage.tsx<br/>photo with fallback"]
    LIB["lib/trpc.ts · lib/translate.ts<br/>i18n.ts (4 languages) · quoteCopy.ts"]
  end

  subgraph BE["Backend — backend/src (Node 22 · Express · tRPC · Zod)"]
    IDX["_core/index.ts<br/>Express server · /api/trpc<br/>Vite in dev, static dist in prod<br/>starts the Telegram bot"]
    RT["routers.ts<br/>packagepro.* · trip.*"]
    TR["trips.ts — trip engine<br/>state machine · priceBreakdown<br/>guides · confirmTrip"]
    PP["packagepro.ts<br/>packages · guideCheck · isGuideFree"]
    CAT["catalogue.ts<br/>dataset load · paise helpers"]
    TRV["travellers.ts<br/>profiles + booking history"]
    EST["estimate.ts<br/>low · typical · high"]
    INT["integrations.ts · insights.ts<br/>flights · translation · photos · email/SMS"]
    ST["appStore.ts<br/>canonical DDL · recordBooking<br/>guide slot counts · bot sessions"]
    BOT["telegramBot.ts · botCopy.ts"]
  end

  AI["ai/pipeline.ts + ai/prompts/"]
  DS[("data-model/seed/PS-04.db<br/>read-only")]
  DB[("data/packagepro-app.db<br/>canonical + app_* tables")]

  MAIN --> APPR
  APPR --> HOME & HOW
  HOME --> TS & PC & QD & CHAT & IMG
  PC --> GP
  HOME & HOW & PC & GP & CHAT --> LIB
  LIB == "HTTPS · /api/trpc · superjson" ==> IDX
  IDX --> RT
  IDX --> BOT
  RT --> TR & PP & TRV & EST & INT & AI
  BOT --> TR & AI & ST
  TR --> PP & ST & INT
  EST --> PP & INT & AI
  PP --> CAT
  PP -- "booked slots" --> ST
  TRV --> CAT
  CAT --> DS
  ST --> DB
```

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
