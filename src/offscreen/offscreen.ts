// Hidden extension page that runs Chrome's on-device Translator. Extension pages see the installed
// language model (the popup does too), while the video page itself can report it as "downloadable".

const OPTS = { sourceLanguage: "de", targetLanguage: "en" };
let translator: { translate(text: string): Promise<string> } | null = null;

type OffscreenRequest = { target: "offscreen"; kind: "check" } | { target: "offscreen"; kind: "translate"; text: string };

async function handle(msg: OffscreenRequest): Promise<Record<string, unknown>> {
  const T = (self as unknown as { Translator?: any }).Translator;
  if (!T) throw new Error("this Chrome has no Translator API");
  const availability: string = await T.availability(OPTS);
  if (msg.kind === "check") return { availability };
  // Never create() unless it is installed: that could start a download without a user click.
  if (availability !== "available") throw new Error(`model is "${availability}"`);
  translator ??= await T.create(OPTS);
  return { text: await translator!.translate(msg.text) };
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false; // other extension messages are not for us
  handle(msg).then(
    (data) => sendResponse({ ok: true, ...data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
