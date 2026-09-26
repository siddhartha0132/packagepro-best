# PackagePro — API

Typed **tRPC** over HTTP at `/api/trpc/<procedure>` (superjson). Queries are `GET ?input={"json":{…}}`; mutations are `POST` with
body `{"json":{…}}`. Inputs are validated with Zod; money is returned in rupees computed from integer paise.

```bash
# example: live estimate, then a trip
curl -s 'http://localhost:3000/api/trpc/packagepro.estimate?input=%7B%22json%22%3A%7B%22origin%22%3A%22DEL%22%2C%22destination%22%3A%22Thanjavur%22%2C%22departDate%22%3A%222026-09-28%22%2C%22returnDate%22%3A%222026-10-01%22%2C%22travelers%22%3A4%2C%22budget%22%3A150000%2C%22language%22%3A%22ta%22%7D%7D'
curl -s -X POST http://localhost:3000/api/trpc/trip.create -H 'content-type: application/json' \
  -d '{"json":{"origin":"DEL","destination":"Thanjavur","departDate":"2026-09-28","returnDate":"2026-10-01","travelers":4,"budgetCap":150000,"language":"ta"}}'
```

## Catalogue, travellers and AI — `packagepro.*`

| Procedure | Type | Input | Returns |
|---|---|---|---|
| `packagepro.cities` | query | — | Origins (IATA) and destinations (dataset `city_id`, airport) |
| `packagepro.list` | query | `{ theme?, language? }` | Curated INR packages with photo and booking popularity; offered-in-language first |
| `packagepro.detail` | query | `{ id }` | One package: itinerary components, inclusions, exclusions, group size |
| `packagepro.alternatives` | query | `{ packageId, componentId }` | Swap options in the component's swap group |
| `packagepro.guides` | query | `{ city, language?, specialisation? }` | Guides in a city with **live** availability |
| `packagepro.checkGuide` | query | `{ guideId, departDate, duration, language?, specialisation? }` | Availability check: conflicts, substitutes, price delta |
| `packagepro.travellers` | query | — | Demo travellers from `users` + `user_preferences` + booking history |
| `packagepro.recommend` | query | `{ query, language, destination?, budget? }` | Ranked packages + guides with match reasons |
| `packagepro.estimate` | query | `{ origin, destination, departDate, returnDate, travelers, budget, language, uiLanguage? }` | Low / typical / high, verdict, group-size check, live flights, hotel tiers, guides, past-traveller popularity, AI insight |
| `packagepro.reality` | query | `{ destination, budget, duration }` | Quick budget reality check |
| `packagepro.translate` | mutation | `{ texts[], language }` | Cached Sarvam translations of dataset content |
| `packagepro.explain` | mutation | `{ messages[], context? }` | The AI agent: parses trip requests, builds packages from interests (+ traveller history via `context.userId`), edits the trip, or answers grounded questions |

## Voice — `voice.*`

| Procedure | Type | Input | Returns |
|---|---|---|---|
| `voice.status` | query | — | `{ enabled, maxSeconds }` — whether speech is set up (a Sarvam key) and the longest clip accepted (30 s) |
| `voice.hear` | mutation | `{ audio (base64, ≤ ~3 MB), mime }` | `{ native, english, language }` — the words as spoken, their English meaning, the detected language (`en-IN`, `hi`, `ta`, `te`, …) |
| `voice.speak` | mutation | `{ text, language }` | `{ audio (base64 MP3), mime }` or `null` — a short spoken version of the text |

**Rate limits** (`backend/src/rateLimit.ts`) — per client in a 10-minute window, and a daily total across all clients:
`voice.hear` 20 / 500, `voice.speak` 40 / 1,000, `packagepro.translate` 120 / 5,000, `packagepro.explain` 40 / 2,000.
Over a limit the call fails with `TOO_MANY_REQUESTS` and a plain-language message; the Telegram bot applies the same limits per chat.

## PDF files — `GET /api/pdf/:tripId/:kind/:lang/:signature.pdf`

