import { el, clear } from '../util/dom.ts';
import { ColorPicker } from './ColorPicker.ts';
import { miniSwatches } from './swatches.ts';
import type { LibraryColor, MaterialInfo, Scheme } from '../types.ts';

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

/**
 * One row of the paint list.
 *
 * Plain data, never a live `PaintTarget`: the registry mutates those in place,
 * so a sidebar holding on to one would be comparing an object against itself
 * and would never see a colour change. Rebuilt per render by the caller.
 */
export interface PaintRow {
  key: string;
  displayName: string;
  originalHex: string;
  currentHex: string;
}

/** Everything the sidebar draws. */
export interface SidebarViewModel {
  fileLabel: string;
  targets: PaintRow[];
  materials: MaterialInfo[];
  library: LibraryColor[];
  schemes: Scheme[];
  activeId: string | null;
  selectedKey: string | null;
  hoveredKey: string | null;
}

interface RowRefs {
  row: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  hex: HTMLElement;
  reset: HTMLButtonElement;
  holder: HTMLElement;
  /** What this row was last drawn from, to diff the next view model against. */
  data: PaintRow;
}

/**
 * The right-hand panel: paintable walls, manual material tagging, the colour
 * library, scheme slots and data import/export.
 *
 * One entry point — `render(viewModel)`. It diffs the model against what is on
 * screen and touches only what moved, so it is cheap enough for every
 * pointermove of a colour drag: a changed colour rewrites two nodes instead of
 * rebuilding the tree and tearing the open picker out from under the pointer.
 *
 * Data flows one way. The sidebar never writes model state — not even the row
 * whose picker the user is dragging. It reports through the callbacks and
 * redraws when the app renders the change back, so no call site has to know
 * which half of an update is already done.
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
  /** Row order on screen; null until the first render. */
  private order: string[] | null = null;
  private libraryInputs = new Map<string, HTMLInputElement>();
  private schemeInputs = new Map<string, HTMLInputElement>();
  private pendingLibraryFocus: string | null = null;

  private picker: ColorPicker | null = null;
  private pickerKey: string | null = null;
  /** The hex the picker is showing, so a render doesn't fight an active drag. */
  private pickerHex: string | null = null;

  private library: LibraryColor[] = [];
  private selectedKey: string | null = null;
  private hoveredKey: string | null = null;

  // Sections whose contents come from the store are rebuilt wholesale, and the
  // store hands back the same objects every render — renaming a scheme edits
  // the very object the last render saw. So they diff against a snapshot of
  // their own contents rather than against the reference they were given. A
  // name is left out of the snapshot and written in place instead: it is the
  // one field the user edits directly, and rebuilding around a live caret
  // would drop them out of the field they are typing in.
  private labelSig: string | null = null;
  private schemesSig: string | null = null;
  private librarySig: string | null = null;
  private materialsSig: string | null = null;

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

  /**
   * Draw the panel. Idempotent: rendering the same view model twice is a
   * handful of string comparisons and no DOM work at all.
   */
  render(vm: SidebarViewModel): void {
    // Held for the picker, which is built and refreshed from several passes below.
    this.library = vm.library;

    this.syncFileLabel(vm.fileLabel);
    const rebuilt = this.syncPaintRows(vm.targets);
    this.syncSelection(vm.selectedKey, rebuilt);
    this.syncHover(vm.hoveredKey);
    this.syncPickerHex(vm.targets);
    this.syncSchemes(vm.schemes, vm.activeId);
    this.syncLibrary(vm.library);
    this.syncMaterials(vm.materials);
  }

  /**
   * Focus the name field of a freshly saved colour, so you can type its name.
   * Order-independent: if the entry isn't drawn yet, the render that draws it
   * takes the focus instead.
   */
  focusLibraryEntry(id: string): void {
    this.pendingLibraryFocus = id;
    this.applyLibraryFocus();
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

  private syncFileLabel(label: string): void {
    if (label === this.labelSig) return;
    this.labelSig = label;
    this.fileLabel.textContent = label;
    this.fileLabel.title = label;
  }

  // ----------------------------------------------------------- paint list

  /** Returns true when the rows were rebuilt, i.e. every ref is now fresh. */
  private syncPaintRows(targets: PaintRow[]): boolean {
    if (this.order && sameKeys(this.order, targets)) {
      for (const target of targets) this.updateRow(target);
      return false;
    }
    this.buildPaintRows(targets);
    return true;
  }

  private updateRow(next: PaintRow): void {
    const refs = this.rows.get(next.key);
    if (!refs) return;
    const previous = refs.data;
    refs.data = next;

    if (previous.currentHex !== next.currentHex) {
      refs.swatch.style.background = next.currentHex;
      refs.hex.textContent = next.currentHex;
    }
    if (previous.displayName !== next.displayName) refs.name.textContent = next.displayName;
    if (previous.originalHex !== next.originalHex) refs.reset.title = resetTitle(next.originalHex);
  }

  private buildPaintRows(targets: PaintRow[]): void {
    this.closePicker();
    this.rows.clear();
    this.order = targets.map((target) => target.key);
    // Nothing in the fresh DOM carries these yet; the passes after this one
    // put them back.
    this.selectedKey = null;
    this.hoveredKey = null;

    clear(this.paintBody);
    this.paintCount.textContent = String(targets.length);

    if (targets.length === 0) {
      this.paintBody.appendChild(
        el('div', { class: 'sb-empty' }, [
          el('span', {
            html: 'No <code>PAINT_</code> materials found. Open <b>All materials</b> below and tick the ones you want to repaint — the choice is remembered for this file.',
          }),
        ]),
      );
      this.materialsSection.classList.remove('collapsed');
      return;
    }

    for (const target of targets) {
      const swatch = el('div', { class: 'swatch', style: `background:${target.currentHex}` });
      const name = el('div', { class: 'paint-name', text: target.displayName, title: target.key });
      const hex = el('div', { class: 'paint-sub', text: target.currentHex });
      const holder = el('div');

      const reset = el('button', {
        class: 'btn ghost',
        text: '↺',
        title: resetTitle(target.originalHex),
        onclick: (event: Event) => {
          event.stopPropagation();
          this.cb.onResetTarget(target.key);
        },
      });

      const row = el('div', { class: 'paint-row', 'data-key': target.key }, [
        swatch,
        el('div', { class: 'paint-meta' }, [name, hex]),
        el('div', { class: 'actions' }, [reset]),
      ]);

      row.addEventListener('click', () => {
        this.cb.onSelect(this.selectedKey === target.key ? null : target.key);
      });

      this.paintBody.append(row, holder);
      this.rows.set(target.key, { row, swatch, name, hex, reset, holder, data: target });
    }
  }

  // ------------------------------------------------------- selection/hover

  private syncSelection(key: string | null, rebuilt: boolean): void {
    if (key === this.selectedKey) return;

    if (this.selectedKey) this.rows.get(this.selectedKey)?.row.classList.remove('selected');
    this.selectedKey = key;
    this.closePicker();

    const refs = key ? this.rows.get(key) : undefined;
    if (!refs) return;
    refs.row.classList.add('selected');
    // Scroll for a selection the user just made, not for one carried across a
    // rebuild — that would yank the panel on every re-discovery.
    this.openPicker(refs, !rebuilt);
  }

  private syncHover(key: string | null): void {
    if (key === this.hoveredKey) return;
    if (this.hoveredKey) this.rows.get(this.hoveredKey)?.row.classList.remove('hovered-3d');
    this.hoveredKey = key;
    if (key) this.rows.get(key)?.row.classList.add('hovered-3d');
  }

  private openPicker(refs: RowRefs, scroll: boolean): void {
    const { key, currentHex, originalHex } = refs.data;
    this.pickerKey = key;
    this.pickerHex = currentHex;
    this.picker = new ColorPicker({
      hex: currentHex,
      originalHex,
      library: this.library,
      onChange: (hex) => {
        this.pickerHex = hex;
        this.cb.onColorChange(key, hex);
      },
      onSaveToLibrary: (hex) => this.cb.onSaveToLibrary(hex),
      onReset: () => this.cb.onResetTarget(key),
    });
    refs.holder.appendChild(this.picker.element);
    if (scroll) refs.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private closePicker(): void {
    if (this.pickerKey) {
      const refs = this.rows.get(this.pickerKey);
      if (refs) clear(refs.holder);
    }
    this.picker = null;
    this.pickerKey = null;
    this.pickerHex = null;
  }

  /**
   * Push a colour the picker didn't produce — a scheme, a library click, a
   * reset. Skipped when the hex is the one the picker last emitted, so a drag
   * never has its own value round-tripped back through hex → HSV, which would
   * lose the hue you are holding at zero saturation.
   */
  private syncPickerHex(targets: PaintRow[]): void {
    if (!this.picker) return;
    const hex = targets.find((target) => target.key === this.pickerKey)?.currentHex;
    if (!hex || hex === this.pickerHex) return;
    this.pickerHex = hex;
    this.picker.showHex(hex);
  }

  // ------------------------------------------------------------- schemes

  private syncSchemes(schemes: Scheme[], activeId: string | null): void {
    const signature = JSON.stringify([activeId, schemes.map((s) => [s.id, s.colors])]);
    if (signature === this.schemesSig) {
      writeNames(this.schemeInputs, schemes);
      return;
    }
    this.schemesSig = signature;
    this.schemeInputs.clear();

    clear(this.schemesBody);
    schemes.forEach((scheme, index) => {
      const colors = Object.values(scheme.colors);
      const nameInput = renameInput('scheme-name', scheme.name, (value) =>
        this.cb.onRenameScheme(scheme.id, value),
      );
      this.schemeInputs.set(scheme.id, nameInput);

      const row = el('div', { class: `paint-row${scheme.id === activeId ? ' selected' : ''}` }, [
        miniSwatches(colors, 5),
        el('div', { class: 'paint-meta' }, [
          nameInput,
          el('div', {
            class: 'paint-sub',
            text:
              index < 3
                ? `key ${index + 1} · ${colors.length} colours`
                : `${colors.length} colours`,
          }),
        ]),
      ]);

      const actions = el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'btn',
          text: 'Apply',
          disabled: colors.length === 0,
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

  private syncLibrary(library: LibraryColor[]): void {
    const signature = JSON.stringify(library.map((entry) => [entry.id, entry.hex]));
    if (signature === this.librarySig) {
      writeNames(this.libraryInputs, library);
    } else {
      this.librarySig = signature;
      this.picker?.renderLibrary(library);
      this.buildLibrary(library);
    }
    this.applyLibraryFocus();
  }

  private buildLibrary(library: LibraryColor[]): void {
    this.libraryInputs.clear();
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
      this.libraryInputs.set(entry.id, nameInput);

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
    }
    this.libraryBody.appendChild(list);
  }

  private applyLibraryFocus(): void {
    if (!this.pendingLibraryFocus) return;
    const input = this.libraryInputs.get(this.pendingLibraryFocus);
    if (!input) return;
    this.pendingLibraryFocus = null;
    input.focus();
    input.select();
  }

  // ------------------------------------------------------------- tagging

  private syncMaterials(materials: MaterialInfo[]): void {
    const signature = JSON.stringify(materials);
    if (signature === this.materialsSig) return;
    this.materialsSig = signature;

    clear(this.materialsBody);
    if (materials.length === 0) {
      this.materialsBody.appendChild(
        el('div', { class: 'sb-empty', text: 'No materials in the scene.' }),
      );
      return;
    }

    this.materialsBody.appendChild(
      el('div', {
        class: 'sb-empty',
        html: 'Tick a material to make it repaintable. Tagging is stored per file name, so it survives a reload but not a rename.',
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
}

/** Renamed elsewhere (an import, another view) — but never under a live caret. */
function writeNames(
  inputs: Map<string, HTMLInputElement>,
  entries: { id: string; name: string }[],
): void {
  for (const entry of entries) {
    const input = inputs.get(entry.id);
    if (!input || input === input.ownerDocument.activeElement) continue;
    if (input.value !== entry.name) input.value = entry.name;
  }
}

function sameKeys(order: string[], targets: PaintRow[]): boolean {
  return order.length === targets.length && targets.every((target, i) => target.key === order[i]);
}

function resetTitle(originalHex: string): string {
  return `Reset to exported colour (${originalHex.toUpperCase()})`;
}

/** Editable name field: commits on change, Enter blurs, keys never leak to hotkeys. */
function renameInput(
  name: string,
  value: string,
  onCommit: (value: string) => void,
): HTMLInputElement {
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
