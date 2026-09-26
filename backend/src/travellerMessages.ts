import { publicBase } from "./agentDesk";
import { sendMessage, translateMany } from "./integrations";
import * as trips from "./trips";

// Website travellers have no chat: when they ask the travel agent, and whenever the agent answers, they get a short SMS
// and/or email in their language with a private link straight back to their trip (where they accept a counter-offer).
// Telegram travellers get the same news in their chat (telegramBot.ts), so they are skipped here.

type Event = "received" | "counter" | "approved" | "rejected";
type Lang = "en-IN" | "hi" | "ta" | "te";

const COPY: Record<Lang, Record<Event, [subject: string, text: string]>> = {
  "en-IN": {
    received: ["We've received your booking request {ref}", "PackagePro: your {city} trip request {ref} ({total}) is with our travel agent. We'll message you as soon as they answer. Your trip: {link}"],
    counter: ["Our travel agent suggests a change to {ref}", "PackagePro: our travel agent suggests a change to your {city} trip {ref} — new total {total} (was {old}). Accept it or keep your original request here: {link}"],
    approved: ["Booking {ref} is confirmed", "PackagePro: your {city} trip {ref} is confirmed. Amount payable {total}. Your trip and bill: {link}"],
    rejected: ["Booking request {ref} couldn't be approved", "PackagePro: our travel agent couldn't approve {ref}: {reason}. Change the trip or send it again: {link}"],
  },
  hi: {
    received: ["आपका बुकिंग अनुरोध {ref} मिल गया है", "PackagePro: आपकी {city} यात्रा का अनुरोध {ref} ({total}) हमारे ट्रैवल एजेंट के पास है। जवाब आते ही हम आपको संदेश भेजेंगे। आपकी यात्रा: {link}"],
    counter: ["ट्रैवल एजेंट ने {ref} में बदलाव सुझाया है", "PackagePro: हमारे ट्रैवल एजेंट ने आपकी {city} यात्रा {ref} में बदलाव सुझाया है — नया कुल {total} (पहले {old})। यहाँ स्वीकार करें या अपना मूल अनुरोध रखें: {link}"],
    approved: ["बुकिंग {ref} पक्की हो गई", "PackagePro: आपकी {city} यात्रा {ref} पक्की हो गई। देय राशि {total}। आपकी यात्रा और बिल: {link}"],
    rejected: ["बुकिंग अनुरोध {ref} स्वीकृत नहीं हुआ", "PackagePro: हमारे ट्रैवल एजेंट {ref} स्वीकृत नहीं कर सके: {reason}। यात्रा बदलें या फिर से भेजें: {link}"],
  },
  ta: {
    received: ["உங்கள் முன்பதிவுக் கோரிக்கை {ref} கிடைத்தது", "PackagePro: உங்கள் {city} பயணக் கோரிக்கை {ref} ({total}) எங்கள் பயண முகவரிடம் உள்ளது. பதில் வந்ததும் உங்களுக்குச் செய்தி அனுப்புவோம். உங்கள் பயணம்: {link}"],
    counter: ["பயண முகவர் {ref}-இல் மாற்றம் பரிந்துரைக்கிறார்", "PackagePro: உங்கள் {city} பயணம் {ref}-இல் எங்கள் பயண முகவர் ஒரு மாற்றத்தைப் பரிந்துரைக்கிறார் — புதிய மொத்தம் {total} (முன்பு {old}). ஏற்க அல்லது முதல் கோரிக்கையை வைக்க: {link}"],
    approved: ["முன்பதிவு {ref} உறுதியானது", "PackagePro: உங்கள் {city} பயணம் {ref} உறுதியானது. செலுத்த வேண்டியது {total}. உங்கள் பயணமும் பில்லும்: {link}"],
    rejected: ["முன்பதிவுக் கோரிக்கை {ref} ஏற்கப்படவில்லை", "PackagePro: எங்கள் பயண முகவரால் {ref}-ஐ ஒப்புக்கொள்ள முடியவில்லை: {reason}. பயணத்தை மாற்றுங்கள் அல்லது மீண்டும் அனுப்புங்கள்: {link}"],
  },
  te: {
    received: ["మీ బుకింగ్ అభ్యర్థన {ref} అందింది", "PackagePro: మీ {city} యాత్ర అభ్యర్థన {ref} ({total}) మా ట్రావెల్ ఏజెంట్ వద్ద ఉంది. సమాధానం రాగానే మీకు సందేశం పంపుతాం. మీ యాత్ర: {link}"],
    counter: ["ట్రావెల్ ఏజెంట్ {ref}లో మార్పు సూచిస్తున్నారు", "PackagePro: మీ {city} యాత్ర {ref}లో మా ట్రావెల్ ఏజెంట్ ఒక మార్పు సూచిస్తున్నారు — కొత్త మొత్తం {total} (ఇంతకు ముందు {old}). అంగీకరించండి లేదా మొదటి అభ్యర్థనే ఉంచండి: {link}"],
    approved: ["బుకింగ్ {ref} నిర్ధారించబడింది", "PackagePro: మీ {city} యాత్ర {ref} నిర్ధారించబడింది. చెల్లించవలసినది {total}. మీ యాత్ర మరియు బిల్లు: {link}"],
    rejected: ["బుకింగ్ అభ్యర్థన {ref} ఆమోదం పొందలేదు", "PackagePro: మా ట్రావెల్ ఏజెంట్ {ref}ను ఆమోదించలేకపోయారు: {reason}. యాత్రను మార్చండి లేదా మళ్లీ పంపండి: {link}"],
  },
};

