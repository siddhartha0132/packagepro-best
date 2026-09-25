// Voice in India's languages, on Sarvam:
//  - hear(): one clip → the words as spoken (saarika, native script) and their English meaning (saaras speech-to-text-translate),
//    plus the language detected. The English meaning feeds the existing trip parser; the detected language picks the reply language.
//  - speak(): text → an MP3 voice reply (bulbul:v3), which Telegram plays as a voice note and browsers play directly.
// Both return null without a key or on any failure, so voice is always an extra, never a dependency.

export type Heard = { native: string; english: string; language: string };
type VoiceBackend = {
  hear(audio: Uint8Array, mime: string): Promise<Heard | null>;
  speak(text: string, language: string): Promise<Uint8Array | null>;
};

const SARVAM = "https://api.sarvam.ai";
/** Sarvam's synchronous speech APIs take short clips; longer notes are refused politely before any call. */
export const MAX_VOICE_SECONDS = 30;

// Sarvam language codes ↔ the app's language tags (the app speaks en-IN, hi, ta, te; the others are heard and answered in English).
const TO_APP: Record<string, string> = { "en-IN": "en-IN", "hi-IN": "hi", "ta-IN": "ta", "te-IN": "te", "kn-IN": "kn", "ml-IN": "ml", "mr-IN": "mr", "gu-IN": "gu", "bn-IN": "bn", "pa-IN": "pa", "od-IN": "or" };
const TO_SARVAM: Record<string, string> = Object.fromEntries(Object.entries(TO_APP).map(([sarvam, app]) => [app, sarvam]));

const key = () => process.env.SARVAM_API_KEY?.trim() || "";
const extension = (mime: string) => (/ogg|opus/.test(mime) ? "ogg" : /webm/.test(mime) ? "webm" : /mp4|m4a|aac/.test(mime) ? "m4a" : /mpeg|mp3/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : "ogg");

async function sarvamForm(path: string, audio: Uint8Array, mime: string, fields: Record<string, string>) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${extension(mime)}`);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const response = await fetch(`${SARVAM}${path}`, { method: "POST", headers: { "api-subscription-key": key() }, body: form, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Sarvam ${path} ${response.status}`);
  return await response.json() as { transcript?: string; language_code?: string };
}

const sarvam: VoiceBackend = {
  async hear(audio, mime) {
    if (!key() || !audio.length) return null;
    try {
      // Both calls in parallel: the native transcript is shown back to the traveller, the English meaning is what the planner parses.
      const [native, english] = await Promise.all([
        sarvamForm("/speech-to-text", audio, mime, { model: "saarika:v2.5", language_code: "unknown" }).catch(() => null),
        sarvamForm("/speech-to-text-translate", audio, mime, { model: "saaras:v2.5" }),
      ]);
      const meaning = english.transcript?.trim();
      if (!meaning) return null;
      const language = TO_APP[english.language_code ?? native?.language_code ?? ""] ?? "en-IN";
      return { native: native?.transcript?.trim() || meaning, english: meaning, language };
    } catch (error) {
      console.warn("[voice] hear failed:", (error as Error).message);
      return null;
    }
  },
  async speak(text, language) {
    const clean = text.trim();
    if (!key() || !clean) return null;
    try {
      const response = await fetch(`${SARVAM}/text-to-speech`, {
        method: "POST",
        headers: { "api-subscription-key": key(), "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean.slice(0, 1500), target_language_code: TO_SARVAM[language] ?? "en-IN", model: "bulbul:v3", output_audio_codec: "mp3" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Sarvam text-to-speech ${response.status}`);
      const body = await response.json() as { audios?: string[] };
      return body.audios?.[0] ? new Uint8Array(Buffer.from(body.audios[0], "base64")) : null;
    } catch (error) {
      console.warn("[voice] speak failed:", (error as Error).message);
      return null;
    }
  },
};

let override: VoiceBackend | null = null;
/** Tests swap in a fake so no audio ever leaves the machine. */
export function setVoiceBackendForTests(backend: VoiceBackend | null) { override = backend; }

export const voiceEnabled = () => Boolean(override) || (Boolean(key()) && !process.env.VITEST);
export const hear = (audio: Uint8Array, mime: string) => (override ?? sarvam).hear(audio, mime);
export const speak = (text: string, language: string) => (override ?? sarvam).speak(text, language);

/**
 * What to read aloud from a chat reply: plain text (no HTML, emoji or button arrows), the first few sentences only —
 * a voice reply should be a short summary, the message carries the detail.
 */
// Emoji, the emoji variation selector and layout symbols that a voice would otherwise read out literally.
const SYMBOLS = new RegExp("\\p{Extended_Pictographic}|\\uFE0F|[→←↔·•|*_#]", "gu");

export function speakable(text: string, maxChars = 360) {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(SYMBOLS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > maxChars / 3 ? cut.slice(0, end + 1) : cut).trim();
}
