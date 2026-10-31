export interface Settings {
  /** Master switch: nothing runs on any page while this is off. */
  enabled: boolean;
  /** Show the English translation under each caption line. Word cards work either way. */
  translation: boolean;
  /** How many caption lines stay on screen at once. */
  lines: number;
}

export const DEFAULTS: Settings = { enabled: false, translation: true, lines: 3 };

export const getSettings = (): Promise<Settings> => chrome.storage.local.get(DEFAULTS) as Promise<Settings>;
