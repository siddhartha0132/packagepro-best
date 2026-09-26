import { timingSafeEqual } from "node:crypto";

// The travel desk: who may approve bookings, and whether bookings need an approval at all.
// - AGENT_TELEGRAM_CHAT_ID: a travel agent's Telegram chat gets each request with Approve / Reject buttons.
// - AGENT_DASHBOARD_KEY: the web dashboard at /agent (list, approve, reject, counter-offer) opens with this key.
// With either set, travellers ask for a booking (web and Telegram) instead of booking outright.

export const REJECT_REASONS = [
  "The hotel has no rooms on those dates",
  "Flight fares have changed — please pick the flight again",
  "The guide can't confirm those dates",
  "Please call us to confirm a few details",
];

export const agentChat = () => process.env.AGENT_TELEGRAM_CHAT_ID?.trim() || "";
export const dashboardKey = () => process.env.AGENT_DASHBOARD_KEY?.trim() || "";
export const approvalRequired = () => Boolean(agentChat() || dashboardKey());

/** Constant-time check of the dashboard key sent in the x-agent-key header. */
export function agentKeyValid(given?: string | string[]) {
  const key = dashboardKey();
  if (!key || typeof given !== "string" || !given) return false;
  const expected = Buffer.from(key);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The app's public https address (PUBLIC_APP_URL, or Railway's domain); empty when it has none. */
export function publicBase() {
  const base = (process.env.PUBLIC_APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/$/, "");
  return base.startsWith("https://") ? base : "";
}