`kind` is `quote` (any time) or `bill` (only once the booking is confirmed, else `409`); `lang` is `en-IN`, `hi`, `ta` or `te`.
The signature is an HMAC of trip, kind and language (`JWT_SECRET`), so a link can't be guessed from a trip id (`404` if it
doesn't match). The file is printed by headless Chrome from the web app's `/print?trip=…&lang=…&kind=…` page — the same
template as the browser's "Save as PDF", so Indian scripts shape correctly — and cached until the trip changes. `503` when
the server has no Chrome (`backend/src/pdf.ts`).

## Trip engine — `trip.*`

A trip moves `select_flight → select_package ⇄ negotiate → review → confirmed` (or, when booked through a travel agent in
Telegram, `review → awaiting_approval → confirmed | review`). Every mutation returns the full trip snapshot
(`priceBreakdown`, `itinerary`, `guideAvailabilityIssue`, `negotiationOptions`, `booking`).

| Procedure | Type | Input | Behaviour |
|---|---|---|---|
| `trip.create` | mutation | `{ origin, destination, departDate, returnDate, travelers, budgetCap, language, interests?, userId? }` | Enforces group size, BCP-47 language, INR; fetches live flights |
| `trip.autoBuild` | mutation | trip fields + `budgetCap?`, `hotelTier?`, `transportMode?`, `userId?` | Builds a complete trip from a chat request |
| `trip.get` | query | `{ tripId }` | Snapshot (reopens shared links) |
| `trip.selectFlight` | mutation | `{ tripId, flightId }` | Loads the package; negotiates if over budget |
| `trip.swap` | mutation | `{ tripId, fromId, toId }` | Swap hotel / activity / transfer; live reprice |
| `trip.swapHotel` | mutation | `{ tripId, target }` | Swap by tier words ("luxury", "budget") |
| `trip.toggleAddOn` | mutation | `{ tripId, componentId, include }` | Add or remove a recommended add-on |
| `trip.setDuration` | mutation | `{ tripId, days }` | Prorates the base; re-checks a booked guide |
| `trip.guides` | query | `{ tripId, specialisation? }` | Guides in the trip language with a per-date live calendar |
| `trip.selectGuide` | mutation | `{ tripId, guideId, days }` | **Availability check**: book, or refuse with named dates + same-language/specialisation substitutes and repriced totals |
| `trip.bookGuideDays` | mutation | `{ tripId, guideId, dates[] }` | **Day-by-day plan**: book a guide only on the picked dates (checked individually, refused with named dates + substitutes on a clash); other guides keep their other days |
| `trip.applySuggestion` | mutation | `{ tripId, suggestionId }` | Apply one of `suggestions` (over budget: priced budget fixes; within budget: upgrades that still fit — better-rated stay, add-on, one more day) |
| `trip.undo` | mutation | `{ tripId }` | Revert the last applied change |
| `trip.discardChanges` | mutation | `{ tripId }` | Back to the package's recommended components and the trip length first planned (flight kept) |
| `trip.removeGuide` | mutation | `{ tripId, guideId? }` | Remove one guide (or all) |
| `trip.skipGuide` / `trip.continuePackage` | mutation | `{ tripId }` | Move to review |
| `trip.negotiate` | mutation | `{ tripId, choice, newCap?, fixId? }` | `apply_fix` (one of `pending.fixes`: cheaper flight / stay / activity / transfer, drop an add-on or guide, one day shorter, or the combined `auto` plan — each priced on the whole plan) · `approve_overage` · `swap_cheaper` (keep the plan as it was) · `raise_cap` |
| `trip.goBack` | mutation | `{ tripId }` | One stage back |
| `trip.setLanguage` | mutation | `{ tripId, language }` | Change the guide language |
| `trip.confirm` | mutation | `{ tripId, email?, phone?, idempotencyKey? }` | Re-checks guide capacity, writes canonical itinerary/items/booking in one transaction; idempotent |
| `trip.bookings` | query | — | Recent bookings with guide dates |

`system.health`, `auth.*` and `system.notifyOwner` come from the app template and are not used by PackagePro's flows.
