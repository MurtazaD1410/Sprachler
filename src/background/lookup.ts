import type { DictEntry, Example, Gender, LookupResult, Sense } from "../shared/types";

// Per-word German Wiktionary extract (CC BY-SA) from kaikki.org: one JSONL line per part of speech.
const BASE = "https://kaikki.org/dictionary/German/meaning";
const MAX_ENTRIES = 4;
const MAX_SENSES = 5;
const MAX_EXAMPLES = 2;
const MAX_NOTES = 3;
// Longest first so "en" is tried before "e"/"n".
const SUFFIXES = ["en", "em", "er", "es", "e", "n", "s"];
const ARTICLES = { m: "der", f: "die", n: "das" } as const;

interface RawSense {
  glosses?: string[];
  form_of?: { word: string }[];
  examples?: { text?: string; english?: string; translation?: string; bold_text_offsets?: [number, number][] }[];
  tags?: string[];
}

interface RawEntry {
  word: string;
  pos: string;
  head_templates?: { expansion?: string }[];
  forms?: { form: string; tags?: string[] }[];
  sounds?: { ipa?: string; mp3_url?: string; ogg_url?: string }[];
  senses?: RawSense[];
}

const cache = new Map<string, Promise<RawEntry[]>>();

function pageUrl(word: string): string {
  const chars = [...word];
  const enc = encodeURIComponent;
  return `${BASE}/${enc(chars[0])}/${enc(chars.slice(0, 2).join(""))}/${enc(word)}.jsonl`;
}

function fetchRaw(word: string): Promise<RawEntry[]> {
  let hit = cache.get(word);
  if (!hit) {
    hit = (async () => {
      const res = await fetch(pageUrl(word));
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`Dictionary request failed (${res.status})`);
      const text = await res.text();
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RawEntry);
    })();
    cache.set(word, hit);
    hit.catch(() => cache.delete(word)); // don't cache failures
  }
  return hit;
}

/** Captions are often lowercase, but German nouns are capitalised: try both. */
function caseVariants(word: string): string[] {
  const lower = word.toLocaleLowerCase("de");
  const cap = lower.charAt(0).toLocaleUpperCase("de") + lower.slice(1);
  return [...new Set([word, lower, cap])];
}

async function fetchVariants(word: string): Promise<RawEntry[]> {
  const pages = await Promise.all(caseVariants(word).map(fetchRaw));
  return pages.flat();
}

const isFormOnly = (e: RawEntry) =>
  !!e.senses?.length && e.senses.every((s) => s.form_of?.length);

function toEntry(raw: RawEntry): DictEntry {
  const headline = raw.head_templates?.[0]?.expansion?.trim() ?? raw.word;
  let gender: Gender | undefined;
  if (raw.pos === "noun") {
    const tags = raw.senses?.flatMap((s) => s.tags ?? []) ?? [];
    if (tags.includes("masculine")) gender = "m";
    else if (tags.includes("feminine")) gender = "f";
    else if (tags.includes("neuter")) gender = "n";
    else gender = headline.match(/^\S+ ([mfn])\b/)?.[1] as Gender | undefined;
  }
  const plural = raw.pos === "noun" ? raw.forms?.find((f) => f.tags?.includes("plural"))?.form : undefined;
  const audio = raw.sounds?.find((s) => s.mp3_url || s.ogg_url);

  const senses: Sense[] = (raw.senses ?? [])
    .filter((s) => s.glosses?.length)
    .slice(0, MAX_SENSES)
    .map((s) => {
      const examples: Example[] = (s.examples ?? [])
        .map((x) => ({ de: x.text ?? "", en: x.english ?? x.translation ?? "", hl: x.bold_text_offsets?.[0] }))
        .filter((x) => x.de)
        .sort((a, b) => Number(!!b.en) - Number(!!a.en))
        .slice(0, MAX_EXAMPLES);
      return { glosses: s.glosses!.join(" › "), examples };
    });

  return {
    word: raw.word,
    pos: raw.pos,
    headline,
    gender,
    article: gender ? ARTICLES[gender] : undefined,
    plural,
    ipa: raw.sounds?.find((s) => s.ipa)?.ipa,
    audioUrl: audio?.mp3_url ?? audio?.ogg_url,
    senses,
  };
}

/** Last resort for inflected adjective/noun forms that have no page of their own ("schönen" -> "schön"). */
async function guessStem(word: string): Promise<{ stem: string; entries: RawEntry[] } | null> {
  for (const suffix of SUFFIXES) {
    if (!word.toLowerCase().endsWith(suffix) || word.length - suffix.length < 3) continue;
    const stem = word.slice(0, -suffix.length);
    const entries = (await fetchVariants(stem)).filter((e) => !isFormOnly(e));
    if (entries.length) return { stem, entries };
  }
  return null;
}

export async function lookup(clicked: string): Promise<LookupResult> {
  const word = clicked.replace(/^[-'’]+|[-'’]+$/g, "").replace(/’/g, "'");
  if (!word) throw new Error("No word to look up");

  const notes: string[] = [];
  let found = await fetchVariants(word);

  if (!found.length) {
    const guess = await guessStem(word);
    if (!guess) throw new Error(`"${word}" was not found in the dictionary.`);
    notes.push(`"${word}" has no entry of its own. Showing "${guess.stem}".`);
    found = guess.entries;
  }

  const direct = found.filter((e) => !isFormOnly(e));
  const lemmas = new Set<string>();
  for (const e of found.filter(isFormOnly)) {
    for (const s of e.senses ?? []) {
      const lemma = s.form_of?.[0]?.word;
      if (!lemma) continue;
      lemmas.add(lemma);
      notes.push(`${e.word}: ${s.glosses?.[0] ?? `form of ${lemma}`}`);
    }
  }

  const lemmaEntries = (await Promise.all([...lemmas].map(fetchRaw))).flat().filter((e) => !isFormOnly(e));

  const seen = new Set<string>();
  const candidates = [...direct, ...lemmaEntries];
  // Proper nouns ("name") are rarely what a learner wants, so only keep them when nothing else matched.
  const common = candidates.filter((e) => e.pos !== "name");
  const entries = (common.length ? common : candidates)
    .filter((e) => {
      const key = `${e.word}|${e.pos}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ENTRIES)
    .map(toEntry);

  if (!entries.length) throw new Error(`No definition found for "${word}".`);

  return {
    word,
    lemma: [...lemmas][0] ?? entries[0].word,
    notes: [...new Set(notes)].slice(0, MAX_NOTES),
    entries,
  };
}
