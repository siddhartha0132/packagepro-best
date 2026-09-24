import { useCallback, useSyncExternalStore } from "react";

// Live content translation (package names, itinerary titles, cities, AI text) via the server's Sarvam endpoint.
// `tr(text)` returns the cached translation or the original, and queues misses; translations stream in as batches land.

type Cache = Record<string, Record<string, string>>;
const STORAGE_KEY = "packagepro-translations-v1";
const BATCH = 40;

const cache: Cache = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Cache; } catch { return {}; }
})();
const pending: Record<string, Set<string>> = {};
const inFlight: Record<string, Set<string>> = {};
const failedAt: Record<string, Map<string, number>> = {};
const active: Record<string, number> = {};
const MAX_PARALLEL = 3;
const RETRY_MS = 15000;
const listeners = new Set<() => void>();
let version = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const scheduled = new Set<string>();

function notify() {
  version++;
  listeners.forEach(listener => listener());
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ } }, 800);
}

async function flush(lang: string) {
  scheduled.delete(lang);
  const queue = pending[lang];
  if (!queue?.size) return;
  const texts = Array.from(queue).slice(0, BATCH);
  texts.forEach(text => { queue.delete(text); (inFlight[lang] ??= new Set()).add(text); });
  active[lang] = (active[lang] ?? 0) + 1;
  if (queue.size && active[lang] < MAX_PARALLEL) schedule(lang);
  try {
    const res = await fetch("/api/trpc/packagepro.translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { texts, language: lang } }) });
    const body = await res.json() as { result?: { data?: { json?: Record<string, string> } } };
    const translated = body.result?.data?.json ?? {};
    const bucket = (cache[lang] ??= {});
    for (const text of texts) {
      if (translated[text] && translated[text] !== text) bucket[text] = translated[text];
      else (failedAt[lang] ??= new Map()).set(text, Date.now());
    }
    notify();
  } catch {
    texts.forEach(text => (failedAt[lang] ??= new Map()).set(text, Date.now()));
  } finally {
    texts.forEach(text => inFlight[lang]?.delete(text));
    active[lang] = Math.max(0, (active[lang] ?? 1) - 1);
    if (pending[lang]?.size) schedule(lang);
  }
}

function schedule(lang: string) {
  if (scheduled.has(lang)) return;
  scheduled.add(lang);
  setTimeout(() => void flush(lang), 60);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns `tr(text)` for the given UI language; English passes through untouched. */
export function useTr(lang: string) {
  useSyncExternalStore(subscribe, () => version);
  return useCallback((text?: string | null) => {
    if (!text) return "";
    if (lang === "en-IN" || lang === "en") return text;
    const hit = cache[lang]?.[text];
    if (hit) return hit;
    const lastFailure = failedAt[lang]?.get(text);
    if (!inFlight[lang]?.has(text) && !pending[lang]?.has(text) && (!lastFailure || Date.now() - lastFailure > RETRY_MS)) {
      (pending[lang] ??= new Set()).add(text);
      schedule(lang);
    }
    return text;
  }, [lang, version]);
}

/** Resolves once no translations are queued or in flight for `lang` (or after `timeoutMs`), so printed documents are fully translated. */
export function translationsSettled(lang: string, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise<void>(resolve => {
    const check = () => {
      const busy = (pending[lang]?.size ?? 0) + (inFlight[lang]?.size ?? 0);
      if (!busy || Date.now() - started > timeoutMs) resolve();
      else setTimeout(check, 150);
    };
    setTimeout(check, 120);
  });
}
