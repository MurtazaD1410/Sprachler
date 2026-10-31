/** MyMemory's free anonymous allowance, in characters per day. */
export const DAILY_LIMIT = 5000;

export interface Usage {
  /** UTC date the count belongs to, "YYYY-MM-DD". */
  day: string;
  chars: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const empty = (): Usage => ({ day: today(), chars: 0 });

export async function getUsage(): Promise<Usage> {
  const { usage } = (await chrome.storage.local.get({ usage: empty() })) as { usage: Usage };
  return usage.day === today() ? usage : empty(); // a new day starts from zero
}

// Several translations can finish at once; queue the read-modify-write so no count is lost.
let queue: Promise<unknown> = Promise.resolve();

function update(change: (usage: Usage) => Usage): Promise<void> {
  const next = queue.then(async () => {
    await chrome.storage.local.set({ usage: change(await getUsage()) });
  });
  queue = next.catch(() => {});
  return next;
}

export const addUsage = (chars: number) => update((u) => ({ ...u, chars: u.chars + chars }));

/** The service said the allowance is gone (other apps on the same network can use it up too). */
export const markExhausted = () => update((u) => ({ ...u, chars: Math.max(u.chars, DAILY_LIMIT) }));
