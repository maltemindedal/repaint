// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Sidebar, type SidebarCallbacks, type SidebarViewModel } from '../src/ui/Sidebar.ts';
import type { Scheme } from '../src/types.ts';

/**
 * The sidebar has one entry point — `render(viewModel)` — so its whole
 * behaviour is reachable from a plain object plus a DOM. These tests pin the
 * two properties the single entry point exists to guarantee: a render only
 * touches what actually changed (so it is safe on every pointermove of a
 * colour drag), and no call site has to know what order to do things in.
 */

function spyCallbacks() {
  return {
    onSelect: vi.fn(),
    onColorChange: vi.fn(),
    onResetTarget: vi.fn(),
    onResetAll: vi.fn(),
    onTagChange: vi.fn(),
    onOpenFile: vi.fn(),
    onSaveToLibrary: vi.fn(),
    onRemoveLibraryColor: vi.fn(),
    onRenameLibraryColor: vi.fn(),
    onApplyLibraryColor: vi.fn(),
    onApplyScheme: vi.fn(),
    onCaptureScheme: vi.fn(),
    onRenameScheme: vi.fn(),
    onExportData: vi.fn(),
    onImportData: vi.fn(),
    onScreenshot: vi.fn(),
  } satisfies SidebarCallbacks;
}

function viewModel(overrides: Partial<SidebarViewModel> = {}): SidebarViewModel {
  return {
    fileLabel: 'apartment.glb',
    targets: [],
    materials: [],
    library: [],
    schemes: { schemes: [], activeId: null },
    selectedKey: null,
    hoveredKey: null,
    ...overrides,
  };
}

function row(key: string, currentHex: string, originalHex = '#ffffff') {
  return { key, displayName: key.replace('PAINT_', ''), originalHex, currentHex };
}

function schemes(): Scheme[] {
  return [
    { id: 'slot-1', name: 'Warm', colors: { PAINT_North: '#111111' } },
    { id: 'slot-2', name: 'Cool', colors: {} },
  ];
}

function mount(vm: SidebarViewModel = viewModel()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const cb = spyCallbacks();
  const sidebar = new Sidebar(host, cb);
  sidebar.render(vm);

  const paintRow = (key: string) =>
    host.querySelector<HTMLElement>(`.paint-row[data-key="${key}"]`);
  return {
    sidebar,
    host,
    cb,
    paintRow,
    paintRows: () => [...host.querySelectorAll<HTMLElement>('.paint-row[data-key]')],
    // Scheme rows reuse the paint-row styling but carry no key.
    schemeRows: () => [...host.querySelectorAll<HTMLElement>('.paint-row:not([data-key])')],
    hexOf: (key: string) => paintRow(key)?.querySelector('.paint-sub')?.textContent,
    picker: () => host.querySelector<HTMLElement>('.picker'),
    hexInput: () => host.querySelector<HTMLInputElement>('.hex-input'),
    libraryNames: () => [...host.querySelectorAll<HTMLInputElement>('.lib-name')],
    schemeNames: () => [...host.querySelectorAll<HTMLInputElement>('input[name="scheme-name"]')],
  };
}

describe('Sidebar paint list', () => {
  it('draws a row per target, and names the file', () => {
    const ui = mount(
      viewModel({
        fileLabel: 'flat.glb',
        targets: [row('PAINT_North', '#111111'), row('PAINT_South', '#222222')],
      }),
    );

    expect(ui.paintRows().map((r) => r.dataset.key)).toEqual(['PAINT_North', 'PAINT_South']);
    expect(ui.hexOf('PAINT_North')).toBe('#111111');
    expect(ui.host.querySelector('.sb-file')?.textContent).toBe('flat.glb');
  });

  it('updates a changed colour in place rather than rebuilding the row', () => {
    const ui = mount(viewModel({ targets: [row('PAINT_North', '#111111')] }));
    const before = ui.paintRow('PAINT_North');

    ui.sidebar.render(viewModel({ targets: [row('PAINT_North', '#222222')] }));

    expect(ui.paintRow('PAINT_North')).toBe(before);
    expect(ui.hexOf('PAINT_North')).toBe('#222222');
  });

  it('rebuilds the list when the set of targets changes', () => {
    const ui = mount(viewModel({ targets: [row('PAINT_North', '#111111')] }));

    ui.sidebar.render(
      viewModel({ targets: [row('PAINT_North', '#111111'), row('PAINT_South', '#222222')] }),
    );

    expect(ui.paintRows().map((r) => r.dataset.key)).toEqual(['PAINT_North', 'PAINT_South']);
  });

  it('offers the tagging list when there is nothing to paint', () => {
    const ui = mount(viewModel({ targets: [] }));

    const materials = [...ui.host.querySelectorAll('.sb-section')].find(
      (s) => s.querySelector('h3')?.textContent === 'All materials',
    );
    expect(ui.host.querySelector('.sb-empty')).toBeTruthy();
    expect(materials?.classList.contains('collapsed')).toBe(false);
  });

  it('reports a row click as a selection, and a second click as a deselection', () => {
    const ui = mount(viewModel({ targets: [row('PAINT_North', '#111111')] }));

    ui.paintRow('PAINT_North')!.click();
    expect(ui.cb.onSelect).toHaveBeenCalledWith('PAINT_North');

    ui.sidebar.render(
      viewModel({ targets: [row('PAINT_North', '#111111')], selectedKey: 'PAINT_North' }),
    );
    ui.paintRow('PAINT_North')!.click();
    expect(ui.cb.onSelect).toHaveBeenLastCalledWith(null);
  });

  it('marks the hovered target', () => {
    const ui = mount(
      viewModel({
        targets: [row('PAINT_North', '#111111'), row('PAINT_South', '#222222')],
        hoveredKey: 'PAINT_South',
      }),
    );
    expect(ui.paintRow('PAINT_South')!.classList.contains('hovered-3d')).toBe(true);

    ui.sidebar.render(
      viewModel({
        targets: [row('PAINT_North', '#111111'), row('PAINT_South', '#222222')],
        hoveredKey: null,
      }),
    );
    expect(ui.paintRow('PAINT_South')!.classList.contains('hovered-3d')).toBe(false);
  });
});

