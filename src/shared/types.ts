export interface Example {
  de: string;
  en: string;
  /** [start, end) of the headword inside `de`, as marked in Wiktionary. */
  hl?: [number, number];
}

export interface Sense {
  glosses: string;
  examples: Example[];
}

export type Gender = "m" | "f" | "n";

export interface DictEntry {
  word: string;
  pos: string;
  /** Wiktionary head line, e.g. "Haus n (strong, genitive Hauses, plural Häuser)". */
  headline: string;
  gender?: Gender;
  article?: "der" | "die" | "das";
  plural?: string;
  ipa?: string;
  audioUrl?: string;
  senses: Sense[];
}

export interface LookupResult {
  /** The word as clicked. */
  word: string;
  /** Dictionary form(s) the entries belong to. */
  lemma: string;
  /** Short explanations such as "gegangen: past participle of gehen". */
  notes: string[];
  entries: DictEntry[];
}

export type Engine = "on-device" | "google" | "mymemory";

export interface Translation {
  text: string;
  engine: Engine;
}

export type Message =
  | { type: "lookup"; word: string }
  | { type: "translate"; text: string }
  /** The URL of the tab the sender lives in: a video inside an iframe still belongs to the tab's address. */
  | { type: "tabUrl" };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
