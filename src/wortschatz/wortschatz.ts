import { fsrs, generatorParameters, State, type Grade } from "ts-fsrs";
import { h } from "../shared/dom";
import type { Example } from "../shared/types";
import { speak } from "../shared/speak";
import {
  isDue,
  listWords,
  putWord,
  putWords,
  removeWord,
  toStoredCard,
  type Backup,
  type SavedWord,
} from "../shared/wortschatz";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
const GRADES: Grade[] = [1, 2, 3, 4];
/** A card that comes due within this window is shown again in the same session. */
const SAME_SESSION_MS = 20 * 60 * 1000;
const LEARNED_AFTER_DAYS = 21;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let words: SavedWord[] = [];
let queue: SavedWord[] = [];
let current: SavedWord | undefined;
let answerShown = false;

// ---- shared helpers ----

function formatInterval(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  return `${(days / 30).toFixed(1)}mo`;
}

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * An example sentence with its headword marked. Wiktionary gives the exact position; for examples
 * without one, fall back to finding the word (as met, or its dictionary form) in the sentence.
 */
function highlighted(ex: Example, ...candidates: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const text = ex.de;
  let range = ex.hl;
  if (!range) {
    const lower = text.toLocaleLowerCase("de");
    for (const word of candidates.filter(Boolean)) {
      const at = lower.indexOf(word.toLocaleLowerCase("de"));
      if (at >= 0) {
        range = [at, at + word.length];
        break;
      }
    }
  }
  if (!range) {
    frag.append(text);
    return frag;
  }
  frag.append(text.slice(0, range[0]), h("mark", undefined, text.slice(...range)), text.slice(range[1]));
  return frag;
}

function wordTitle(w: SavedWord): HTMLElement {
  const title = h("span", w.gender ? `g-${w.gender}` : undefined);
  if (w.article) title.append(h("span", "art", w.article), " ");
  title.append(w.lemma);
  return title;
}

/** Everything about a word except how it is scheduled: used by the review back and the list details. */
function wordBody(w: SavedWord): HTMLElement[] {
  const out: HTMLElement[] = [];
  const meta = [w.pos, w.ipa, w.plural && `Pl. ${w.plural}`].filter(Boolean).join("  ·  ");
  if (meta) out.push(h("div", "sub", meta));
  out.push(h("ol", "meanings", ...w.meanings.map((m) => h("li", undefined, m))));
  if (w.example) {
    const ex = w.example;
    out.push(
      h("div", "ex", h("span", "de", highlighted(ex, w.context?.formSeen ?? "", w.lemma)), ex.en ? h("span", "en", ex.en) : ""),
    );
  }
  if (w.context) {
    const c = w.context;
    const link = h("a", undefined, `${c.title || "Video"} at ${formatTime(c.time)}`);
    link.href = c.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    out.push(h("div", "ex", h("span", "ctx-tr", "Met in: ", link)));
  }
  return out;
}

// ---- tabs ----

function showTab(name: "review" | "words") {
  for (const btn of document.querySelectorAll<HTMLElement>(".tab")) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
  $("review").hidden = name !== "review";
  $("words").hidden = name !== "words";
  void (name === "review" ? startReview() : renderWords());
}

for (const btn of document.querySelectorAll<HTMLElement>(".tab")) {
  btn.addEventListener("click", () => showTab(btn.dataset.tab as "review" | "words"));
}

async function reload() {
  words = await listWords();
  const due = words.filter((w) => isDue(w)).length;
  const dueBadge = $("due-badge");
  dueBadge.textContent = due ? String(due) : "";
  dueBadge.classList.toggle("due", due > 0);
  $("count-badge").textContent = words.length ? String(words.length) : "";
}

// ---- review ----

async function startReview() {
  await reload();
  const now = Date.now();
  queue = words
    .filter((w) => isDue(w, now))
    .sort((a, b) => new Date(a.card.due).getTime() - new Date(b.card.due).getTime());
  nextCard();
}

function showEmpty() {
  const box = $("review-empty");
  $("review-card").hidden = true;
  box.hidden = false;
  if (!words.length) {
    box.replaceChildren(
      h("strong", undefined, "No saved words yet"),
      "While watching, open a word's card and press ☆ Save. It shows up here to review.",
    );
    return;
  }
  const next = words.map((w) => new Date(w.card.due).getTime()).sort((a, b) => a - b)[0];
  box.replaceChildren(
    h("strong", undefined, "All caught up 🎉"),
    `${words.length} saved word${words.length === 1 ? "" : "s"}. Next review in ${formatInterval(next - Date.now())}.`,
  );
}

function nextCard() {
  current = queue.shift();
  answerShown = false;
  if (!current) return showEmpty();

  $("review-empty").hidden = true;
  $("review-card").hidden = false;
  $("progress").textContent = `${queue.length + 1} left`;

  const front = $("front");
  // The dictionary's example sentence: always a complete sentence, unlike a slice of live captions.
  if (current.example) {
    front.replaceChildren(
      h("div", "line", highlighted(current.example, current.context?.formSeen ?? "", current.lemma)),
      h("div", "hint", "What does the underlined word mean?"),
    );
  } else {
    front.replaceChildren(h("div", "line", current.lemma), h("div", "hint", "What does this word mean?"));
  }
  $("back").hidden = true;
  $("grades").hidden = true;
  $("show").hidden = false;
}

