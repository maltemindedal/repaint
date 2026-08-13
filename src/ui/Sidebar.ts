import { el, clear } from '../util/dom.ts';
import { ColorPicker } from './ColorPicker.ts';
import { miniSwatches } from './swatches.ts';
import type { LibraryColor, MaterialInfo, PaintTarget, SchemeView } from '../types.ts';

export interface SidebarCallbacks {
  onSelect: (key: string | null) => void;
  onColorChange: (key: string, hex: string) => void;
  onResetTarget: (key: string) => void;
  onResetAll: () => void;
  onTagChange: (materialName: string, tagged: boolean) => void;
  onOpenFile: () => void;
  onSaveToLibrary: (hex: string) => void;
  onRemoveLibraryColor: (id: string) => void;
  onRenameLibraryColor: (id: string, name: string) => void;
  onApplyLibraryColor: (id: string) => void;
  onApplyScheme: (id: string) => void;
  onCaptureScheme: (id: string) => void;
  onRenameScheme: (id: string, name: string) => void;
  onExportData: () => void;
  onImportData: () => void;
  onScreenshot: () => void;
}

interface RowRefs {
  row: HTMLElement;
  swatch: HTMLElement;
  hex: HTMLElement;
  holder: HTMLElement;
}

/**
 * The right-hand panel: paintable walls, manual material tagging, the colour
 * library, scheme slots and data import/export.
 *
 * Colour edits update only the affected row rather than re-rendering the tree —
 * a full rebuild mid-drag would tear the open picker out from under the pointer.
 */
export class Sidebar {
  private root: HTMLElement;
  private body: HTMLElement;
  private fileLabel: HTMLElement;

  private paintBody = el('div', { class: 'sb-section-body' });
  private paintCount = el('span', { class: 'count' });
  private materialsBody = el('div', { class: 'sb-section-body' });
  private materialsSection: HTMLElement;
  private libraryBody = el('div', { class: 'sb-section-body' });
  private schemesBody = el('div', { class: 'sb-section-body' });

  private rows = new Map<string, RowRefs>();
  private targets: PaintTarget[] = [];
  private library: LibraryColor[] = [];
  private picker: ColorPicker | null = null;
  private selectedKey: string | null = null;
  private pendingLibraryFocus: string | null = null;

