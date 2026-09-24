# PackagePro — AI

Every AI feature is **grounded in the PS-04 dataset and the live trip state**; the model never invents inventory or prices, and
each feature has a deterministic fallback so the app keeps working without a model. The AI code lives in the server
(`ai/pipeline.ts`, `backend/src/estimate.ts`, `backend/src/integrations.ts`) next to the engine it calls.

| Feature | Mechanism | Grounding | Fallback | Evidence |
|---|---|---|---|---|
| **AI package-builder** from free-text interests, budget and booking history | Sarvam `sarvam-105b-conversations` (OpenRouter fallback), JSON-mode prompt in `matchPackagesFromInterests()` | Picks **only** from a compact list of the 45 dataset packages (id · city · theme · tier · days · price · languages); a stated budget filters the list before the model and every pick after it; invented IDs are dropped; the traveller's `user_preferences` and past bookings (`bookings → trips → cities`) are attached server-side from `userId` | Keyword/interest scoring in `recommendPackages()`, boosted by the traveller's favourite themes | `tests/aiChat.test.ts` (real catalogue picks without an LLM; budgets in numbers, k, हज़ार, ஆயிரம், lakh) |
| **Trip-request parser** ("Mumbai to Goa for 3 days next week") | Rule parser with city aliases, then the model only when a city is named (`parseTripRequestWithModel()`) | Destinations and origins limited to the catalogue lists | Rules only | `tests/aiChat.test.ts` (Jaipur weekend request, Mumbai → Panaji not Mumbai → Mumbai) |
| **Transparent agent** ("why was Meera refused?") | Sarvam chat with a grounded system prompt in `explainWithFreeOpenRouter()` | `compactContext()` passes the live trip: flight, hotel, package, guide, the refusal (clashing dates, substitutes, new totals) and the traveller profile; the prompt forbids facts outside it | Context-built explanations (`fallbackExplanation()`) | `tests/aiChat.test.ts` (answers with model attribution or graceful fallback); live check: names the date, substitute and new total |
| **Trip edits by chat** ("cheaper hotel", "remove the guide") | Command parser → `trips.swapHotel()` / `trips.removeGuide()` | The engine reprices; the model does not compute prices | — | `tests/aiChat.test.ts` (itinerary edits → commands) |
| **Estimate insight** | `completeGrounded()` in `backend/src/estimate.ts`, 3 bullets | Only the JSON facts (live fares, package base + components, guides, past-traveller popularity); "never invent prices" | Rule-based bullets | Estimate screen, PDF; the offline tests exercise the rule-based path |
| **Multilingual content** | Sarvam `mayura:v1` translation (`translateText`, disk cache `data-model/seed/translation-cache.json`), replies generated directly in the user's language | Dataset strings only; proper nouns (hotels, guides) are never translated; contractual text is hand-written | English passthrough | `tests/telegramBot.test.ts` (menus in हिन्दी / தமிழ் / తెలుగు) |

## Prompts

The prompts are in the functions above; the key constraints each one states:

- **Builder** — "pick the 3 best packages from this catalogue ONLY", budget rule, prefer the guide language, use the traveller
  profile (favour past themes, avoid already-visited cities unless asked), reply in the user's language, JSON only.
- **Agent** — "Use ONLY the supplied PackagePro context and catalogue facts … When a guide was refused, name the unavailable date
  and the substitute (same language and specialisation) with the new total. Never assume a destination or invent inventory or prices."
- **Estimate analyst** — "Use ONLY the JSON facts given … Quote rupee figures from the facts; never invent prices."

## How we know it works

- Offline test suites (`pnpm verify`) run with the model switched off and prove every fallback path.
- The builder's budget rule and ID validation are enforced in code, not trusted to the model.
- Live checks during development: Hindi/Tamil/Telugu interest requests return in-budget picks with reasons in that language;
  the agent answers the refusal question with the real date, substitute and total.
