import { el } from '../util/dom.ts';
import { extractHex, hexToHsv, hsvToHex, normalizeHex, type HSV } from '../util/color.ts';
import type { LibraryColor } from '../types.ts';

export interface ColorPickerOptions {
  hex: string;
  exportedHex: string;
  library: LibraryColor[];
  /** Fires continuously while dragging — cheap, it's one uniform write. */
  onChange: (hex: string) => void;
  onSaveToLibrary: (hex: string) => void;
  onReset: () => void;
}

/**
 * Compact HSV picker with a hex field.
 *
 * A custom picker rather than `<input type="color">` on purpose: this workflow
 * is "paste a manufacturer hex, compare against the library", and the native
 * macOS colour panel is a modal detour that makes A/B flipping painful.
 */
export class ColorPicker {
  readonly element: HTMLElement;

  private hsv: HSV;
  private sv: HTMLElement;
  private svCursor: HTMLElement;
  private hue: HTMLElement;
  private hueCursor: HTMLElement;
  private hexInput: HTMLInputElement;
  private libRow: HTMLElement;

  constructor(private options: ColorPickerOptions) {
    this.hsv = hexToHsv(options.hex);

    this.svCursor = el('div', { class: 'picker-cursor' });
    this.sv = el('div', { class: 'picker-sv' }, [
      el('div', { class: 'sat' }),
      el('div', { class: 'val' }),
      this.svCursor,
    ]);

    this.hueCursor = el('div', { class: 'picker-hue-cursor' });
    this.hue = el('div', { class: 'picker-hue' }, [this.hueCursor]);

    this.hexInput = el('input', {
      class: 'hex-input',
      type: 'text',
      name: 'hex',
      spellcheck: 'false',
      'aria-label': 'Hex colour',
    });

    const saveBtn = el('button', {
      class: 'btn',
      text: 'Save…',
      title: 'Add this colour to the library',
      onclick: () => this.options.onSaveToLibrary(this.currentHex()),
    });

    const resetBtn = el('button', {
      class: 'btn',
      text: 'Reset',
      title: `Back to the exported colour (${options.exportedHex.toUpperCase()})`,
      onclick: () => this.options.onReset(),
    });

    this.libRow = el('div', { class: 'picker-lib' });

    this.element = el('div', { class: 'picker' }, [
      this.sv,
      this.hue,
      el('div', { class: 'picker-row' }, [this.hexInput, saveBtn, resetBtn]),
      this.libRow,
      el('div', {
        class: 'picker-hint',
        text: 'Paste any text containing a hex — “Alcro Lammull #E8E4DA” works.',
      }),
    ]);

    this.bind();
    this.renderLibrary(options.library);
    this.sync();
  }

  private currentHex(): string {
    return hsvToHex(this.hsv);
  }

  private bind(): void {
    bindNormalizedDrag(this.sv, (x, y) => {
      this.hsv.s = x;
      this.hsv.v = 1 - y;
      this.sync(true);
    });

    bindNormalizedDrag(this.hue, (x) => {
      this.hsv.h = x * 360;
      this.sync(true);
    });

    this.hexInput.addEventListener('input', () => {
      const parsed = normalizeHex(this.hexInput.value);
      this.hexInput.classList.toggle('invalid', this.hexInput.value.length > 0 && !parsed);
      if (!parsed) return;
      this.hsv = hexToHsv(parsed);
      this.sync(true, /* keepInput */ true);
    });

    // Pasting a whole product name is the common case.
    this.hexInput.addEventListener('paste', (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? '';
      const parsed = extractHex(text);
      if (!parsed) return;
      event.preventDefault();
      this.hsv = hexToHsv(parsed);
      this.sync(true);
    });

    this.hexInput.addEventListener('blur', () => {
      this.hexInput.classList.remove('invalid');
      this.sync();
    });

    this.hexInput.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') this.hexInput.blur();
      event.stopPropagation();
    });
  }

  renderLibrary(library: LibraryColor[]): void {
    this.libRow.replaceChildren();
    if (library.length === 0) {
      this.libRow.appendChild(
        el('div', { class: 'picker-hint', text: 'Library is empty — “Save…” adds this colour.' }),
      );
      return;
    }
    for (const entry of library.slice(0, 40)) {
      this.libRow.appendChild(
        el('button', {
          class: 'chip',
          style: `background:${entry.hex}`,
          title: `${entry.name} · ${entry.hex.toUpperCase()}`,
          onclick: () => this.pick(entry.hex),
        }),
      );
    }
  }

  /**
   * Shows a colour that has already been applied elsewhere — a scheme, the
   * sidebar library, a reset. Silent on purpose: notifying here would push the
   * change back into the paint fan-out that produced it, which at best re-does
   * the write and at worst clears the scheme selection that caused it.
   */
  showHex(hex: string): void {
    const parsed = normalizeHex(hex);
    if (!parsed || parsed === this.currentHex()) return;
    this.hsv = hexToHsv(parsed);
    this.sync();
  }

  /** A colour chosen *inside* the picker — applies it and tells the app. */
  private pick(hex: string): void {
    const parsed = normalizeHex(hex);
    if (!parsed) return;
    this.hsv = hexToHsv(parsed);
    this.sync(true);
  }

  private sync(notify = false, keepInput = false): void {
    const hex = this.currentHex();
    const hueHex = hsvToHex({ h: this.hsv.h, s: 1, v: 1 });

    this.sv.style.background = hueHex;
    this.svCursor.style.left = `${this.hsv.s * 100}%`;
    this.svCursor.style.top = `${(1 - this.hsv.v) * 100}%`;
    this.svCursor.style.background = hex;
    this.hueCursor.style.left = `${(this.hsv.h / 360) * 100}%`;
    this.hueCursor.style.background = hueHex;

    if (!keepInput) this.hexInput.value = hex.toUpperCase();
    if (notify) this.options.onChange(hex);
  }
}

/** Normalised (0..1) pointer drag over an element. */
function bindNormalizedDrag(node: HTMLElement, onMove: (x: number, y: number) => void): void {
  const emit = (event: PointerEvent) => {
    const rect = node.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    onMove(x, y);
  };

  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    emit(event);

    const move = (e: PointerEvent) => emit(e);
    const up = (e: PointerEvent) => {
      node.releasePointerCapture(e.pointerId);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
}
