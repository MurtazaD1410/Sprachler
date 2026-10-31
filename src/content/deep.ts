/**
 * Some players (Disney+, among others) draw their video and captions inside shadow DOM, a private
 * sub-tree that document.querySelectorAll cannot see into. These helpers look through every open
 * shadow root. Closed shadow roots cannot be reached from an extension.
 */

type Root = Document | ShadowRoot;

/** Set on the element that hosts the extension's own UI, so the deep search skips it. */
export const OWN_ATTRIBUTE = "data-lingopie-de";

const roots = new Set<ShadowRoot>();
const listeners = new Set<(root: ShadowRoot) => void>();
const REFRESH_MS = 1500;
let lastRefresh = 0;

function walk(parent: ParentNode) {
  for (const el of parent.querySelectorAll("*")) {
    const shadow = el.shadowRoot;
    // Never watch our own caption bar: redrawing it would trigger the very reads that redraw it.
    if (!shadow || roots.has(shadow) || el.hasAttribute(OWN_ATTRIBUTE)) continue;
    roots.add(shadow);
    listeners.forEach((listener) => listener(shadow));
  }
}

/** Finds shadow roots that appeared since the last call. Throttled: walking every element is not free. */
export function refreshShadowRoots(force = false) {
  const now = Date.now();
  if (!force && now - lastRefresh < REFRESH_MS) return;
  lastRefresh = now;
  for (const root of [...roots]) if (!root.host.isConnected) roots.delete(root);
  walk(document);
  // Shadow roots can nest: look inside the ones already known too (new ones join the set as we go).
  for (const root of roots) walk(root);
}

export const allRoots = (): Root[] => [document, ...roots];

export function queryAllDeep<T extends Element>(selector: string): T[] {
  return allRoots().flatMap((root) => [...root.querySelectorAll<T>(selector)]);
}

/** Calls `callback` for every shadow root discovered from now on. Returns a function to stop. */
export function onShadowRoot(callback: (root: ShadowRoot) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Adds a stylesheet to the page and to every shadow root, including ones found later. Returns a remover. */
export function injectStyle(css: string): () => void {
  const styles = new Map<Root, HTMLStyleElement>();
  const add = (root: Root) => {
    if (styles.has(root)) return;
    const style = document.createElement("style");
    style.textContent = css;
    (root instanceof Document ? document.head : root).appendChild(style);
    styles.set(root, style);
  };
  allRoots().forEach(add);
  const stop = onShadowRoot(add);
  return () => {
    stop();
    styles.forEach((style) => style.remove());
  };
}
