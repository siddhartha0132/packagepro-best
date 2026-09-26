import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpdate } from "../backend/src/telegramBot";
import { clearGuideBookingsForTests, loadBotSession } from "../backend/src/appStore";
import { PACKAGES } from "../backend/src/packagepro";
import * as trips from "../backend/src/trips";
import { setVoiceBackendForTests } from "../backend/src/voice";
import { setPdfRendererForTests } from "../backend/src/pdf";

// Drives the Telegram bot end to end with a fake Telegram API: every message and button the bot would send is recorded
// and checked against Telegram's limits. No network: flights fall back to the catalogue and the LLM is off under vitest.

type Sent = { method: string; chatId: string; text: string; buttons: { text: string; data?: string; url?: string }[] };
let sent: Sent[] = [];
let updateId = 1;
let nextMessageId = 100;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T10:00:00+05:30"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (/api\.telegram\.org\/file\/bot/.test(href)) return new Response(new Uint8Array([79, 103, 103, 83]));
    const method = href.match(/api\.telegram\.org\/bot[^/]+\/(\w+)$/)?.[1];
    if (!method) throw new Error(`offline test: blocked ${href}`);
    if (init?.body instanceof FormData) {
      const file = init.body.get("document");
      sent.push({ method, chatId: String(init.body.get("chat_id")), text: String(init.body.get("caption") ?? (file instanceof File ? file.name : "")), buttons: [] });
      return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId++ } }), { headers: { "content-type": "application/json" } });
    }
    if (method === "getFile") return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/note.oga" } }), { headers: { "content-type": "application/json" } });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (["sendMessage", "sendPhoto", "editMessageText", "editMessageReplyMarkup"].includes(method)) {
      sent.push({
        method, chatId: String(body.chat_id), text: body.text ?? body.caption ?? "",
        buttons: (body.reply_markup?.inline_keyboard ?? []).flat().map((button: { text: string; callback_data?: string; url?: string }) => ({ text: button.text, data: button.callback_data, url: button.url })),
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId++ } }), { headers: { "content-type": "application/json" } });
  }));
});

afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => { sent = []; clearGuideBookingsForTests(); });

const say = (chatId: number, text: string, languageCode = "en") => handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: chatId }, from: { language_code: languageCode }, text } });
const tap = (chatId: number, data: string) => handleUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data, message: { message_id: 1, chat: { id: chatId } } } });
const last = () => sent[sent.length - 1];
const voice = (chatId: number, duration = 4) => handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: chatId }, from: { language_code: "en" }, voice: { file_id: `f${updateId}`, duration, mime_type: "audio/ogg" } } });
const allText = () => sent.map(message => message.text).join("\n");
const buttonData = () => sent.flatMap(message => message.buttons.map(button => button.data)).filter(Boolean) as string[];
const tripOf = (chatId: number) => loadBotSession<{ tripId?: string }>(String(chatId))?.tripId;
const thanjavur = PACKAGES.find(pkg => pkg.city === "Thanjavur")!;

/** Plan Delhi → Thanjavur, 28 Sept, 3 days, 4 travellers (the package takes 4–8), Tamil guide, up to the built trip on the package screen. */
async function planThanjavur(chatId: number) {
  await say(chatId, "/start");
  await tap(chatId, "L:en-IN");
  await tap(chatId, `B:${thanjavur.id}`);
  await tap(chatId, "O:DEL");
  await tap(chatId, "D:2026-09-28");
  await tap(chatId, "N:3");
  await tap(chatId, "V:4");
  await tap(chatId, "G:150000");
  await tap(chatId, "GL:ta");
  await tap(chatId, "E:go");
  await tap(chatId, "F:0");
}

