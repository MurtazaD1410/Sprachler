import { lookup } from "./background/lookup";
import { translate } from "./background/translate";
import type { Message, Reply } from "./shared/types";

function updateBadge(enabled: boolean) {
  void chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  void chrome.action.setBadgeBackgroundColor({ color: "#2ecc71" });
}

const sync = () => chrome.storage.local.get({ enabled: false }).then((r) => updateBadge(r.enabled));

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) updateBadge(!!changes.enabled.newValue);
});

// Network calls live here: content scripts are bound by the page's CORS rules, the service worker is not.
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse: (r: Reply<unknown>) => void) => {
  const job =
    msg.type === "lookup"
      ? lookup(msg.word)
      : msg.type === "translate"
        ? translate(msg.text)
        : msg.type === "tabUrl"
          ? Promise.resolve(sender.tab?.url ?? "")
          : null;
  if (!job) return false;
  job.then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true; // keep the channel open for the async reply
});
