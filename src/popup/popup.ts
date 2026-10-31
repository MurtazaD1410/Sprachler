import { getSettings, type Settings } from "../shared/settings";
import { DAILY_LIMIT, getUsage, type Usage } from "../shared/usage";
import { countDue, listWords } from "../shared/wortschatz";
import { decodeSubtitleFile, getSubs, parseSubtitles, removeSubs, saveSubs } from "../shared/subtitles";
import type { Engine } from "../shared/types";

const toggle = document.getElementById("toggle") as HTMLInputElement;
const label = document.getElementById("status") as HTMLElement;
const translation = document.getElementById("translation") as HTMLInputElement;
const lines = document.getElementById("lines") as HTMLSelectElement;
const usageText = document.getElementById("usage-text") as HTMLElement;
const usageFill = document.getElementById("usage-fill") as HTMLElement;
const usageNote = document.getElementById("usage-note") as HTMLElement;
const meter = usageFill.parentElement as HTMLElement;
const engineNote = document.getElementById("engine-note") as HTMLElement;
const download = document.getElementById("download") as HTMLButtonElement;

const save = (patch: Partial<Settings>) => void chrome.storage.local.set(patch);
const fmt = (n: number) => n.toLocaleString("en-US");

// ---- translation engines: one row each, green/red dot plus an "in use" tag ----

type Health = "ok" | "bad" | "checking";

function row(engine: Engine): HTMLElement {
  return document.querySelector(`.engines li[data-engine="${engine}"]`) as HTMLElement;
}

function setHealth(engine: Engine, health: Health, text: string) {
  const li = row(engine);
  (li.querySelector(".dot") as HTMLElement).className = `dot ${health}`;
  (li.querySelector(".state") as HTMLElement).textContent = text;
}

function markInUse(engine?: Engine) {
  for (const li of document.querySelectorAll<HTMLElement>(".engines li")) {
    (li.querySelector(".pill") as HTMLElement).hidden = li.dataset.engine !== engine;
  }
}

const LANGS = { sourceLanguage: "de", targetLanguage: "en" };
// Chrome's built-in Translator isn't in the standard DOM typings yet.
const Translator = (self as unknown as { Translator?: any }).Translator;

async function checkOnDevice() {
  download.hidden = true;
  engineNote.textContent = "";
  if (!Translator) {
    setHealth("on-device", "bad", "Needs Chrome 138+");
    return;
  }
  let state: string;
  try {
    state = await Translator.availability(LANGS);
  } catch {
    state = "unavailable";
  }
  if (state === "available") {
    setHealth("on-device", "ok", "Ready");
    void showDiag();
  } else if (state === "unavailable") {
    setHealth("on-device", "bad", "Not supported here");
  } else {
    setHealth("on-device", "bad", "Model not installed");
    engineNote.textContent = "Download the model once to translate offline. Keep this popup open until it finishes.";
    download.hidden = false;
    download.disabled = false;
    download.textContent = "Download offline translation";
  }
}

/** What the video page itself reported about using the model: the reason it isn't "in use" if it isn't. */
async function showDiag() {
  const { onDeviceDiag } = (await chrome.storage.local.get({ onDeviceDiag: "" })) as { onDeviceDiag: string };
  if (onDeviceDiag) engineNote.textContent = `Last page check: ${onDeviceDiag}`;
}

/** A tiny live request, so the dot reflects whether Google answers right now. */
async function checkGoogle() {
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=Hallo";
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    await res.json(); // a captcha page is HTML and fails here
    setHealth("google", "ok", "Reachable");
  } catch {
    setHealth("google", "bad", "Blocked or offline");
  }
}

