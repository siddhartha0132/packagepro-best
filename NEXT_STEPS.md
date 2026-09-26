# PackagePro — where we are and what's next

Read this first when picking the project up again. Last updated: 26 Sept 2026.

## Where things stand

- **Repo:** `siddhartha0132/packagepro-best`, one branch: `best`. Railway deploys `best` on every push. GitHub Actions runs `pnpm verify` (type check, lint, tests, build) and the conformance validator on every push.
- **Live app:** https://packagepro-best-production.up.railway.app/ · Telegram bot: @wayypoint_Bot
- **Tests:** `pnpm verify` → 86 offline tests + build. `npx vitest run` → 90 (includes 4 live-key checks).
- **Local:** `pnpm dev` → http://localhost:3000. `pnpm db:reset` clears the app database before a demo.

### Built recently

- **Telegram, step by step:** flight → stay → extras → guide → review. The quotation comes as a real PDF, then "Request booking".
- **Travel agent approval.** Requests go to the web **travel desk** (`/agent`, key `AGENT_DASHBOARD_KEY`) and/or an agent's Telegram chat (`AGENT_TELEGRAM_CHAT_ID`). The agent can approve, reject with a reason, or send a **counter-offer**: swap the stay, an activity or the transfer, add or remove add-ons, give a discount or surcharge, add a note. It's priced live. The traveller accepts in one tap (booked at once) or keeps the original request.
- **Website travellers** must give a mobile number or email when they send a request. They get an SMS/email at each step with a link back to the trip, and **My bookings** finds a trip by reference + mobile/email.
- **PDFs:** headless Chrome prints the web app's `/print` page (the quotation, and the bill once confirmed). Links are HMAC-signed with `JWT_SECRET`. `railpack.json` installs Chromium and Noto fonts on Railway.
- **Itinerary in the right order:**
  - day 1 starts when the flight lands, with the transfer right after;
  - empty days say "Free time to explore";
  - the last day shows check-out.

  This is the same on the web, in Telegram and in the PDF.
- **Catalogue fits each place:**
  - Tirupati, Amritsar, Puri, Madurai and Varanasi are Pilgrimage packages;
  - no nightlife in sacred towns;
  - no beaches inland.

  The rules live in `backend/src/packagepro.ts → PLACE_THEME / misfitReason()`. The dataset itself is untouched.

### Railway variables

| Variable | Needed for |
|---|---|
| `PACKAGEPRO_APP_DB=/data/packagepro-app.db` + a volume at `/data` | Saved trips and bookings |
| `PUBLIC_APP_URL=https://packagepro-best-production.up.railway.app` | Links in PDFs, SMS/email, Telegram |
| `JWT_SECRET` | Signing PDF links (use a long random value) |
| `AGENT_DASHBOARD_KEY` | The travel desk at `/agent`; also turns on "Send to travel agent" |
| `AGENT_TELEGRAM_CHAT_ID` (optional) | The agent's Telegram chat. The agent sends `/chatid` to the bot to get it |
| `SARVAM_API_KEY`, `TELEGRAM_BOT_TOKEN` | AI, translation, voice, the bot |
| `RESEND_API_KEY` + `EMAIL_FROM`, `TWILIO_*` (optional) | Real emails and SMS to travellers |

Run exactly one replica.

## Next — in this order

### 1. Fixes (do these first)

1. **Holds never expire.** A request the agent never answers keeps the guide's dates blocked. Add an automatic release (e.g. after 24 h): cancel the request, free the dates, message the traveller, and show "expires in …" on the desk.
2. **Nights vs days.** The customiser says "3 days", the itinerary shows 3 nights / 4 days, and the catalogue name says "6 Days". Say "3 nights · 4 days" everywhere, and make the price line explain the proration.
3. **Button text sizes.** In `frontend/src/index.css`, `button { font: inherit }` sits outside a CSS layer, so it overrides Tailwind's text sizes on every button. Move it into `@layer base`, then check the pages visually.
4. **Check the live deploy.** Confirm the Railway build installs Chromium (bill PDF downloads) and that `/agent` works with the key.

### 2. Features

1. **Pay by UPI after approval** (top pick). The bill and approval message get a UPI QR code and a payment link (Razorpay test mode). Once paid, the booking shows "Paid ✓" and the bill becomes a receipt.
2. **Real landmarks for pilgrimage and heritage towns.** A small hand-checked list per city, with a timing tip for each: Tirumala darshan, the Golden Temple, Jagannath Temple, Meenakshi Temple, the Ganga aarti, …
3. **Trip-day companion on Telegram.** A checklist and the weather 3 days before; each morning of the trip, the day's plan and the guide's meeting time, in the traveller's language (text and voice).
4. **Agent's-eye summary on the desk.** A one-line AI note for each request (budget fit, guide held, a suggested counter-offer).
5. **Booking status timeline for the traveller:** Requested → With agent → Counter-offer → Approved → Paid.

### 3. Later (planned, not started)

- **Traveller login:** mobile number + one-time code, a profile (name, phone, language), and a "My trips" page.
- **Agent approves by phone call.** On a request, call the agent (Twilio Voice or Exotel), read a summary, and let them say "approve" / "reject" or press 1/2 (Sarvam speech for Hindi, Tamil and Telugu). No answer → retry, then the desk or Telegram. This reuses `approveBooking`, `rejectBooking` and the traveller notifications.

### 4. Housekeeping

- Split `backend/src/trips.ts` (~1,300 lines) into pricing, itinerary, guides and approvals.
- Clear the 30 ESLint warnings.
- Relabel the "Email itinerary" field on the review page; it's now the traveller's contact for the agent.

## Working rules for this repo

- Push only to `origin` / `best`. Never commit `.env` or `test-serp.js`.
- Commits are authored by Siddhartha Singhal only, with no co-author or "generated with" lines.
- `.env.example` holds blank or dummy values only.
- Destructive git operations (deleting branches, force pushes, rewriting history) need an explicit OK first.
- The API keys in `.env` are free-tier. They'll be rotated when the product is ready, so there's no need to raise it before then.
