import { createEmptyCard, type Card } from "ts-fsrs";
import type { DictEntry, Example, Gender } from "./types";

/**
 * Where a word was met, to link back to the scene. Live captions are cut at arbitrary points, so the
 * caption text itself is deliberately not kept: review uses the dictionary's example sentence instead.
 */
export interface WordContext {
  /** The form as it appeared in the caption, e.g. "gegangen" for the lemma "gehen". */
  formSeen: string;
  url: string;
  /** Seconds into the video. */
  time: number;
  title: string;
}

/** A spaced-repetition card with its dates as ISO strings, so it survives JSON storage. */
export type StoredCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string };

export interface SavedWord {
  /** `lemma|pos`, lower-cased: one card per word and part of speech. */
  id: string;
  lemma: string;
  pos: string;
  gender?: Gender;
  article?: "der" | "die" | "das";
  plural?: string;
  ipa?: string;
  audioUrl?: string;
  meanings: string[];
  example?: Example;
  context?: WordContext;
  /** How often the word was looked up again after saving: a hint at what is hard to remember. */
  lookups: number;
  createdAt: number;
  updatedAt: number;
  /** Deleted words stay as markers so a future sync can propagate the deletion. */
  deleted?: boolean;
  card: StoredCard;
}

export interface Backup {
  version: 1;
  exportedAt: number;
  words: SavedWord[];
}

const PREFIX = "word:";
const MAX_MEANINGS = 4;

const key = (id: string) => `${PREFIX}${id}`;

export const wordId = (lemma: string, pos: string) => `${lemma.toLocaleLowerCase("de")}|${pos}`;

export function toStoredCard(card: Card): StoredCard {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

export async function getWord(id: string): Promise<SavedWord | undefined> {
  const word = (await chrome.storage.local.get(key(id)))[key(id)] as SavedWord | undefined;
  return word && !word.deleted ? word : undefined;
}

export async function listWords(): Promise<SavedWord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => v as SavedWord)
    .filter((w) => !w.deleted);
}

export const putWord = (word: SavedWord) => chrome.storage.local.set({ [key(word.id)]: word });

export async function putWords(words: SavedWord[]) {
  await chrome.storage.local.set(Object.fromEntries(words.map((w) => [key(w.id), w])));
}

/**
 * The sentence review will show: one that has a translation and a marked headword, preferring the
 * shortest that is still a real sentence, since long ones are tiring to read on a flashcard.
 */
function pickExample(entry: DictEntry): Example | undefined {
  const all = entry.senses.flatMap((s) => s.examples);
  const wordCount = (x: Example) => x.de.split(/\s+/).length;
  const ideal = all
    .filter((x) => x.en && x.hl && wordCount(x) >= 3)
    .sort((a, b) => a.de.length - b.de.length)[0];
  return ideal ?? all.find((x) => x.en && x.hl) ?? all.find((x) => x.en) ?? all[0];
}

/** Saves a dictionary entry. Saving an already-saved word keeps its review history. */
export async function saveEntry(entry: DictEntry, context?: WordContext): Promise<SavedWord> {
  const id = wordId(entry.word, entry.pos);
  const existing = await getWord(id);
  const now = Date.now();
  const word: SavedWord = {
    id,
    lemma: entry.word,
    pos: entry.pos,
    gender: entry.gender,
    article: entry.article,
    plural: entry.plural,
    ipa: entry.ipa,
    audioUrl: entry.audioUrl,
    meanings: entry.senses.slice(0, MAX_MEANINGS).map((s) => s.glosses),
    example: pickExample(entry),
    context: context ?? existing?.context,
    lookups: existing?.lookups ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    card: existing?.card ?? toStoredCard(createEmptyCard(new Date(now))),
  };
  await putWord(word);
  return word;
}

/** Marks a word deleted (keeping a tombstone) instead of erasing it. */
export async function removeWord(id: string) {
  const existing = await getWord(id);
  if (existing) await putWord({ ...existing, deleted: true, updatedAt: Date.now() });
}

export async function bumpLookup(id: string) {
  const existing = await getWord(id);
  if (existing) await putWord({ ...existing, lookups: existing.lookups + 1, updatedAt: Date.now() });
}

export const isDue = (word: SavedWord, now = Date.now()) => new Date(word.card.due).getTime() <= now;

export async function countDue(): Promise<number> {
  const now = Date.now();
  return (await listWords()).filter((w) => isDue(w, now)).length;
}
