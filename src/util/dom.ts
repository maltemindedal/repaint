/** Tiny DOM helpers. They provide enough structure to avoid string-concatenating HTML. */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * `el()` filled with a colour. The colour is set through the CSSOM, which takes
 * exactly one `<color>`. Interpolating it into a `style` attribute instead would
 * let an imported or hand-edited value carry more declarations with it
 * (`red;background-image:url(https://…)`), and the browser would honour them.
 */
export function colorEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  color: string,
  attrs: Attrs = {},
): HTMLElementTagNameMap[K] {
  const node = el(tag, attrs);
  node.style.backgroundColor = color;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

/** Like `requireElement`, but for a selector under a parent node. */
export function requireQuery<T extends HTMLElement>(parent: ParentNode, selector: string): T {
  const node = parent.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector} in index.html`);
  return node;
}

/** True when the user is typing, so global hotkeys should stand down. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * True for the auto-repeats of a held key. Shortcuts are one-shot actions, so
 * only a fresh press should trigger one. Tab and Backquote still have their
 * default (focus traversal, typing a backtick) suppressed on every repeat.
 */
export function ignoreKeyRepeat(event: KeyboardEvent): boolean {
  if (!event.repeat) return false;
  if (event.code === 'Tab' || event.code === 'Backquote') event.preventDefault();
  return true;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Opens a file picker and resolves with the chosen file (or null if cancelled). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
    document.body.appendChild(input);
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    // Fires when the picker is dismissed without a choice (Chrome 113+, Firefox 91+, Safari 16.4+).
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
