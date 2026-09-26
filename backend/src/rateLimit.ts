import { TRPCError } from "@trpc/server";

// Rate limits for the endpoints that spend paid AI credit (Sarvam speech, translation, chat). Two guards per bucket:
//  - per client (IP on the web, chat id on Telegram) in a sliding window, so one caller can't loop the endpoint;
//  - a daily total across everyone, so even many callers can't drain the credit.
// In memory, which fits the single-instance deployment (see docs/ARCHITECTURE.md → Deployment).

type Bucket = { label: string; perClient: number; windowMs: number; dailyTotal: number };

const TEN_MINUTES = 10 * 60 * 1000;
export const LIMITS = {
  voiceHear: { label: "voice notes", perClient: 20, windowMs: TEN_MINUTES, dailyTotal: 500 },
  voiceSpeak: { label: "spoken replies", perClient: 40, windowMs: TEN_MINUTES, dailyTotal: 1000 },
  translate: { label: "translations", perClient: 120, windowMs: TEN_MINUTES, dailyTotal: 5000 },
  ai: { label: "AI answers", perClient: 40, windowMs: TEN_MINUTES, dailyTotal: 2000 },
} satisfies Record<string, Bucket>;
export type LimitName = keyof typeof LIMITS;

const MAX_TRACKED_CLIENTS = 10_000;
const hits = new Map<string, number[]>();
const daily = new Map<LimitName, { day: string; count: number }>();
let enabledInTests = false;

/** Limits are off under vitest (the suites call the AI paths many times) unless a test turns them on. */
export function setRateLimitsForTests(on: boolean) { enabledInTests = on; hits.clear(); daily.clear(); }
const active = () => !process.env.VITEST || enabledInTests;

/** The caller's address: the first X-Forwarded-For hop behind Railway's proxy, else the socket address. */
export function clientOf(req?: { headers?: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req?.ip || req?.socket?.remoteAddress || "unknown";
}

/** Counts one call; returns how long to wait when over a limit, or null when allowed. */
export function takeToken(name: LimitName, client: string, now = Date.now()): { retryAfterSeconds: number; scope: "client" | "daily" } | null {
  if (!active()) return null;
  const bucket: Bucket = LIMITS[name];
  const today = new Date(now).toISOString().slice(0, 10);
  const total = daily.get(name);
  if (total?.day === today && total.count >= bucket.dailyTotal) {
    const midnight = Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000;
    return { retryAfterSeconds: Math.ceil((midnight - now) / 1000), scope: "daily" };
  }
  const key = `${name}:${client}`;
  const recent = (hits.get(key) ?? []).filter(time => now - time < bucket.windowMs);
  if (recent.length >= bucket.perClient) return { retryAfterSeconds: Math.ceil((recent[0] + bucket.windowMs - now) / 1000), scope: "client" };
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_CLIENTS) hits.delete(hits.keys().next().value!); // forget the least recently active client
  daily.set(name, { day: today, count: (total?.day === today ? total.count : 0) + 1 });
  return null;
}

/** For tRPC procedures: throws TOO_MANY_REQUESTS with a plain-language message. */
export function enforceLimit(name: LimitName, client: string) {
  const blocked = takeToken(name, client);
  if (!blocked) return;
  const wait = blocked.retryAfterSeconds >= 3600 ? `${Math.ceil(blocked.retryAfterSeconds / 3600)} h` : `${Math.max(1, Math.ceil(blocked.retryAfterSeconds / 60))} min`;
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: blocked.scope === "daily"
      ? `Today's limit for ${LIMITS[name].label} has been reached — please try again in ${wait}, or type instead.`
      : `Too many ${LIMITS[name].label} in a short time — please wait ${wait} and try again.`,
  });
}
