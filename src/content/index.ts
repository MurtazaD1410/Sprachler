import { Overlay } from "./overlay";
import { CaptionLog, type CaptionLine } from "./captionLog";
import { getTabUrl, lookupWord, translate } from "./api";
import { renderError, renderLoading, renderResult, type SaveContext } from "./card";
import { DEFAULTS, getSettings, type Settings } from "../shared/settings";
import {
  decodeSubtitleFile,
  getSubs,
  parseSubtitles,
  saveSubs,
  subsKey,
  type StoredSubs,
} from "../shared/subtitles";
import type { CaptionAdapter } from "./adapters/types";
import { youtube } from "./adapters/youtube";
import { disney } from "./adapters/disney";
import { textTracks } from "./adapters/textTracks";
import { importedAdapter } from "./adapters/imported";
import { queryAllDeep, refreshShadowRoots } from "./deep";

// Order matters: site-specific adapters first, generic TextTrack fallback last.
const ADAPTERS: CaptionAdapter[] = [youtube, disney, textTracks];
/** A growing line is translated once it has stopped changing for this long. */
const TRANSLATE_SETTLE_MS = 400;
/** Page changes can arrive hundreds of times a second; a scan every so often is plenty. */
const SCAN_DEBOUNCE_MS = 500;

let settings: Settings = { ...DEFAULTS };
let activeVideo: HTMLVideoElement | undefined;
let pausedByUs = false;
const stops = new Map<HTMLVideoElement, () => void>();
const log = new CaptionLog(DEFAULTS.lines);
const translateTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** A subtitle file the user imported for this page. When present it replaces the site's own captions. */
let subs: StoredSubs | undefined;
let subsUrl = "";
let subsLoads = 0;

/** A link to the video that jumps to the current moment, when the site supports it. */
function videoLink(seconds: number): string {
  const url = new URL(location.href);
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.has("v")) {
    return `https://www.youtube.com/watch?v=${url.searchParams.get("v")}&t=${seconds}s`;
  }
  return location.href;
}

function wordContext(): SaveContext {
  const time = Math.floor(activeVideo?.currentTime ?? 0);
  return {
    url: videoLink(time),
    time,
    title: document.title.replace(/ - YouTube$/, ""),
  };
}

const overlay = new Overlay(
  (word, _sentence, anchor) => {
    if (activeVideo && !activeVideo.paused) {
      activeVideo.pause();
      pausedByUs = true;
    }
    const where = wordContext();
    const body = overlay.openCard(anchor);
    renderLoading(body, word);
    lookupWord(word).then(
      (res) => body.isConnected && renderResult(body, res, where),
      (err: Error) => body.isConnected && renderError(body, word, err.message),
    );
  },
  () => {
    if (pausedByUs) void activeVideo?.play();
    pausedByUs = false;
  },
);

const render = () => overlay.setLines(log.lines, settings.translation);

function translateLine(line: CaptionLine) {
  clearTimeout(translateTimers.get(line.id));
  translateTimers.delete(line.id);
  // A line that already scrolled away is not worth spending translation quota on.
  if (!settings.translation || !log.has(line)) return;
  const text = line.text;
  translate(text).then(
    (tr) => {
      if (line.text !== text) return; // it grew meanwhile; the newer text has its own request
      line.translation = tr.text;
      render();
    },
    (err: Error) => {
      if (isOrphaned(err)) return handleOrphaned();
      console.warn("[lingopie-de] translation failed:", err.message);
    },
  );
}

// ---- the extension was reloaded or updated while this page stayed open ----

/** An old copy of this script keeps running after a reload but can no longer reach the extension. */
const isOrphaned = (err?: Error) => !chrome.runtime?.id || !!err?.message.includes("context invalidated");

let orphaned = false;
let scanInterval: ReturnType<typeof setInterval> | undefined;
const observer = new MutationObserver(() => scheduleScan());

function handleOrphaned() {
  if (orphaned) return;
  orphaned = true;
  clearInterval(scanInterval);
  observer.disconnect();
  stops.forEach((stop) => stop());
  stops.clear();
  translateTimers.forEach(clearTimeout);
  translateTimers.clear();
  log.reset();
  overlay.showNotice("Lingopie DE was updated. Refresh this page to continue.");
  console.warn("[lingopie-de] the extension was reloaded; this page needs a refresh.");
}

function scheduleTranslation(line: CaptionLine) {
  clearTimeout(translateTimers.get(line.id));
  translateTimers.set(line.id, setTimeout(() => translateLine(line), TRANSLATE_SETTLE_MS));
}

function onCaption(text: string) {
  const { changed, finalized } = log.push(text);
  if (finalized) translateLine(finalized); // complete: no reason to wait any longer
  if (!changed) return; // same text again: nothing to redraw
  scheduleTranslation(changed);
  render();
}

function attach(video: HTMLVideoElement) {
  if (stops.has(video)) return;
  const adapter = subs ? importedAdapter(subs) : ADAPTERS.find((a) => a.matches(video));
  if (!adapter) return;
  const inShadow = video.getRootNode() instanceof ShadowRoot;
  console.info(`[lingopie-de] using adapter: ${adapter.name}${inShadow ? " (video is inside shadow DOM)" : ""}`);
  stops.set(video, adapter.start(video, onCaption));
}

