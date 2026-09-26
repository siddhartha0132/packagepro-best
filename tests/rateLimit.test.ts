import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../backend/src/routers";
import { LIMITS, clientOf, setRateLimitsForTests, takeToken } from "../backend/src/rateLimit";

// The paid AI endpoints (speech, translation, chat) are rate limited per client and per day, so a public URL can't drain the credit.

beforeEach(() => setRateLimitsForTests(true));
afterEach(() => setRateLimitsForTests(false));

describe("rate limits on paid AI endpoints", () => {
  it("allows a client its quota in the window, blocks the next call, and lets it through again once the window passes", () => {
    const { perClient, windowMs } = LIMITS.voiceHear;
    const start = Date.parse("2026-09-26T10:00:00Z");
    for (let i = 0; i < perClient; i++) expect(takeToken("voiceHear", "1.2.3.4", start + i)).toBeNull();
    const blocked = takeToken("voiceHear", "1.2.3.4", start + perClient);
    expect(blocked).toMatchObject({ scope: "client" });
    expect(blocked!.retryAfterSeconds).toBeGreaterThan(0);
    expect(takeToken("voiceHear", "5.6.7.8", start + perClient)).toBeNull(); // another client is unaffected
    expect(takeToken("voiceHear", "1.2.3.4", start + windowMs + 1)).toBeNull(); // the window slid past
  });

  it("stops everyone once the day's total is used, until the next day", () => {
    const { dailyTotal } = LIMITS.voiceSpeak;
    const day = Date.parse("2026-09-26T09:00:00Z");
    for (let i = 0; i < dailyTotal; i++) expect(takeToken("voiceSpeak", `client-${i}`, day + i)).toBeNull();
    expect(takeToken("voiceSpeak", "fresh-client", day + dailyTotal)).toMatchObject({ scope: "daily" });
    expect(takeToken("voiceSpeak", "fresh-client", Date.parse("2026-09-27T00:00:01Z"))).toBeNull();
  });

  it("identifies the caller behind Railway's proxy by the first X-Forwarded-For address", () => {
    expect(clientOf({ headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2" } })).toBe("203.0.113.7");
    expect(clientOf({ headers: {}, ip: "198.51.100.4" })).toBe("198.51.100.4");
    expect(clientOf(undefined)).toBe("unknown");
  });

  it("the AI chat endpoint answers TOO_MANY_REQUESTS with a plain message once a client is over its limit", async () => {
    const caller = appRouter.createCaller({ req: { headers: { "x-forwarded-for": "203.0.113.9" } } as never, res: {} as never, user: null });
    const ask = () => caller.packagepro.explain({ messages: [{ role: "user", content: "why this hotel?" }], context: {} });
    for (let i = 0; i < LIMITS.ai.perClient; i++) await ask();
    await expect(ask()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/Too many AI answers/) });
  });
});
