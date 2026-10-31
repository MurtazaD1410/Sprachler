import { injectStyle } from "../deep";

/**
 * Containers in which sites draw their own captions. The Disney+ ones are matched by a part of the
 * class name, since I have not been able to confirm the exact names.
 */
export const YOUTUBE_NATIVE = ".ytp-caption-window-container";
export const DISNEY_NATIVE =
  '[class*="subtitle-renderer-wrapper"], [class*="subtitle-renderer-cue-positioning"]';

/**
 * Hides the site's own captions (for instance Disney+'s) while imported subtitles are shown.
 * Returns a function that puts them back.
 */
export function hideNativeCaptions(video: HTMLVideoElement): () => void {
  const restoreStyle = injectStyle(`${YOUTUBE_NATIVE}, ${DISNEY_NATIVE}{display:none !important;}`);

  // Players that use real text tracks: keep them loaded but not drawn.
  const shown = [...video.textTracks].filter((t) => t.mode === "showing");
  shown.forEach((t) => (t.mode = "hidden"));

  return () => {
    restoreStyle();
    shown.forEach((t) => (t.mode = "showing"));
  };
}