describe('Sidebar colour picker', () => {
  const selected = (hex: string) =>
    viewModel({ targets: [row('PAINT_North', hex)], selectedKey: 'PAINT_North' });

  it('opens the picker under the selected row, and moves it with the selection', () => {
    const ui = mount(selected('#111111'));
    expect(ui.paintRow('PAINT_North')!.classList.contains('selected')).toBe(true);
    expect(ui.picker()).toBeTruthy();

    ui.sidebar.render(viewModel({ targets: [row('PAINT_North', '#111111')], selectedKey: null }));
    expect(ui.picker()).toBeNull();
  });

  it('survives a colour change — a rebuild mid-drag would tear it out', () => {
    const ui = mount(selected('#111111'));
    const before = ui.picker();

    ui.sidebar.render(selected('#222222'));

    expect(ui.picker()).toBe(before);
  });

  it('takes an externally applied colour without echoing it back to the app', () => {
    const ui = mount(selected('#111111'));
    expect(ui.hexInput()!.value).toBe('#111111'.toUpperCase());

    ui.sidebar.render(selected('#334455'));

    expect(ui.hexInput()!.value).toBe('#334455'.toUpperCase());
    expect(ui.cb.onColorChange).not.toHaveBeenCalled();
  });

  it('reports an edit and leaves the row to the render that answers it', () => {
    const ui = mount(selected('#111111'));

    ui.hexInput()!.value = '#334455';
    ui.hexInput()!.dispatchEvent(new Event('input'));

    expect(ui.cb.onColorChange).toHaveBeenCalledWith('PAINT_North', '#334455');
    // The sidebar never writes model state, not even the row it just edited.
    expect(ui.hexOf('PAINT_North')).toBe('#111111');
  });
});

describe('Sidebar schemes and library', () => {
  it('marks the active scheme, and lets go of it when the app clears it', () => {
    const ui = mount(viewModel({ schemes: { schemes: schemes(), activeId: 'slot-1' } }));
    expect(ui.schemeRows()[0].classList.contains('selected')).toBe(true);

    // Painting a wall clears the active scheme; the row must follow.
    ui.sidebar.render(viewModel({ schemes: { schemes: schemes(), activeId: null } }));

    expect(ui.schemeRows().some((r) => r.classList.contains('selected'))).toBe(false);
  });

  it('leaves an unchanged scheme list alone', () => {
    const ui = mount(viewModel({ schemes: { schemes: schemes(), activeId: 'slot-1' } }));
    const before = ui.schemeRows()[0];

    ui.sidebar.render(viewModel({ schemes: { schemes: schemes(), activeId: 'slot-1' } }));

    expect(ui.schemeRows()[0]).toBe(before);
  });

  it('takes a rename without rebuilding the row it came from', () => {
    const renamed = schemes();
    renamed[0].name = 'Warm white';
    const ui = mount(viewModel({ schemes: { schemes: schemes(), activeId: null } }));
    const before = ui.schemeNames()[0];

    ui.sidebar.render(viewModel({ schemes: { schemes: renamed, activeId: null } }));

    expect(ui.schemeNames()[0]).toBe(before);
    expect(before.value).toBe('Warm white');
  });

  it('does not type over a name field the user is still in', () => {
    const library = [
      { id: 'lib-1', name: 'Chalk', hex: '#f2f0eb' },
      { id: 'lib-2', name: 'Linen', hex: '#e8e4da' },
    ];
    const ui = mount(viewModel({ library }));
    const [first, second] = ui.libraryNames();

    // The first entry's rename is committed; the user has tabbed on and is
    // half-way through the second. Any render at all — a 3D hover is enough.
    library[0].name = 'Chalk white';
    second.focus();
    second.value = 'Linen w';

    ui.sidebar.render(viewModel({ library, hoveredKey: 'PAINT_North' }));

    expect(ui.libraryNames()).toEqual([first, second]);
    expect(first.value).toBe('Chalk white');
    expect(second.value).toBe('Linen w');
    expect(document.activeElement).toBe(second);
  });

  it('focuses a freshly saved library entry, whichever order the app asks in', () => {
    const library = [{ id: 'lib-1', name: 'Chalk', hex: '#f2f0eb' }];

    const before = mount();
    before.sidebar.focusLibraryEntry('lib-1');
    before.sidebar.render(viewModel({ library }));
    expect(document.activeElement).toBe(before.libraryNames()[0]);

    const after = mount();
    after.sidebar.render(viewModel({ library }));
    after.sidebar.focusLibraryEntry('lib-1');
    expect(document.activeElement).toBe(after.libraryNames()[0]);
  });

  it('lists materials for tagging and reports a tick', () => {
    const ui = mount(
      viewModel({
        materials: [
          { name: 'PAINT_North', isPaintable: true, auto: true, hasColorMap: false, meshCount: 1 },
          { name: 'Floor_Oak', isPaintable: false, auto: false, hasColorMap: true, meshCount: 2 },
        ],
      }),
    );

    const boxes = [...ui.host.querySelectorAll<HTMLInputElement>('.mat-row input')];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);

    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    expect(ui.cb.onTagChange).toHaveBeenCalledWith('Floor_Oak', true);
  });
});