/** Switch caption source (an imported file appeared or went away): drop the old one and start fresh. */
function restartAdapters() {
  if (!settings.enabled) return;
  stops.forEach((stop) => stop());
  stops.clear();
  log.reset();
  render();
  scan();
}

/** Looks up the imported subtitles for the tab's current address. Cheap, so safe to call on navigation. */
async function loadSubs() {
  const load = ++subsLoads;
  let loaded: StoredSubs | undefined;
  try {
    subsUrl = await getTabUrl();
    loaded = subsUrl ? await getSubs(subsUrl) : undefined;
  } catch (err) {
    if (isOrphaned(err as Error)) return handleOrphaned();
  }
  if (load !== subsLoads || loaded?.savedAt === subs?.savedAt) return; // superseded, or nothing changed
  subs = loaded;
  restartAdapters();
}

function onSubsChanged(next: StoredSubs | undefined) {
  if (!next) {
    if (!subs) return;
    subs = undefined;
    restartAdapters();
  } else if (subs?.savedAt === next.savedAt) {
    subs.offset = next.offset; // only the timing changed: the running adapter picks it up on its next tick
  } else {
    subs = next;
    restartAdapters();
  }
}

/** The video being watched: the biggest attached one currently on screen. */
function primaryVideo(): HTMLVideoElement | undefined {
  let best: HTMLVideoElement | undefined;
  let bestArea = -1;
  for (const video of stops.keys()) {
    const { width, height } = video.getBoundingClientRect();
    if (width * height > bestArea) {
      best = video;
      bestArea = width * height;
    }
  }
  return best;
}

let lastHref = location.href;

/**
 * Sites like YouTube swap videos and players without reloading the page, so this runs repeatedly:
 * it drops videos that are gone, picks up new ones, and keeps the overlay inside the current player.
 */
function scan() {
  if (isOrphaned()) return handleOrphaned();
  if (!settings.enabled) return;
  if (location.href !== lastHref) {
    lastHref = location.href; // a different video: don't carry the old lines over
    log.reset();
    render();
    void loadSubs(); // it may have its own imported subtitles, or the previous one's no longer apply
  }
  for (const [video, stop] of stops) {
    if (video.isConnected) continue;
    stop();
    stops.delete(video);
  }
  refreshShadowRoots();
  queryAllDeep<HTMLVideoElement>("video").forEach(attach);
  const primary = primaryVideo();
  if (primary) {
    activeVideo = primary;
    overlay.mount(primary);
  }
}

let scanQueued = false;
function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  setTimeout(() => {
    scanQueued = false;
    scan();
  }, SCAN_DEBOUNCE_MS);
}

function shutDown() {
  // Stopping the adapters also restores the site's native captions.
  stops.forEach((stop) => stop());
  stops.clear();
  translateTimers.forEach(clearTimeout);
  translateTimers.clear();
  log.reset();
  overlay.clear();
  overlay.unmount();
}

function applySettings(next: Settings) {
  const prev = settings;
  settings = next;
  log.setMaxLines(next.lines);
  if (next.enabled !== prev.enabled) {
    if (next.enabled) void loadSubs().finally(scan); // pick the caption source first, then attach
    else shutDown();
    return;
  }
  if (!next.enabled) return;
  if (next.translation && !prev.translation) log.lines.forEach(translateLine); // catch up on what's on screen
  render();
}

console.info("[lingopie-de] content script loaded on", location.hostname);
getSettings().then(applySettings);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const subsChange = subsUrl ? changes[subsKey(subsUrl)] : undefined;
  if (subsChange) onSubsChanged(subsChange.newValue as StoredSubs | undefined);

  const changed = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter((key) => changes[key]);
  if (!changed.length) return; // e.g. the quota counter or a saved word: nothing for us to redo
  const next = { ...settings };
  for (const key of changed) (next[key] as Settings[typeof key]) = changes[key].newValue;
  applySettings(next);
});

// ---- importing by dragging a .srt/.vtt file onto the page ----

async function importDropped(file: File) {
  try {
    const cues = parseSubtitles(decodeSubtitleFile(await file.arrayBuffer()));
    if (!cues.length) throw new Error("No subtitle lines found in that file.");
    subsUrl = await getTabUrl();
    await saveSubs(subsUrl, { name: file.name, cues, offset: 0, savedAt: Date.now() });
    // The restart that follows clears the screen, so confirm just after it.
    setTimeout(() => overlay.showNotice(`Loaded ${cues.length} subtitle lines from ${file.name}`), 300);
  } catch (err) {
    overlay.showNotice(err instanceof Error ? err.message : String(err));
  }
  setTimeout(render, 3500);
}

const dragHasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
// Without this the browser would navigate to the dropped file instead of letting us read it.
document.addEventListener("dragover", (e) => {
  if (settings.enabled && dragHasFiles(e)) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name));
  if (!settings.enabled || !file) return;
  e.preventDefault();
  void importDropped(file);
});

// Players inject <video> and tracks late, so keep watching.
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("yt-navigate-finish", scheduleScan);
// Safety net for changes the observer can't see, such as a hidden player becoming visible.
scanInterval = setInterval(scan, 1000);