describe("telegram bot", () => {
  it("answers a Tamil voice note in Tamil: shows what it heard, plans the trip, and speaks the reply back", async () => {
    let spoken: { text: string; language: string } | null = null;
    setVoiceBackendForTests({
      hear: async () => ({ native: "தஞ்சாவூருக்கு மூன்று நாள் பயணம் திட்டமிடுங்கள்", english: "Plan a three-day trip to Thanjavur.", language: "ta" }),
      speak: async (text, language) => { spoken = { text, language }; return new Uint8Array([1, 2, 3]); },
    });
    try {
      await say(9101, "/start");
      await tap(9101, "L:en-IN");
      sent = [];
      await voice(9101);
      expect(allText()).toContain("தஞ்சாவூருக்கு மூன்று நாள்"); // what was heard, in the traveller's script
      expect(loadBotSession<{ lang: string; draft: { city?: string; days?: number } }>("9101")).toMatchObject({ lang: "ta", draft: { city: "Thanjavur", days: 3 } });
      expect(sent.some(message => message.method === "sendVoice")).toBe(true);
      expect(spoken).toMatchObject({ language: "ta" });
      expect(spoken!.text).not.toMatch(/<|>|🎙/); // plain words only: no HTML or emoji read aloud
    } finally {
      setVoiceBackendForTests(null);
    }
  });

  it("refuses long voice notes, and asks to type when no speech service is set up", async () => {
    setVoiceBackendForTests({ hear: async () => null, speak: async () => null });
    try {
      await say(9102, "/start");
      await tap(9102, "L:en-IN");
      await voice(9102, 45);
      expect(last().text).toContain("under 30 seconds");
      await voice(9102, 3);
      expect(last().text).toContain("couldn't make that out");
    } finally {
      setVoiceBackendForTests(null);
    }
    await voice(9102, 3); // no backend and no key under vitest
    expect(last().text).toContain("please type instead");
  });

  it("greets new users with a language picker and localises the menu", async () => {
    await say(9001, "hello");
    expect(last().text).toContain("Welcome to PackagePro");
    expect(last().buttons.map(button => button.data)).toEqual(["L:en-IN", "L:ta", "L:hi", "L:te"]);
    await tap(9001, "L:hi");
    expect(last().text).toContain("आप क्या करना चाहेंगे?");
    expect(last().buttons.map(button => button.text)).toContain("🧳 पैकेज देखें");
    await tap(9001, "L:ta");
    expect(last().text).toContain("நீங்கள் என்ன செய்ய விரும்புகிறீர்கள்?");
    await tap(9001, "L:te");
    expect(last().text).toContain("మీరు ఏమి చేయాలనుకుంటున్నారు?");
  });

  it("browses themes, lists packages by popularity and opens a package card", async () => {
    await say(9002, "/start");
    await tap(9002, "L:en-IN");
    await tap(9002, "M:browse");
    expect(last().buttons.map(button => button.data)).toContain("T:heritage");
    await tap(9002, "T:all");
    const listed = last().buttons.filter(button => button.data?.startsWith("P:"));
    expect(listed.length).toBeGreaterThanOrEqual(5);
    await tap(9002, listed[0].data!);
    expect(last().text).toMatch(/₹[\d,]+/);
    expect(last().buttons.map(button => button.data)).toContain(`B:${listed[0].data!.slice(2)}`);
  });

  it("runs the planning wizard, estimate, flights and package screens", async () => {
    await planThanjavur(9003);
    const text = allText();
    expect(text).toContain("Where are you flying from?");
    expect(text).toContain("How many days?");
    expect(text).toMatch(/Low ₹[\d,]+ · <b>Typical ₹[\d,]+<\/b> · High ₹[\d,]+/);
    expect(text).toContain("catalogue fares");
    expect(text).toContain("Step 1 of 5 · Flight");
    expect(text).toContain("Pick your flight");
    // After the flight the bot walks the traveller step by step: stay → extras → guide → review.
    expect(last().text).toContain("Step 2 of 5 · Stay");
    expect(last().buttons.map(button => button.data)).toEqual(expect.arrayContaining(["H:0", "W:extras"]));
    await tap(9003, "H:0");
    expect(last().text).toMatch(/Updated — total now <b>₹[\d,]+<\/b>[\s\S]*Step 2 of 5/);
    await tap(9003, "W:extras");
    expect(last().text).toContain("Step 3 of 5 · Extras");
    expect(last().buttons.at(-1)?.data).toBe("W:guide");
    await tap(9003, "W:guide");
    expect(last().text).toContain("Step 4 of 5 · Local guide");
    const arjun = trips.listGuides(tripOf(9003)!).findIndex(guide => guide.name === "Arjun Nair");
    await tap(9003, `GS:${arjun}`);
    expect(last().text).toContain("Arjun Nair booked for 3 days");
    expect(last().text).toContain("Guide on your plan: <b>Arjun Nair</b>");
    await tap(9003, "W:review");
    expect(last().text).toContain("Step 5 of 5 · Review");
    expect(last().text).toMatch(/Total: <b>₹[\d,]+<\/b>/);
    expect(last().buttons.map(button => button.data)).toEqual(["K", "BK"]); // no agent chat → book straight away
    await tap(9003, "BK");
    expect(last().buttons.map(button => button.data)).toEqual(expect.arrayContaining(["H:list", "GX", "ND:list", "R"]));
    expect(trips.getTrip(tripOf(9003)!).status).toBe("select_package");
  });

  it("refuses an unavailable guide, names the date, offers a same-language substitute and reprices", async () => {
    await planThanjavur(9004);
    await tap(9004, "GD");
    const guides = trips.listGuides(tripOf(9004)!);
    const meera = guides.findIndex(guide => guide.name === "Meera Novak");
    expect(meera).toBeGreaterThanOrEqual(0);
    expect(last().buttons[meera].text).toContain("⚠️ Meera Novak");
    await tap(9004, `GS:${meera}`);
    expect(last().text).toContain("Meera Novak</b> can't be booked");
    expect(last().text).toContain("28 Sept");
    expect(last().text).toContain("Arjun Nair");
    expect(last().text).toMatch(/New trip total: ₹[\d,]+ → <b>₹[\d,]+<\/b>/);
    expect(trips.getTrip(tripOf(9004)!).chosenGuide).toBeNull();
    await tap(9004, "GR:0");
    expect(last().text).toContain("Arjun Nair booked for 3 days");
    const trip = trips.getTrip(tripOf(9004)!);
    expect(trip.chosenGuide?.name).toBe("Arjun Nair");
    expect(trip.chosenGuide?.languages).toContain("ta");
  });

  it("swaps the hotel, toggles an add-on and changes the days with live repricing", async () => {
    await planThanjavur(9005);
    const before = trips.getTrip(tripOf(9005)!).priceBreakdown.total;
    await tap(9005, "H:list");
    expect(last().text).toContain("Choose a stay");
    await tap(9005, "H:0");
    expect(last().text).toMatch(/Updated — total now <b>₹[\d,]+<\/b> \([+−]₹[\d,]+\)/);
    const afterHotel = trips.getTrip(tripOf(9005)!).priceBreakdown.total;
    expect(afterHotel).not.toBe(before);

    await tap(9005, "A:list");
    const addOn = last().buttons.find(button => button.data?.startsWith("A:") && button.data !== "A:list");
    expect(addOn?.text).toContain("➕");
    await tap(9005, addOn!.data!);
    expect(last().buttons.find(button => button.data === addOn!.data)?.text).toContain("✅");
    expect(trips.getTrip(tripOf(9005)!).priceBreakdown.addOns).toBeGreaterThan(0);

    await tap(9005, "ND:2");
    expect(last().text).toContain("2 days");
    expect(trips.getTrip(tripOf(9005)!).durationDays).toBe(2);
  });

  it("negotiates when a change breaks the budget, then books with a PNR", async () => {
    await say(9006, "/start");
    await tap(9006, "L:en-IN");
    await tap(9006, `B:${thanjavur.id}`);
    await tap(9006, "O:DEL");
    await tap(9006, "D:2026-09-28");
    await tap(9006, "N:3");
    await tap(9006, "V:4");
    await tap(9006, "G:x");
    expect(last().text).toContain("Type your budget in rupees");
    await say(9006, "1 lakh");
    expect(last().text).toContain("Which language should your guide speak?");
    await tap(9006, "GL:ta");
    await tap(9006, "E:go");
    await tap(9006, "F:0");
    await tap(9006, "GD");
    const pricey = trips.listGuides(tripOf(9006)!).findIndex(guide => guide.isAvailableForTrip);
    await tap(9006, `GS:${pricey}`);
    if (trips.getTrip(tripOf(9006)!).status === "negotiate") {
      expect(last().text).toContain("goes over your budget");
      expect(last().buttons.map(button => button.data)).toEqual(expect.arrayContaining(["NG:approve_overage", "NG:raise_cap"]));
      await tap(9006, "NG:raise_cap");
      await say(9006, "200000");
    }
    expect(trips.getTrip(tripOf(9006)!).status).toBe("select_package");
    await tap(9006, "R");
    expect(last().text).toContain("Review your trip");
    await tap(9006, "K");
    expect(last().text).toMatch(/Booked!.*PNR is <b>[A-Z0-9]{6}<\/b>/s);
    expect(trips.getTrip(tripOf(9006)!).status).toBe("confirmed");
  });

  it("understands free text: interests get package picks, trip requests pre-fill the planner", async () => {
    await say(9007, "/start");
    await tap(9007, "L:en-IN");
    await say(9007, "I love beaches and a relaxed honeymoon under 40k");
    const picks = last().buttons.filter(button => button.data?.startsWith("S:"));
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) expect(PACKAGES.find(pkg => pkg.id === pick.data!.slice(2))!.basePrice).toBeLessThanOrEqual(40000);

    sent = [];
    await say(9007, "Mumbai to Goa for 3 days");
    expect(allText()).toContain("Mumbai → Panaji · 3 days");
    expect(allText()).toContain("Pick your departure date");
  });

  it("rejects bad input politely and recovers from stale buttons", async () => {
    await say(9008, "/start");
    await tap(9008, "L:en-IN");
    await tap(9008, `B:${thanjavur.id}`);
    await tap(9008, "O:DEL");
    await tap(9008, "D:2026-09-01");
    expect(last().text).toContain("Please pick today or a later date");
    await tap(9008, "D:2026-09-28");
    await tap(9008, "N:3");
    await tap(9008, "V:4");
    await tap(9008, "G:x");
    await say(9008, "lots");
    expect(last().text).toContain("Please type an amount in rupees");
    await tap(9008, "F:99");
    expect(last().text).toContain("You don't have a trip yet");
    expect(allText()).not.toMatch(/sqlite|undefined/i);
  });

  it("keeps every message within Telegram limits and valid HTML", async () => {
    for (const lang of ["hi", "ta", "te"]) {
      await say(9100, "/start");
      await tap(9100, `L:${lang}`);
      await tap(9100, "M:browse");
      await tap(9100, `B:${thanjavur.id}`);
      await tap(9100, "O:DEL");
      await tap(9100, "D:2026-09-28");
      await tap(9100, "N:3");
      await tap(9100, "V:4");
      await tap(9100, "G:150000");
      await tap(9100, "GL:ta");
      await tap(9100, "E:go");
      await tap(9100, "F:0");
      await tap(9100, "GD");
      const meera = trips.listGuides(tripOf(9100)!).findIndex(guide => guide.name === "Meera Novak");
      await tap(9100, `GS:${meera}`);
      expect(last().text).not.toContain("can't be booked");
    }
    for (const message of sent) {
      expect(message.text.length).toBeLessThanOrEqual(message.method === "sendPhoto" ? 1024 : 4096);
      expect((message.text.match(/<b>/g) ?? []).length).toBe((message.text.match(/<\/b>/g) ?? []).length);
      expect(message.text).not.toMatch(/\{\w+\}/);
      for (const button of message.buttons) {
        expect(button.text.length).toBeGreaterThan(0);
        if (button.data) expect(new TextEncoder().encode(button.data).length).toBeLessThanOrEqual(64);
      }
    }
    expect(buttonData().length).toBeGreaterThan(50);
  });

  it("runs the one-tap demo and shows each guide's date strip on refusal", async () => {
    await say(9200, "/start");
    await tap(9200, "L:en-IN");
    await tap(9200, "M:demo");
    expect(allText()).toContain("Demo trip");
    expect(allText()).toMatch(/Low ₹[\d,]+/);
    await tap(9200, "E:go");
    await tap(9200, "F:0");
    await tap(9200, "GD");
    const meera = trips.listGuides(tripOf(9200)!).findIndex(guide => guide.name === "Meera Novak");
    await tap(9200, `GS:${meera}`);
    expect(last().text).toMatch(/Meera Novak\s*<\/code> 28 ❌ · 29 ✅ · 30 ✅/);
    expect(last().text).toMatch(/Arjun Nair\s*<\/code> 28 ✅ · 29 ✅ · 30 ✅/);
  });

  it("prices a party: flight buttons show the party total and hotel deltas are per room", async () => {
    await say(9201, "/start");
    await tap(9201, "L:en-IN");
    await tap(9201, `B:${thanjavur.id}`);
    for (const data of ["O:DEL", "D:2026-09-28", "N:3", "V:6", "G:300000", "GL:ta", "E:go"]) await tap(9201, data);
    expect(last().buttons[0].text).toMatch(/₹[\d,]+ \(6×₹[\d,]+\)/);
    await tap(9201, "F:0");
    const trip = trips.getTrip(tripOf(9201)!);
    expect(trip.priceBreakdown.party).toEqual({ pax: 6, rooms: 3, vehicles: 2 });
    await tap(9201, "H:list");
    const current = trip.packageComponents.find(item => item.type === "hotel")!;
    const first = PACKAGES.find(pkg => pkg.id === trip.package!.id)!.components.filter(item => item.swapGroup === current.swapGroup && item.id !== current.id)[0];
    const delta = Math.round((first.price - current.price) * 3 * trip.priceBreakdown.nightsFactor);
    expect(last().buttons[1].text).toContain(`₹${Math.abs(delta).toLocaleString("en-IN")}`);
  });
});

