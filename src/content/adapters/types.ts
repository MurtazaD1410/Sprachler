export interface CaptionAdapter {
  name: string;
  /** Returns true if this adapter can work on the current page/video. */
  matches(video: HTMLVideoElement): boolean;
  /** Starts watching; calls onText with the current caption ("" when none). Returns a stop function. */
  start(video: HTMLVideoElement, onText: (text: string) => void): () => void;
}
