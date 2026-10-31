import type { CaptionLine } from "./captionLog";
import { OWN_ATTRIBUTE } from "./deep";

export type WordClick = (word: string, sentence: string, anchor: DOMRect) => void;

const CSS = `
:host{all:initial}
.bar{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);max-width:80%;
  text-align:center;pointer-events:none;z-index:2147483647;font-family:system-ui,sans-serif}
.bar .entry{width:fit-content;max-width:100%;margin:6px auto 0}.bar .entry.old{opacity:.65}
.line{display:block;background:rgba(0,0,0,.72);color:#fff;font-size:26px;line-height:1.35;
  padding:4px 12px;border-radius:6px;pointer-events:auto}
.w{cursor:pointer;border-radius:3px}.w:hover{background:#ffd54a;color:#000}
.tr{display:block;margin-top:3px;background:rgba(0,0,0,.6);color:#bfe3ff;font-size:18px;
  padding:2px 10px;border-radius:6px;pointer-events:auto}.card{position:fixed;width:360px;overflow:auto;box-sizing:border-box;background:#1b1b1f;color:#eee;
  border-radius:10px;padding:12px 14px;font:14px/1.4 system-ui,sans-serif;pointer-events:auto;
  box-shadow:0 8px 28px rgba(0,0,0,.5);z-index:2147483647;text-align:left}
.card{overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#55555e transparent}
.card.more{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 32px),transparent);
  mask-image:linear-gradient(to bottom,#000 calc(100% - 32px),transparent)}
.card h3{margin:0;font-size:22px;font-weight:600}
.card .top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card .art{font-weight:500;opacity:.9}
.card .g-m .art{color:#6cb6ff}.card .g-f .art{color:#ff7b8f}.card .g-n .art{color:#5fd68a}
.card .say{background:#2c2c33;border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;padding:4px 8px}
.card .say:hover{background:#3a3a43}
.card .muted{color:#9a9aa3;font-size:13px;margin-top:2px}
.card .err{color:#ff8a8a;margin-top:6px}
.card .note{margin-top:8px;padding:4px 8px;background:#26262c;border-left:3px solid #ffd54a;border-radius:4px;font-size:13px}
.card .entry{margin-top:12px;padding-top:8px;border-top:1px solid #33333b}
.card .entryhead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card .save{background:#2c2c33;border:0;border-radius:6px;color:#ddd;cursor:pointer;font-size:12px;padding:3px 9px}
.card .save:hover{background:#3a3a43}
.card .save.on{background:#4a3f12;color:#ffd54a}
.card .pos{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#ffd54a}
.card .head{color:#9a9aa3;font-size:12px;margin:2px 0 4px}
.card .senses{margin:6px 0 0;padding-left:20px}.card .senses li{margin:4px 0}
.card .ex{margin-top:2px;font-size:13px}.card .ex .de{display:block;color:#d6d6dc;font-style:italic}
.card .ex .en{display:block;color:#9a9aa3}
.card .src{margin-top:12px;font-size:11px;color:#6d6d76}
`;

const MAX_CARD_HEIGHT = 380;
/** Below this, there isn't room above the word and the card opens below it instead. */
const MIN_CARD_HEIGHT = 200;
const HEADER_HEIGHT = 64;
const MARGIN = 8;