const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");

/** The private link back to a trip (the trip id is the key, as with share links). */
export const tripLink = (tripId: string) => `${publicBase() || `http://localhost:${process.env.PORT || 3000}`}/#trip=${tripId}`;

/** Which news a trip's request state is: a fresh request, an open counter-offer, an approval or a rejection. */
function eventOf(trip: ReturnType<typeof trips.getTrip>): Event | null {
  if (trip.status === "confirmed" && trip.approval?.decision === "approved") return "approved";
  if (trip.status === "review" && trip.approval?.decision === "rejected") return "rejected";
  if (trip.status === "awaiting_approval") return trip.approval?.counter?.status === "open" ? "counter" : "received";
  return null;
}

/** Message a website traveller about their request; returns what was sent (nothing without contact or email/SMS keys). */
export async function notifyWebTraveller(tripId: string) {
  const trip = trips.getTrip(tripId);
  const contact = trip.approval?.contact;
  const event = eventOf(trip);
  if (!event || !contact || trip.approval?.chatId) return { email: false, sms: false };
  const lang = (["en-IN", "hi", "ta", "te"].includes(trip.approval?.lang ?? "") ? trip.approval!.lang : "en-IN") as Lang;
  const reason = trip.approval?.reason ?? "";
  const [city, localReason] = lang === "en-IN" ? [trip.destination, reason] : await translateMany([trip.destination, reason].filter(Boolean), lang).then(map => [map[trip.destination] || trip.destination, map[reason] || reason]).catch(() => [trip.destination, reason]);
  const counter = trip.approval?.counter;
  const vars = {
    ref: trip.booking?.reference ?? trip.tripId, city, link: tripLink(trip.tripId), reason: localReason,
    total: money(event === "counter" && counter ? counter.newTotal : trip.runningTotal), old: money(counter?.oldTotal ?? trip.runningTotal),
  };
  const [subject, text] = COPY[lang][event];
  return sendMessage({ email: contact.email, phone: contact.phone, subject: fill(subject, vars), text: fill(text, vars) }).catch(() => ({ email: false, sms: false }));
}

/** Indian mobile numbers to E.164 (+91…); other + numbers kept; anything else rejected. */
export function normalisePhone(value: string) {
  const digits = value.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^\+?91[6-9]\d{9}$/.test(digits)) return `+${digits.replace(/^\+/, "")}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}
