import type { Engine, LookupResult, Message, Reply, Translation } from "../shared/types";

async function send<T>(msg: Message): Promise<T> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(msg);
  if (!reply) throw new Error("No response from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export const lookupWord = (word: string) => send<LookupResult>({ type: "lookup", word });
export const getTabUrl = () => send<string>({ type: "tabUrl" });

let lastEngine: Engine | undefined;

/** Tell the console and the popup which engine produced the latest translation. */
function reportEngine(engine: Engine) {
  if (engine === lastEngine) return;
  lastEngine = engine;
  console.info(`[lingopie-de] translation engine: ${engine}`);
  void chrome.storage.local.set({ engine });
}

const cache = new Map<string, Translation>();

/** The background picks the engine: on-device first, then Google, then MyMemory. */
export async function translate(text: string): Promise<Translation> {
  const hit = cache.get(text);
  if (hit) return hit;
  const result = await send<Translation>({ type: "translate", text });
  reportEngine(result.engine);
  cache.set(text, result);
  return result;
}
