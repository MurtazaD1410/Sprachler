import type { DictEntry, LookupResult } from "../shared/types";
import { h } from "../shared/dom";
import { speak } from "../shared/speak";
import { bumpLookup, getWord, removeWord, saveEntry, wordId, type WordContext } from "../shared/wortschatz";

/** Where the word was met, minus the form, which the lookup result knows. */
export type SaveContext = Omit<WordContext, "formSeen">;

/** Star button that saves the entry to the Wortschatz, or removes it again. */
function saveButton(entry: DictEntry, context?: WordContext): HTMLButtonElement {
  const id = wordId(entry.word, entry.pos);
  const btn = h("button", "save", "☆ Save");
  const show = (saved: boolean) => {
    btn.textContent = saved ? "★ Saved" : "☆ Save";
    btn.classList.toggle("on", saved);
    btn.title = saved ? "Click to remove from your Wortschatz" : "Save to your Wortschatz";
  };
  void getWord(id).then((saved) => {
    show(!!saved);
    if (saved) void bumpLookup(id); // looking a saved word up again says it is not sticking yet
  });
  btn.addEventListener("click", async () => {
    if (btn.classList.contains("on")) {
      await removeWord(id);
      show(false);
    } else {
      await saveEntry(entry, context);
      show(true);
    }
  });
  return btn;
}

function renderEntry(entry: DictEntry, context?: WordContext): HTMLElement {
  const box = h("section", "entry", h("div", "entryhead", h("span", "pos", entry.pos), saveButton(entry, context)));
  if (entry.headline && entry.headline !== entry.word) box.append(h("div", "head", entry.headline));
  const list = h("ol", "senses");
  for (const sense of entry.senses) {
    const li = h("li", undefined, sense.glosses);
    for (const ex of sense.examples) {
      li.append(h("div", "ex", h("span", "de", ex.de), ex.en ? h("span", "en", ex.en) : ""));
    }
    list.append(li);
  }
  box.append(list);
  return box;
}

export function renderLoading(body: HTMLElement, word: string) {
  body.replaceChildren(h("h3", undefined, word), h("div", "muted", "Looking up…"));
}

export function renderError(body: HTMLElement, word: string, message: string) {
  body.replaceChildren(h("h3", undefined, word), h("div", "err", message));
}

export function renderResult(body: HTMLElement, res: LookupResult, where?: SaveContext) {
  const first = res.entries[0];
  const title = h("h3", first.gender ? `g-${first.gender}` : undefined);
  if (first.article) title.append(h("span", "art", first.article), " ");
  title.append(first.word);

  const say = h("button", "say", "🔊");
  say.title = "Pronounce";
  say.addEventListener("click", () => speak(first.word, first.audioUrl));

  const top = h("div", "top", title, say);
  const meta: string[] = [];
  if (first.ipa) meta.push(first.ipa);
  if (first.plural) meta.push(`Pl. ${first.plural}`);

  const context = where && { ...where, formSeen: res.word };
  body.replaceChildren(top);
  if (meta.length) body.append(h("div", "muted", meta.join("  ·  ")));
  for (const note of res.notes) body.append(h("div", "note", note));
  for (const entry of res.entries) body.append(renderEntry(entry, context));
  body.append(h("div", "src", "Wiktionary (CC BY-SA) via kaikki.org"));
}
