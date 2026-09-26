# Demo script (about 5 minutes)

**Before you start:** run `pnpm db:reset` (it frees the demo guide's slots), then `pnpm dev`, or use the deployed URL. Open the web app full-screen, and Telegram (@wayypoint_Bot) on a phone. Do one dry run so live fares, translations and photos are warm.

Every fact below comes from the PS-04 dataset. The package is *Thanjavur Honeymoon* (groups of 4–8). In `guide_availability`, **Meera Novak** (Tamil, heritage) is unavailable on **28 Sept**. **Arjun Nair** (Tamil, heritage) is free 28–30 Sept.

## 1 · Web (3 minutes)

| # | Do | Say |
|---|---|---|
| 1 | Show the home page and scroll the cards | "45 real PS-04 packages by theme, ranked by real bookings." |
| 2 | **Travelling as → Anita Bhat** | "Her saved preferences in `user_preferences` switch the app to Tamil, set a Tamil guide, and her past trips drive *Picked for you*." Switch back to English. |
| 3 | **▶ Try the live demo** | "Delhi → Thanjavur, 28 Sept, 4 travellers — the package takes 4–8, and we enforce it." |
| 4 | The estimate screen | "Live Google Flights fares plus the package plus a guide in your language: Low, Typical and High against the budget." |
| 5 | Continue → pick the cheapest flight | "Fares are per person; the total is for all 4." |
| 6 | Swap the hotel, add an add-on | "Price is base plus every component you keep, per person, room or vehicle. The itinerary lines add up to the total." |
| 7 | **Guides → Meera Novak** | **Key moment:** "Refused: she's unavailable on 28 Sept (red on her calendar). We offer Arjun Nair, same Tamil language and heritage specialisation, all green, with the total repriced live." Click **Use Arjun Nair**. |
| 8 | Review → **Confirm** | "Booked, with a PNR. It's written to the canonical `bookings` table with an idempotency key, and Arjun's slots are now taken." |
| 9 | **Download quotation PDF** | "A client-ready quotation in the traveller's language." |
| 10 | AI chat: "Why was Meera refused?" | It names the date, the substitute and the new total. |

## 2 · Telegram (1.5 minutes)

"The same engine, where travellers already are."
1. Send `/start` and choose தமிழ் or हिन्दी.
2. Type "beach honeymoon under 40k". The AI returns packages within budget, in that language.
3. Send `/demo`, then **Build my trip** → pick a flight → **Add a guide → Meera Novak**. You get the same refusal, with the date strip `28 ❌ · 29 ✅ · 30 ✅` and the substitute.
4. Book the substitute → Confirm → booking reference.

### Voice (30 seconds)

5. Send **@wayypoint_Bot** a voice note in Tamil: *"தஞ்சாவூருக்கு மூன்று நாள் பயணம் திட்டமிடுங்கள்"* ("plan a three-day trip to
   Thanjavur"). The bot shows what it heard, switches to Tamil, starts planning, and replies with a **voice note**.
6. On the web, open *Ask why PackagePro chose this*, tap 🎙, say "Plan a two-day trip from Mumbai to Jaipur", tap again.
   The request is heard, the trip is built, and the answer is read aloud.
7. Line for the judges: *"20 out of 20 spoken requests in four languages understood, zero invented destinations, 1.7 s median"* —
   from `pnpm voice:eval` (docs/VOICE_EVAL.md).

## 3 · Proof (30 seconds)

- Run `npx vitest run tests/hardProof.guideAvailability.test.ts`. It tests the mandatory rule in the statement's own words.
- Run `pnpm conformance`. The organisers' validator reports **PASS** on the dataset plus our rows.
- Run `pnpm db:show`. It shows bookings, and Arjun is now **FULL** on 29–30 Sept, so a second traveller would be refused.

## Backup plans

- **Live fares fail:** the app falls back to catalogue fares, and the flow is unchanged.
- **AI is slow:** skip the chat step. The button flow doesn't depend on the model.
- **Wi-Fi fails:** play the recorded video of one clean run.
