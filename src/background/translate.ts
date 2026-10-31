import { addUsage, markExhausted } from "../shared/usage";
import type { Translation } from "../shared/types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** After Google fails (captcha, rate limit) leave it alone for a while instead of hammering it. */
const GOOGLE_BACKOFF_MS = 10 * 60 * 1000;

let googleBlockedUntil = 0;

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Google's free web endpoint. Unofficial and undocumented: it can answer with a captcha page at any time. */
async function google(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Google returned a non-JSON page (probably a captcha)");
  }
  const segments = (json as [[string, ...unknown[]][]])[0];
  const out = segments?.map((s) => s[0]).join("").trim();
  if (!out) throw new Error("Google returned no translation");
  return out;
}

/** MyMemory: free, no key, but only ~5000 characters per day without registration. */
async function myMemory(text: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=de|en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation request failed (${res.status})`);
  const json = await res.json();
  if (json.quotaFinished || Number(json.responseStatus) === 429) {
    await markExhausted();
    throw new Error("Daily translation limit reached");
  }
  if (Number(json.responseStatus) !== 200) {
    throw new Error(json.responseDetails || "Translation failed");
  }
  await addUsage(text.length);
  return decodeEntities(String(json.responseData.translatedText)).trim();
}

// ---- on-device: Chrome's Translator, run in a hidden extension page (see src/offscreen) ----

const ON_DEVICE_RETRY_MS = 15_000;
let onDeviceBlockedUntil = 0;
let creatingOffscreen: Promise<void> | undefined;
let lastDiag = "";

/** Shown in the popup, so a failing on-device path is visible without opening the console. */
function setDiag(message: string) {
  if (message === lastDiag) return;
  lastDiag = message;
  void chrome.storage.local.set({ onDeviceDiag: message });
}

async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (open.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: "src/offscreen/index.html",
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Runs Chrome's on-device Translator API, which needs a document, to translate captions.",
    })
    .finally(() => (creatingOffscreen = undefined));
  await creatingOffscreen;
}

async function askOffscreen(text: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  await ensureOffscreen();
  const send = () => chrome.runtime.sendMessage({ target: "offscreen", kind: "translate", text });
  try {
    return await send();
  } catch {
    await new Promise((r) => setTimeout(r, 250)); // the page may not have registered its listener yet
    return await send();
  }
}

async function onDevice(text: string): Promise<string> {
  const reply = await askOffscreen(text);
  if (!reply?.ok || reply.text === undefined) throw new Error(reply?.error ?? "no answer from the translator page");
  return reply.text;
}

/** On-device first (free, offline, fastest), then Google, then MyMemory. */
export async function translate(text: string): Promise<Translation> {
  if (Date.now() >= onDeviceBlockedUntil) {
    try {
      const result = await onDevice(text);
      setDiag("Working.");
      return { text: result, engine: "on-device" };
    } catch (err) {
      onDeviceBlockedUntil = Date.now() + ON_DEVICE_RETRY_MS;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn("[lingopie-de] on-device translation unavailable:", reason);
      setDiag(`Not usable: ${reason}`);
    }
  }
  if (Date.now() >= googleBlockedUntil) {
    try {
      return { text: await google(text), engine: "google" };
    } catch (err) {
      googleBlockedUntil = Date.now() + GOOGLE_BACKOFF_MS;
      console.warn("[lingopie-de] Google translate failed, using MyMemory for a while:", err);
    }
  }
  return { text: await myMemory(text), engine: "mymemory" };
}
