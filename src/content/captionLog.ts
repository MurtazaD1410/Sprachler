export interface CaptionLine {
  id: number;
  text: string;
  translation?: string;
}

export interface PushResult {
  /** The line that was created or grew with this snapshot. */
  changed?: CaptionLine;
  /** The line that is now complete because a different one started (or the caption cleared). */
  finalized?: CaptionLine;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** True if `longer` is `shorter` plus more words (a caption growing, or being revised back). */
const extendsAtWord = (longer: string, shorter: string) =>
  longer.startsWith(shorter) && (longer.length === shorter.length || longer[shorter.length] === " ");

/**
 * Length of the leading part of `next` that `prev` already ended with. YouTube auto-captions roll up:
 * "A B C" becomes "B C D", and only "D" is new. One shared word is too likely to be a coincidence
 * between two separate cues, so at least two are required.
 */
function overlapLength(prev: string, next: string): number {
  const a = prev.split(" ");
  const b = next.split(" ");
  for (let k = Math.min(a.length, b.length); k >= 2; k--) {
    const head = b.slice(0, k).join(" ");
    if (a.slice(-k).join(" ") === head) return head.length;
  }
  return 0;
}

/**
 * Turns the stream of caption snapshots a site shows into a short history of separate lines,
 * so each line stays visible until newer ones push it out.
 */
export class CaptionLog {
  readonly lines: CaptionLine[] = [];
  private lastSnapshot = "";
  /** Characters at the start of the snapshot that belong to earlier lines. */
  private offset = 0;
  private current: CaptionLine | undefined;
  private nextId = 1;

  constructor(private maxLines: number) {}

  setMaxLines(n: number) {
    this.maxLines = Math.max(1, n);
    this.trim();
  }

  reset() {
    this.lines.length = 0;
    this.lastSnapshot = "";
    this.offset = 0;
    this.current = undefined;
  }

  has(line: CaptionLine) {
    return this.lines.includes(line);
  }

  private trim() {
    while (this.lines.length > this.maxLines) this.lines.shift();
  }

  push(raw: string): PushResult {
    const snapshot = clean(raw);

    if (!snapshot) {
      // The site cleared its caption. Our lines stay on screen; the next caption starts fresh.
      const finalized = this.current;
      this.lastSnapshot = "";
      this.offset = 0;
      this.current = undefined;
      return { finalized };
    }

    const last = this.lastSnapshot;
    if (this.current && last && (extendsAtWord(snapshot, last) || extendsAtWord(last, snapshot))) {
      this.lastSnapshot = snapshot;
      // A momentarily shorter version of the same caption: keep showing the longer text.
      if (snapshot.length < last.length) return {};
      const text = snapshot.slice(this.offset).trim();
      if (!text || text === this.current.text) return {};
      this.current.text = text;
      return { changed: this.current };
    }

    const finalized = this.current;
    const offset = last ? overlapLength(last, snapshot) : 0;
    const text = snapshot.slice(offset).trim();
    this.lastSnapshot = snapshot;
    this.offset = offset;

    if (!text) {
      this.current = undefined; // nothing new, just a shorter view of what we already have
      return { finalized };
    }

    const line: CaptionLine = { id: this.nextId++, text };
    this.lines.push(line);
    this.trim();
    this.current = line;
    return { changed: line, finalized };
  }
}
