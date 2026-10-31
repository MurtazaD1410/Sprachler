import type { CaptionAdapter } from "./types";

const isGerman = (t: TextTrack) => /^de\b|german|deutsch/i.test(`${t.language} ${t.label}`);

/** Generic fallback: uses the video's own <track> / TextTrack cues (works on many 3rd-party players). */
export const textTracks: CaptionAdapter = {
  name: "textTracks",
  matches: (video) => [...video.textTracks].some((t) => t.kind !== "metadata"),
  start(video, onText) {
    const track =
      [...video.textTracks].find(isGerman) ??
      [...video.textTracks].find((t) => t.kind === "subtitles" || t.kind === "captions");
    if (!track) return () => {};
    const previousMode = track.mode;
    track.mode = "hidden"; // keep cues firing without drawing the native ones
    const onCue = () => {
      const cues = [...(track.activeCues ?? [])] as VTTCue[];
      onText(cues.map((c) => c.text.replace(/<[^>]+>/g, "")).join(" ").trim());
    };
    track.addEventListener("cuechange", onCue);
    onCue();
    return () => {
      track.removeEventListener("cuechange", onCue);
      track.mode = previousMode;
    };
  },
};