function showAnswer() {
  if (!current || answerShown) return;
  answerShown = true;
  const w = current;

  const say = h("button", "say", "🔊");
  say.type = "button";
  say.title = "Pronounce";
  say.addEventListener("click", () => speak(w.lemma, w.audioUrl));
  $("back").replaceChildren(h("div", "title", wordTitle(w), say), ...wordBody(w));
  $("back").hidden = false;

  // Show how far each answer would push the card out.
  const now = new Date();
  const preview = scheduler.repeat(w.card, now);
  for (const btn of document.querySelectorAll<HTMLElement>("#grades .g")) {
    const grade = Number(btn.dataset.grade) as Grade;
    btn.querySelector("small")!.textContent = formatInterval(preview[grade].card.due.getTime() - now.getTime());
  }
  $("grades").hidden = false;
  $("show").hidden = true;
}

async function grade(g: Grade) {
  if (!current || !answerShown) return;
  const now = new Date();
  const { card } = scheduler.next(current.card, now, g);
  const updated: SavedWord = { ...current, card: toStoredCard(card), updatedAt: now.getTime() };
  await putWord(updated);
  if (card.due.getTime() - now.getTime() < SAME_SESSION_MS) queue.push(updated);
  await reload();
  nextCard();
}

$("show").addEventListener("click", showAnswer);
for (const btn of document.querySelectorAll<HTMLElement>("#grades .g")) {
  btn.addEventListener("click", () => void grade(Number(btn.dataset.grade) as Grade));
}
document.addEventListener("keydown", (e) => {
  if ($("review").hidden || (e.target as HTMLElement).matches("input, select, textarea")) return;
  if (e.key === " ") {
    e.preventDefault();
    showAnswer();
  } else if (answerShown && ["1", "2", "3", "4"].includes(e.key)) {
    void grade(Number(e.key) as Grade);
  }
});

// ---- word list ----

const FILTERS: Record<string, (w: SavedWord) => boolean> = {
  all: () => true,
  due: (w) => isDue(w),
  new: (w) => w.card.state === State.New,
  learning: (w) => w.card.state === State.Learning || w.card.state === State.Relearning,
  learned: (w) => w.card.state === State.Review && w.card.scheduled_days >= LEARNED_AFTER_DAYS,
};

function statusOf(w: SavedWord): { text: string; due: boolean } {
  if (w.card.state === State.New) return { text: "New", due: true };
  const ms = new Date(w.card.due).getTime() - Date.now();
  return ms <= 0 ? { text: "Due", due: true } : { text: `in ${formatInterval(ms)}`, due: false };
}

function wordRow(w: SavedWord): HTMLElement {
  const status = statusOf(w);
  const summary = h(
    "summary",
    undefined,
    h("span", "lemma", wordTitle(w)),
    h("span", "gloss", w.meanings[0] ?? ""),
    h("span", status.due ? "status due" : "status", status.text),
  );

  const say = h("button", undefined, "🔊 Pronounce");
  say.type = "button";
  say.addEventListener("click", () => speak(w.lemma, w.audioUrl));
  const remove = h("button", "danger", "Remove");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm(`Remove "${w.lemma}" from your Wortschatz?`)) return;
    await removeWord(w.id);
    await renderWords();
  });
  const detail = h("div", "detail", ...wordBody(w));
  if (w.lookups) detail.append(h("div", "sub", `Looked up again ${w.lookups}×`));
  detail.append(h("div", "actions-row", say, remove));

  return h("li", undefined, h("details", undefined, summary, detail));
}

async function renderWords() {
  await reload();
  const query = $<HTMLInputElement>("search").value.trim().toLocaleLowerCase("de");
  const filter = FILTERS[$<HTMLSelectElement>("filter").value];
  const shown = words
    .filter(filter)
    .filter((w) => !query || `${w.lemma} ${w.meanings.join(" ")}`.toLocaleLowerCase("de").includes(query))
    .sort((a, b) => b.createdAt - a.createdAt);
  $("word-list").replaceChildren(...shown.map(wordRow));
  $("words-note").textContent = words.length
    ? `${shown.length} of ${words.length} words`
    : "Nothing saved yet. Press ☆ Save on a word card while watching.";
}

$("search").addEventListener("input", () => void renderWords());
$("filter").addEventListener("change", () => void renderWords());

// ---- export / import ----

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

$("export-anki").addEventListener("click", () => {
  const rows = words.map((w) => {
    const front = `${w.article ? `${w.article} ` : ""}${w.lemma}`;
    const parts = [w.meanings.join("<br>")];
    if (w.example) parts.push(`<i>${w.example.de}</i>${w.example.en ? `<br>${w.example.en}` : ""}`);
    return [front, parts.join("<br><br>"), "lingopie"].map(csvCell).join(",");
  });
  download("wortschatz-anki.csv", "text/csv", rows.join("\n"));
});

$("export-json").addEventListener("click", () => {
  const backup: Backup = { version: 1, exportedAt: Date.now(), words };
  download("wortschatz-backup.json", "application/json", JSON.stringify(backup, null, 2));
});

$("import-json").addEventListener("click", () => $("import-file").click());
$<HTMLInputElement>("import-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const note = $("words-note");
  try {
    const data = JSON.parse(await file.text()) as Partial<Backup>;
    if (!Array.isArray(data.words)) throw new Error("not a Wortschatz backup");
    const stored = await chrome.storage.local.get(null);
    const toWrite = data.words.filter((w) => {
      if (!w?.id || !w.card || !w.lemma) return false;
      const mine = stored[`word:${w.id}`] as SavedWord | undefined;
      return !mine || w.updatedAt > mine.updatedAt; // the newer copy wins
    });
    await putWords(toWrite);
    await renderWords();
    note.textContent = `Imported ${toWrite.length} of ${data.words.length} words (the rest were already up to date).`;
  } catch (err) {
    note.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
  }
});

// Words saved from a video tab show up here without reloading the page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(changes).some((k) => k.startsWith("word:"))) return;
  void reload();
  if (!$("words").hidden) void renderWords();
});

void startReview();