const WORD_RE = /[\p{L}\p{M}'’-]+/gu;

export class Overlay {
  private host = document.createElement("div");
  private root = this.host.attachShadow({ mode: "open" });
  private bar = document.createElement("div");
  private card: HTMLDivElement | null = null;
  private video: HTMLVideoElement | undefined;
  private hovering = false;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: { lines: CaptionLine[]; showTranslation: boolean } | null = null;

  constructor(
    private onWordClick: WordClick,
    private onCardClose: () => void = () => {},
  ) {
    this.host.setAttribute(OWN_ATTRIBUTE, "");
    const style = document.createElement("style");
    style.textContent = CSS;
    this.bar.className = "bar";
    this.root.append(style, this.bar);
    document.addEventListener("fullscreenchange", () => this.mount());
    // Capture phase: a click outside only dismisses the card, so the site's own
    // click-to-toggle-play handler doesn't pause the video we just resumed.
    document.addEventListener(
      "click",
      (e) => {
        if (!this.card || e.composedPath().includes(this.host)) return;
        e.stopPropagation();
        e.preventDefault();
        this.closeCard();
      },
      true,
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeCard();
    });
    // Freeze the line under the cursor so a click always lands on the word you aimed at.
    // Leaving both the caption bar and the card closes the card (and resumes the video).
    this.root.addEventListener("mouseover", () => {
      this.hovering = true;
      clearTimeout(this.leaveTimer);
    });
    this.root.addEventListener("mouseout", (e) => {
      if (this.root.contains((e as MouseEvent).relatedTarget as Node | null)) return;
      this.hovering = false;
      clearTimeout(this.leaveTimer);
      // Short grace period so moving from the word to its card doesn't dismiss it.
      this.leaveTimer = setTimeout(() => this.closeCard(), 250);
      this.flush();
    });
  }

  private get frozen() {
    return this.hovering || this.card !== null;
  }

  private flush() {
    if (this.frozen || !this.pending) return;
    const { lines, showTranslation } = this.pending;
    this.setLines(lines, showTranslation);
  }

  /** Attach to the fullscreen element if any, else the player root, so it stays visible. */
  mount(video?: HTMLVideoElement) {
    if (video) this.video = video;
    // On YouTube the video container sits below the player chrome, so mount on the player root.
    const player = this.video?.closest<HTMLElement>(".html5-video-player");
    // A video inside shadow DOM has to be mounted beside it: the fullscreen element is then the
    // shadow host, whose light-DOM children are not drawn unless the page provides a slot for them.
    const inShadow = this.video?.getRootNode() instanceof ShadowRoot;
    const parent = inShadow
      ? this.video!.parentElement!
      : (document.fullscreenElement ?? player ?? this.video?.parentElement ?? document.body);
    if (this.host.parentElement !== parent) {
      if (getComputedStyle(parent).position === "static") (parent as HTMLElement).style.position = "relative";
      parent.appendChild(this.host);
    }
  }

  /**
   * Shows the given lines, oldest on top. While the cursor is on the bar or a card is open the
   * display holds still, and the latest lines are drawn as soon as it lets go.
   */
  setLines(lines: readonly CaptionLine[], showTranslation: boolean) {
    const snapshot = lines.map((l) => ({ ...l })); // the log keeps mutating its own objects
    if (this.frozen) {
      this.pending = { lines: snapshot, showTranslation };
      return;
    }
    this.pending = null;
    this.bar.replaceChildren(
      ...snapshot.map((l, i) => this.renderEntry(l, showTranslation, i < snapshot.length - 1)),
    );
  }

  /** Replaces the captions with a plain message, bypassing the hover freeze. */
  showNotice(message: string) {
    this.pending = null;
    this.hovering = false;
    const entry = document.createElement("div");
    entry.className = "entry";
    const span = document.createElement("span");
    span.className = "line";
    span.style.fontSize = "18px";
    span.textContent = message;
    entry.append(span);
    this.bar.replaceChildren(entry);
  }

  private renderEntry(line: CaptionLine, showTranslation: boolean, old: boolean): HTMLElement {
    const entry = document.createElement("div");
    entry.className = old ? "entry old" : "entry";
    const span = document.createElement("span");
    span.className = "line";
    const text = line.text;
    let last = 0;
    for (const m of text.matchAll(WORD_RE)) {
      span.append(text.slice(last, m.index));
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = m[0];
      w.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onWordClick(m[0], text, w.getBoundingClientRect());
      });
      span.append(w);
      last = m.index! + m[0].length;
    }
    span.append(text.slice(last));
    entry.append(span);
    if (showTranslation && line.translation) {
      const tr = document.createElement("span");
      tr.className = "tr";
      tr.textContent = line.translation;
      entry.append(tr);
    }
    return entry;
  }

  /** Opens (or replaces) the word card and returns its body for the caller to fill. */
  openCard(anchor: DOMRect): HTMLElement {
    this.card?.remove(); // replacing, not closing: the video stays paused
    const card = document.createElement("div");
    card.className = "card";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    card.style.left = `${Math.min(Math.max(8, anchor.left), Math.max(8, vw - 368))}px`;
    // Outside fullscreen, YouTube's header bar draws over the player, so keep clear of it.
    const topLimit = document.fullscreenElement ? MARGIN : HEADER_HEIGHT;
    const spaceAbove = anchor.top - topLimit - MARGIN;
    const spaceBelow = vh - anchor.bottom - 2 * MARGIN;
    if (spaceAbove >= MIN_CARD_HEIGHT || spaceAbove >= spaceBelow) {
      // Grow upwards from just above the word.
      card.style.bottom = `${vh - anchor.top + MARGIN}px`;
      card.style.maxHeight = `${Math.min(MAX_CARD_HEIGHT, spaceAbove)}px`;
    } else {
      card.style.top = `${anchor.bottom + MARGIN}px`;
      card.style.maxHeight = `${Math.min(MAX_CARD_HEIGHT, spaceBelow)}px`;
    }
    // Scrolling the card must never reach the page or the player (YouTube reacts to wheel events).
    card.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    // Fade the bottom edge while there is more to read, so hidden content is obvious.
    const updateMore = () =>
      card.classList.toggle("more", card.scrollHeight - card.scrollTop - card.clientHeight > 8);
    card.addEventListener("scroll", updateMore, { passive: true });
    new MutationObserver(updateMore).observe(card, { childList: true, subtree: true });
    this.root.append(card);
    this.card = card;
    requestAnimationFrame(updateMore);
    return card;
  }

  /** Remove the caption line and any card without touching the host element. */
  clear() {
    this.pending = null;
    this.hovering = false;
    clearTimeout(this.leaveTimer);
    this.closeCard();
    this.bar.replaceChildren();
  }

  unmount() {
    this.host.remove();
  }

  closeCard() {
    if (!this.card) return;
    this.card.remove();
    this.card = null;
    this.onCardClose();
    this.flush();
  }
}
