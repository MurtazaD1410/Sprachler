type Child = Node | string;

/** Small element builder. Strings become text nodes, so dictionary or caption text can never inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
}
