import { allRoots, injectStyle, onShadowRoot, queryAllDeep } from "../deep";
import type { CaptionAdapter } from "./types";

const READ_INTERVAL_MS = 100;

/** Builds an adapter that reads captions rendered by the site into the DOM (shadow DOM included). */
export function domAdapter(
  name: string,
  hostPattern: RegExp,
  captionSelector: string,
  nativeContainerSelector: string,
  acceptVideo: (video: HTMLVideoElement) => boolean = () => true,
): CaptionAdapter {
  return {
    name,
    matches: (video) => hostPattern.test(location.hostname) && acceptVideo(video),
    start(_video, onText) {
      // Keep native captions in the DOM (so we can read them) but invisible.
      const restoreStyle = injectStyle(`${nativeContainerSelector}{opacity:0 !important;}`);

      const read = () => {
        const lines = queryAllDeep(captionSelector)
          .map((el) => el.textContent?.trim() ?? "")
          .filter(Boolean);
        onText(lines.join(" "));
      };
      // Players change their DOM constantly (progress bars, timers). Reading on every change would
      // hog the page, so coalesce: at most one read per interval, however many changes arrive.
      let queued = false;
      let stopped = false;
      const scheduleRead = () => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          if (!stopped) read();
        }, READ_INTERVAL_MS);
      };
      const observer = new MutationObserver(scheduleRead);
      const observed = new Set<Node>();
      const watch = (root: Document | ShadowRoot) => {
        if (observed.has(root)) return;
        observed.add(root);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
      };
      allRoots().forEach(watch);
      const stopWatchingRoots = onShadowRoot(watch);
      read();

      return () => {
        stopped = true;
        stopWatchingRoots();
        observer.disconnect();
        restoreStyle();
      };
    },
  };
}