  constructor(
    container: HTMLElement,
    private cb: SidebarCallbacks,
  ) {
    this.root = container;
    this.fileLabel = el('div', { class: 'sb-file', text: '—' });

    const head = el('div', { class: 'sb-head' }, [
      el('div', { class: 'sb-title', text: 'Repaint' }),
      this.fileLabel,
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'btn', text: 'Open .glb', onclick: () => this.cb.onOpenFile() }),
        el('button', {
          class: 'btn',
          text: 'Screenshot',
          title: 'Save a 2× PNG of the current view (P)',
          onclick: () => this.cb.onScreenshot(),
        }),
      ]),
    ]);

    const paintSection = section('Walls', this.paintBody, this.paintCount, false);
    this.materialsSection = section('All materials', this.materialsBody, undefined, true);
    const schemeSection = section('Schemes', this.schemesBody, undefined, false);
    const librarySection = section('Colour library', this.libraryBody, undefined, false);

    this.body = el('div', { class: 'sb-body' }, [
      paintSection,
      schemeSection,
      librarySection,
      this.materialsSection,
      this.dataSection(),
    ]);

    clear(this.root);
    this.root.append(head, this.body);
  }

  // ------------------------------------------------------------- sections

  private dataSection(): HTMLElement {
    const body = el('div', { class: 'sb-section-body' }, [
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'btn', text: 'Export JSON', onclick: () => this.cb.onExportData() }),
        el('button', { class: 'btn', text: 'Import JSON', onclick: () => this.cb.onImportData() }),
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'btn danger',
          text: 'Reset all walls',
          title: 'Every wall back to its exported colour',
          onclick: () => this.cb.onResetAll(),
        }),
      ]),
    ]);
    return section('Data', body, undefined, true);
  }

  setFileLabel(label: string): void {
    this.fileLabel.textContent = label;
    this.fileLabel.title = label;
  }

  // ----------------------------------------------------------- paint list

  renderPaintTargets(targets: PaintTarget[], library: LibraryColor[]): void {
    this.targets = targets;
    this.library = library;
    this.rows.clear();
    this.picker = null;
    clear(this.paintBody);
    this.paintCount.textContent = String(targets.length);

    if (targets.length === 0) {
      this.paintBody.appendChild(
        el('div', { class: 'sb-empty' }, [
          el('span', {
            html:
              'No <code>PAINT_</code> materials found. Open <b>All materials</b> below and tick the ones you want to repaint — the choice is remembered for this file.',
          }),
        ]),
      );
      this.materialsSection.classList.remove('collapsed');
      return;
    }

    for (const target of targets) {
      const swatch = el('div', { class: 'swatch', style: `background:${target.currentHex}` });
      const hex = el('div', { class: 'paint-sub', text: target.currentHex });
      const holder = el('div');

      const row = el('div', { class: 'paint-row', 'data-key': target.key }, [
        swatch,
        el('div', { class: 'paint-meta' }, [
          el('div', { class: 'paint-name', text: target.displayName, title: target.key }),
          hex,
        ]),
        el('div', { class: 'actions' }, [
          el('button', {
            class: 'btn ghost',
            text: '↺',
            title: `Reset to exported colour (${target.originalHex.toUpperCase()})`,
            onclick: (event: Event) => {
              event.stopPropagation();
              this.cb.onResetTarget(target.key);
            },
          }),
        ]),
      ]);

      row.addEventListener('click', () => {
        this.cb.onSelect(this.selectedKey === target.key ? null : target.key);
      });

      this.paintBody.append(row, holder);
      this.rows.set(target.key, { row, swatch, hex, holder });
    }

    if (this.selectedKey && this.rows.has(this.selectedKey)) {
      this.openPicker(this.selectedKey, false);
    }
  }

  /**
   * Cheap targeted DOM update — safe to call on every pointermove of the
   * picker. Deliberately does NOT touch `target.currentHex`: PaintRegistry is
   * the sole writer of model state, and the rows hold the same PaintTarget
   * references the registry mutates.
   */
  updateTarget(key: string, hex: string): void {
    const refs = this.rows.get(key);
    if (!refs) return;
    refs.swatch.style.background = hex;
    refs.hex.textContent = hex;
  }

  setSelected(key: string | null, scroll = true): void {
    if (this.selectedKey === key) return;
    this.selectedKey = key;
    for (const [rowKey, refs] of this.rows) {
      refs.row.classList.toggle('selected', rowKey === key);
      if (rowKey !== key) clear(refs.holder);
    }
    this.picker = null;
    if (key) this.openPicker(key, scroll);
  }

  setHovered(key: string | null): void {
    for (const [rowKey, refs] of this.rows) {
      refs.row.classList.toggle('hovered-3d', rowKey === key);
    }
  }

  private openPicker(key: string, scroll: boolean): void {
    const refs = this.rows.get(key);
    const target = this.targets.find((t) => t.key === key);
    if (!refs || !target) return;

    clear(refs.holder);
    this.picker = new ColorPicker({
      hex: target.currentHex,
      originalHex: target.originalHex,
      library: this.library,
      onChange: (hex) => {
        this.updateTarget(key, hex);
        this.cb.onColorChange(key, hex);
      },
      onSaveToLibrary: (hex) => this.cb.onSaveToLibrary(hex),
      onReset: () => this.cb.onResetTarget(key),
    });
    refs.holder.appendChild(this.picker.element);
    if (scroll) refs.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Pushes an externally-applied colour (scheme switch, library click) into the open picker. */
  syncPicker(hex: string): void {
    this.picker?.setHex(hex);
  }

  // ------------------------------------------------------------- tagging

  renderMaterials(materials: MaterialInfo[]): void {
    clear(this.materialsBody);
    if (materials.length === 0) {
      this.materialsBody.appendChild(el('div', { class: 'sb-empty', text: 'No materials in the scene.' }));
      return;
    }

    this.materialsBody.appendChild(
      el('div', {
        class: 'sb-empty',
        html:
          'Tick a material to make it repaintable. Tagging is stored per file name, so it survives a reload but not a rename.',
      }),
    );

    for (const info of materials) {
      const checkbox = el('input', { type: 'checkbox', name: `tag-${info.name}` });
      checkbox.checked = info.isPaintable;
      checkbox.addEventListener('change', () => this.cb.onTagChange(info.name, checkbox.checked));

      const flags: string[] = [];
      if (info.auto) flags.push('PAINT_');
      if (info.hasColorMap) flags.push('has texture');
      if (info.meshCount > 1) flags.push(`${info.meshCount} meshes`);

      this.materialsBody.appendChild(
        el('div', { class: 'mat-row' }, [
          el('label', {}, [
            checkbox,
            el('span', { class: 'mat-name', text: info.name, title: info.name }),
          ]),
          flags.length ? el('span', { class: 'mat-flag', text: flags.join(' · ') }) : null,
        ]),
      );
    }
  }

  // ------------------------------------------------------------- schemes

  renderSchemes({ schemes, activeId }: SchemeView): void {
    clear(this.schemesBody);
    schemes.forEach((scheme, index) => {
      const colors = Object.values(scheme.colors);
      const nameInput = renameInput('scheme-name', scheme.name, (value) =>
        this.cb.onRenameScheme(scheme.id, value),
      );

      const row = el('div', { class: `paint-row${scheme.id === activeId ? ' selected' : ''}` }, [
        miniSwatches(colors, 5),
        el('div', { class: 'paint-meta' }, [
          nameInput,
          el('div', {
            class: 'paint-sub',
            text: index < 3 ? `key ${index + 1} · ${colors.length} colours` : `${colors.length} colours`,
          }),
        ]),
      ]);

      const actions = el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'btn',
          text: 'Apply',
          disabled: Object.keys(scheme.colors).length === 0,
          onclick: () => this.cb.onApplyScheme(scheme.id),
        }),
        el('button', {
          class: 'btn',
          text: 'Save current',
          title: 'Store every wall colour into this slot',
          onclick: () => this.cb.onCaptureScheme(scheme.id),
        }),
      ]);

      this.schemesBody.append(row, actions);
    });
  }

  // ------------------------------------------------------------- library

  renderLibrary(library: LibraryColor[]): void {
    this.library = library;
    this.picker?.renderLibrary(library);
    clear(this.libraryBody);

    if (library.length === 0) {
      this.libraryBody.appendChild(
        el('div', {
          class: 'sb-empty',
          text: 'Empty. Pick a colour on a wall and press “Save…” to name and keep it.',
        }),
      );
      return;
    }

    const list = el('div', { class: 'lib-list' });
    for (const entry of library) {
      const nameInput = renameInput('library-name', entry.name, (value) =>
        this.cb.onRenameLibraryColor(entry.id, value),
      );
      nameInput.classList.add('lib-name');

      list.appendChild(
        el('div', { class: 'lib-item' }, [
          el('div', {
            class: 'swatch',
            style: `background:${entry.hex}`,
            title: `Apply ${entry.hex.toUpperCase()} to the selected wall`,
            onclick: () => this.cb.onApplyLibraryColor(entry.id),
          }),
          nameInput,
          el('span', { class: 'lib-hex', text: entry.hex }),
          el('div', { class: 'actions' }, [
            el('button', {
              class: 'btn ghost danger',
              text: '×',
              title: 'Remove from library',
              onclick: () => this.cb.onRemoveLibraryColor(entry.id),
            }),
          ]),
        ]),
      );

      if (this.pendingLibraryFocus === entry.id) {
        this.pendingLibraryFocus = null;
        queueMicrotask(() => {
          nameInput.focus();
          nameInput.select();
        });
      }
    }
    this.libraryBody.appendChild(list);
  }

  /** Focus the name field of a freshly saved colour, so you can type its name. */
  focusLibraryEntry(id: string): void {
    this.pendingLibraryFocus = id;
  }
}

/** Editable name field: commits on change, Enter blurs, keys never leak to hotkeys. */
function renameInput(name: string, value: string, onCommit: (value: string) => void): HTMLInputElement {
  const input = el('input', { class: 'text-input', name, value });
  input.addEventListener('change', () => onCommit(input.value));
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if ((event as KeyboardEvent).key === 'Enter') input.blur();
  });
  return input;
}

function section(
  title: string,
  body: HTMLElement,
  countNode: HTMLElement | undefined,
  collapsed: boolean,
): HTMLElement {
  const chev = el('span', { class: 'chev', text: '▼' });
  const head = el('div', { class: 'sb-section-head' }, [
    chev,
    el('h3', { text: title }),
    countNode ?? null,
  ]);
  const wrapper = el('div', { class: `sb-section${collapsed ? ' collapsed' : ''}` }, [head, body]);
  head.addEventListener('click', () => wrapper.classList.toggle('collapsed'));
  return wrapper;
}
