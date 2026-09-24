import { describe, expect, it } from "vitest";

describe("third-party API secrets", () => {
  it("has all required travel secrets configured", () => {
    const required = [
      "HOTELBEDS_API_KEY",
      "HOTELBEDS_API_SECRET",
      "EXCHANGE_RATE_API_KEY",
      "SARVAM_API_KEY",
      "SKYSCANNER_API_KEY",
      "RESEND_API_KEY",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ];
    for (const key of required) {
      expect(process.env[key], `${key} should be set`).toBeTruthy();
    }
  });

  it("pings ExchangeRate API with the stored key", async () => {
    const key = process.env.EXCHANGE_RATE_API_KEY;
    expect(key).toBeTruthy();
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { result?: string; conversion_rates?: { INR?: number } };
    expect(body.result).toBe("success");
    expect(body.conversion_rates?.INR).toBeGreaterThan(50);
  }, 15000);

  it("pings Sarvam translate with the stored key", async () => {
    const key = process.env.SARVAM_API_KEY;
    expect(key).toBeTruthy();
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": key!,
      },
      body: JSON.stringify({
        input: "Hello",
        source_language_code: "en-IN",
        target_language_code: "hi-IN",
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { translated_text?: string };
    expect(body.translated_text && body.translated_text.length).toBeGreaterThan(0);
  }, 15000);
});