describe("telegram bot boundary rules", () => {
  it("offers only party sizes the package accepts", async () => {
    await say(9300, "/start");
    await tap(9300, "L:en-IN");
    await tap(9300, `B:${thanjavur.id}`);
    for (const data of ["O:DEL", "D:2026-09-28", "N:3"]) await tap(9300, data);
    expect(last().buttons.map(button => button.data)).toEqual(["V:4", "V:5", "V:6", "V:7", "V:8"]);
  });
});

describe("telegram bot day-by-day guides", () => {
  it("books a refused guide on their free days only, then offers a guide for the remaining day", async () => {
    await say(9400, "/start");
    await tap(9400, "L:en-IN");
    await tap(9400, "M:demo");
    await tap(9400, "E:go");
    await tap(9400, "F:0");
    await tap(9400, "GD");
    const meera = trips.listGuides(tripOf(9400)!).findIndex(guide => guide.name === "Meera Novak");
    await tap(9400, `GS:${meera}`);
    const freeOnly = last().buttons.find(button => button.data === "GF");
    expect(freeOnly?.text).toContain("Book Meera Novak only on 29 Sept, 30 Sept");
    sent = [];
    await tap(9400, "GF");
    expect(allText()).toContain("Meera Novak booked on 29 Sept, 30 Sept");
    expect(last().text).toContain("Add a guide for 28 Sept");
    expect(last().buttons[0].text).toContain("Arjun Nair · 28 Sept");
    await tap(9400, "GU:0");
    const plan = trips.getTrip(tripOf(9400)!).guidePlan.map(day => day.guideName);
    expect(plan).toEqual(["Arjun Nair", "Meera Novak", "Meera Novak"]);
  });
});

