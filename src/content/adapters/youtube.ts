import { domAdapter } from "./dom";
import { YOUTUBE_NATIVE } from "./native";

export const youtube = domAdapter(
  "youtube",
  /(^|\.)youtube\.com$/,
  ".ytp-caption-segment",
  YOUTUBE_NATIVE,
  // The home page and search results play muted hover previews; those are not the video being watched.
  (video) => !video.closest("ytd-video-preview, #inline-player"),
);
