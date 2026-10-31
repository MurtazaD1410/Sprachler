export interface Cue {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

export interface StoredSubs {
  /** The file's name, shown in the popup. */
  name: string;
  cues: Cue[];
  /** Seconds added to every cue's time: positive shows the subtitles later. */
  offset: number;
  /** Identifies this import, so a changed offset can be told apart from a newly loaded file. */
  savedAt: number;
}

const PREFIX = "subs:";
const MAX_STORED_SETS = 30;

// ---- parsing ----

// "00:01:02,500" (SRT), "00:01:02.500" or "01:02.500" (VTT, hours optional)
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toSeconds(m: RegExpMatchArray): number {
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  return h * 3600 + min * 60 + sec + Number(m[4].padEnd(3, "0")) / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Subtitle markup and non-speech annotations out, leaving only what is said. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "") // <i>, <font ...>
    .replace(/\{\\[^}]*\}/g, "") // {\an8}
    .replace(/&(#\d+|[a-z]+);/gi, (m, code: string) =>
      code[0] === "#" ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? m),
    )
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, "") // [Musik], (lacht), music notes
    .replace(/(^|\s)[-–—]+\s+/g, "$1") // dialogue dashes ("- Hallo. - Hi."), which are not words
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads SRT or WebVTT. Cues that are only sound descriptions come out empty and are dropped. */
export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue; // WEBVTT header, NOTE blocks, stray numbers
    const [from, to] = lines[at].split("-->");
    const start = from.trim().match(TIME);
    const end = to.trim().match(TIME); // anything after the time (VTT cue settings) is ignored
    if (!start || !end) continue;
    const body = cleanText(lines.slice(at + 1).join(" "));
    if (body) cues.push({ start: toSeconds(start), end: toSeconds(end), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Many German subtitle files are Windows-1252, not UTF-8: decode accordingly so umlauts survive. */
export function decodeSubtitleFile(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** What should be on screen at time `t`. Cues can overlap, so the few latest ones are checked. */
export function activeText(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1; // the latest cue that has started
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const showing: string[] = [];
  for (let i = last; i >= 0 && i > last - 4; i--) if (cues[i].end > t) showing.unshift(cues[i].text);
  return showing.join(" ");
}

// ---- storage: one entry per video page ----

/** The same video should map to the same key however the URL is decorated (tracking params, timestamps). */
export function pageKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.has("v")) {
    return `${url.origin}/watch?v=${url.searchParams.get("v")}`;
  }
  return url.origin + url.pathname;
}

export const subsKey = (url: string) => PREFIX + pageKey(url);

export async function getSubs(url: string): Promise<StoredSubs | undefined> {
  const key = subsKey(url);
  return (await chrome.storage.local.get(key))[key] as StoredSubs | undefined;
}

export async function saveSubs(url: string, subs: StoredSubs) {
  await chrome.storage.local.set({ [subsKey(url)]: subs });
  // Keep only the most recent imports, so old episodes do not pile up forever.
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .sort(([, a], [, b]) => (b as StoredSubs).savedAt - (a as StoredSubs).savedAt)
    .slice(MAX_STORED_SETS)
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}

export const removeSubs = (url: string) => chrome.storage.local.remove(subsKey(url));