download.addEventListener("click", async () => {
  download.disabled = true;
  download.textContent = "Starting…";
  try {
    // Needs a user click, which this is. The model is shared by the whole browser, so pages can use it afterwards.
    await Translator.create({
      ...LANGS,
      monitor(m: EventTarget) {
        m.addEventListener("downloadprogress", (e) => {
          const loaded = (e as Event & { loaded: number }).loaded;
          download.textContent = `Downloading… ${Math.round(loaded * 100)}%`;
        });
      },
    });
  } catch (err) {
    engineNote.textContent = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  void checkOnDevice();
});

// ---- MyMemory quota ----

function renderUsage(usage: Usage) {
  const used = Math.min(usage.chars, DAILY_LIMIT);
  const pct = Math.round((used / DAILY_LIMIT) * 100);
  const left = DAILY_LIMIT - used;
  usageText.textContent = `${fmt(used)} / ${fmt(DAILY_LIMIT)}`;
  usageFill.style.width = `${pct}%`;
  usageFill.className = pct >= 100 ? "fill full" : pct >= 80 ? "fill warn" : "fill";
  meter.setAttribute("aria-valuenow", String(pct));
  usageNote.textContent =
    left === 0
      ? "Limit reached. Translation pauses until tomorrow; word cards still work."
      : `${fmt(left)} characters left (about ${Math.round(left / 40)} caption lines). Only used when on-device and Google aren't. Resets around midnight UTC.`;
  setHealth("mymemory", left > 0 ? "ok" : "bad", left > 0 ? `${fmt(left)} left` : "Limit reached");
}

// ---- imported subtitles, kept per video page ----

const subsState = document.getElementById("subs-state") as HTMLElement;
const subsNote = document.getElementById("subs-note") as HTMLElement;
const subsLoad = document.getElementById("subs-load") as HTMLButtonElement;
const subsRemove = document.getElementById("subs-remove") as HTMLButtonElement;
const subsFile = document.getElementById("subs-file") as HTMLInputElement;
const subsTiming = document.getElementById("subs-timing") as HTMLElement;
const subsOffset = document.getElementById("subs-offset") as HTMLElement;

/** The tab the popup was opened on: subtitles belong to that page's address. */
let pageUrl: string | undefined;

const fmtOffset = (s: number) => `${s > 0 ? "+" : ""}${s.toFixed(1)}s`;

async function renderSubs() {
  subsNote.textContent = "";
  if (!pageUrl) {
    subsState.textContent = "Open a video page first.";
    subsLoad.disabled = true;
    subsRemove.hidden = subsTiming.hidden = true;
    return;
  }
  subsLoad.disabled = false;
  const subs = await getSubs(pageUrl);
  subsRemove.hidden = subsTiming.hidden = !subs;
  if (!subs) {
    subsState.textContent = "None. This video uses its own captions, if it has any.";
    return;
  }
  subsState.textContent = `${subs.name} · ${fmt(subs.cues.length)} lines`;
  subsOffset.textContent = fmtOffset(subs.offset);
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  pageUrl = tab?.url && /^https?:/.test(tab.url) ? tab.url : undefined;
  void renderSubs();
});

subsLoad.addEventListener("click", () => subsFile.click());
subsFile.addEventListener("change", async () => {
  const file = subsFile.files?.[0];
  subsFile.value = ""; // so choosing the same file again still fires
  if (!file || !pageUrl) return;
  try {
    const cues = parseSubtitles(decodeSubtitleFile(await file.arrayBuffer()));
    if (!cues.length) throw new Error("No subtitle lines found. Is it an .srt or .vtt file?");
    await saveSubs(pageUrl, { name: file.name, cues, offset: 0, savedAt: Date.now() });
    await renderSubs();
    subsNote.textContent = "Loaded. Turn the extension on and start the video. If the lines are early or late, adjust the timing.";
  } catch (err) {
    subsNote.textContent = err instanceof Error ? err.message : String(err);
  }
});

subsRemove.addEventListener("click", async () => {
  if (!pageUrl) return;
  await removeSubs(pageUrl);
  await renderSubs();
});

for (const btn of document.querySelectorAll<HTMLButtonElement>(".stepper button")) {
  btn.addEventListener("click", async () => {
    const subs = pageUrl ? await getSubs(pageUrl) : undefined;
    if (!pageUrl || !subs) return;
    // The same savedAt tells the page this is only a timing change, so playback is not restarted.
    subs.offset = Math.round((subs.offset + Number(btn.dataset.step)) * 10) / 10;
    await saveSubs(pageUrl, subs);
    subsOffset.textContent = fmtOffset(subs.offset);
  });
}

// ---- Wortschatz ----

const dueText = document.getElementById("due-text") as HTMLElement;

function renderDue() {
  void Promise.all([countDue(), listWords()]).then(([due, all]) => {
    dueText.textContent = !all.length ? "" : due ? `${due} due` : "all caught up";
  });
}

document.getElementById("open-wortschatz")!.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("src/wortschatz/index.html") });
  window.close();
});
renderDue();

// ---- settings ----

function renderStatus() {
  label.textContent = toggle.checked ? "On" : "Off";
}

getSettings().then((s) => {
  toggle.checked = s.enabled;
  translation.checked = s.translation;
  lines.value = String(s.lines);
  renderStatus();
});

void checkOnDevice();
void checkGoogle();
getUsage().then(renderUsage);
// A default of `undefined` would be dropped and request no keys at all, so ask for the key by name.
chrome.storage.local.get("engine").then((r) => markInUse(r.engine as Engine | undefined));

// Keep the popup live while a video is being translated.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.usage) void getUsage().then(renderUsage);
  if (changes.engine) markInUse(changes.engine.newValue as Engine);
  // The download hint takes the note's place while the model isn't installed.
  if (changes.onDeviceDiag && download.hidden) void showDiag();
});

toggle.addEventListener("change", () => {
  renderStatus();
  save({ enabled: toggle.checked });
});
translation.addEventListener("change", () => save({ translation: translation.checked }));
lines.addEventListener("change", () => save({ lines: Number(lines.value) }));
