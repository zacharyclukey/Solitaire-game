/** Minimal DOM helpers — enough structure to stay readable without a framework. */

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'style' || k === 'role' || k.startsWith('data-') || k.startsWith('aria-')) {
      node.setAttribute(k, String(v));
    } else if (k in node) {
      (node as any)[k] = v;
    } else {
      // e.g. `for`, whose DOM property is spelled htmlFor
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const found = root.querySelector(sel);
  if (!found) throw new Error(`missing element: ${sel}`);
  return found as unknown as T;
}

export function on<K extends keyof HTMLElementEventMap>(
  node: Element | Window | Document,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void {
  node.addEventListener(type, handler as EventListener, opts);
  return () => node.removeEventListener(type, handler as EventListener, opts);
}

/** A button that feels right on touch: no 300ms delay, no text selection. */
export function button(label: string, cls: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', { class: cls, type: 'button' }, [label]);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onTap();
  });
  return b;
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
