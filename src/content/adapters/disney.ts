import { domAdapter } from "./dom";
import { DISNEY_NATIVE } from "./native";

// The class names are best-effort (Disney+ has used "hive-" and "dss-" prefixes), so match on the
// part that stays the same. Adjust if the live player turns out to use something else.
export const disney = domAdapter(
  "disney+",
  /(^|\.)disneyplus\.com$/,
  '[class*="subtitle-renderer-line"]',
  DISNEY_NATIVE,
);