describe("telegram bot: booking through a travel agent", () => {
  const AGENT = 9900;
  const pdfRequests: string[] = [];
  beforeAll(() => {
    process.env.AGENT_TELEGRAM_CHAT_ID = String(AGENT);
    setPdfRendererForTests(async (tripId, kind, lang) => { pdfRequests.push(`${kind}:${lang}`); return new TextEncoder().encode(`%PDF-1.4 ${tripId}`); });
  });
  afterAll(() => { delete process.env.AGENT_TELEGRAM_CHAT_ID; setPdfRendererForTests(null); });
  beforeEach(() => { pdfRequests.length = 0; });

  async function reviewInTamil(chatId: number) {
    await say(chatId, "/start");
    await tap(chatId, "L:ta");
    await tap(chatId, `B:${thanjavur.id}`);
    for (const data of ["O:DEL", "D:2026-09-28", "N:3", "V:4", "G:150000", "GL:ta", "E:go", "F:0", "W:review"]) await tap(chatId, data);
  }
  const documents = (chatId: number) => sent.filter(message => message.method === "sendDocument" && message.chatId === String(chatId));

  it("sends the quotation PDF at review, asks the agent, and on approval sends the bill PDF", async () => {
    await reviewInTamil(9901);
    expect(last().method).toBe("sendDocument");
    expect(pdfRequests).toContain("quote:ta");
    expect(sent.some(message => message.buttons.some(button => button.data === "Q"))).toBe(true);
    await tap(9901, "Q");
    const tripId = tripOf(9901)!;
    expect(trips.getTrip(tripId).status).toBe("awaiting_approval");
    const toAgent = sent.find(message => message.chatId === String(AGENT) && message.method === "sendMessage")!;
    expect(toAgent.text).toContain("New booking request");
    expect(toAgent.buttons.map(button => button.data)).toEqual([`AP:${tripId}`, `AR:${tripId}`]);
    expect(documents(AGENT)).toHaveLength(1); // the agent gets the quotation in English
    expect(pdfRequests).toContain("quote:en-IN");
    // The traveller can't approve their own booking, and asking again only says it's still waiting.
    await tap(9901, `AP:${tripId}`);
    expect(trips.getTrip(tripId).status).toBe("awaiting_approval");
    await tap(9901, "Q");
    expect(last().chatId).toBe("9901");
    expect(trips.getTrip(tripId).status).toBe("awaiting_approval");

    sent = [];
    await handleUpdate({ update_id: updateId++, callback_query: { id: "cb-agent", data: `AP:${tripId}`, from: { first_name: "Priya" }, message: { message_id: 7, chat: { id: AGENT } } } });
    const trip = trips.getTrip(tripId);
    expect(trip.status).toBe("confirmed");
    expect(trip.approval).toMatchObject({ decision: "approved", decidedBy: "Priya (travel agent)" });
    expect(sent.find(message => message.chatId === String(AGENT))?.buttons[0].text).toContain("Approved by Priya");
    const toTraveller = sent.filter(message => message.chatId === "9901");
    expect(toTraveller[0].text).toContain(trip.booking!.reference);
    expect(documents(9901)).toHaveLength(1);
    expect(pdfRequests).toContain("bill:ta");
    // A second tap changes nothing.
    await tap(AGENT, `AP:${tripId}`);
    expect(last().text).toContain("already approved");
  });

  it("on rejection tells the traveller why (in their language) and lets them ask again", async () => {
    await reviewInTamil(9902);
    await tap(9902, "Q");
    const tripId = tripOf(9902)!;
    await tap(AGENT, `AR:${tripId}`);
    expect(last().method).toBe("editMessageReplyMarkup");
    await tap(AGENT, `RJ:${tripId}:0`);
    expect(trips.getTrip(tripId)).toMatchObject({ status: "review", booking: null });
    const told = sent.filter(message => message.chatId === "9902").at(-1)!;
    expect(told.buttons.map(button => button.data)).toEqual([`Q:${tripId}`, `BK:${tripId}`]);
    await tap(9902, `Q:${tripId}`);
    expect(trips.getTrip(tripId)).toMatchObject({ status: "awaiting_approval", approval: { attempt: 2 } });
  });
});
