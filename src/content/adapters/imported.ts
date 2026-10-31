import { activeText, type StoredSubs } from "../../shared/subtitles";
import { hideNativeCaptions } from "./native";
import type { CaptionAdapter } from "./types";

const POLL_MS = 100;

/**
 * Shows an imported subtitle file in time with the video. It only reads `video.currentTime`, so it
 * works on any site. `subs.offset` is read on every tick, so timing changes apply immediately.
 */
export function importedAdapter(subs: StoredSubs): CaptionAdapter {
  return {
    name: `imported subtitles (${subs.name})`,
    matches: () => true,
    start(video, onText) {
      const restoreNative = hideNativeCaptions(video);
      let last = "";
      const tick = () => {
        const text = activeText(subs.cues, video.currentTime - subs.offset);
        if (text === last) return;
        last = text;
        onText(text);
      };
      const timer = setInterval(tick, POLL_MS);
      tick();
      return () => {
        clearInterval(timer);
        restoreNative();
      };
    },
  };
}
