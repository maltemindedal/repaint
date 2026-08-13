import { describe, expect, it } from 'vitest';
import { createFallbackScene } from '../src/core/fallbackScene.ts';
import { PaintRegistry } from '../src/core/PaintRegistry.ts';
import { AppStore } from '../src/state/store.ts';
import { emptyData } from '../src/state/storage.ts';
import { sidebarViewModel, type SidebarSources } from '../src/sidebarViewModel.ts';
import type { LoadedScene } from '../src/types.ts';

/**
 * No DOM anywhere in this file — that is the point. What the sidebar should be
 * showing is a plain object, so it can be asserted directly, in node, without
 * building a panel to read the answer back out of.
 */

function sources(overrides: Partial<SidebarSources> = {}): SidebarSources {
  const root = createFallbackScene();
  const registry = new PaintRegistry();
  registry.discover(root);
  const store = new AppStore(emptyData());
  store.useScene('apartment.glb');
  return {
    scene: { label: 'apartment.glb' } as LoadedScene,
    registry,
    store,
    selectedKey: null,
    hoveredKey: null,
    ...overrides,
  };
}

describe('sidebar view model', () => {
  it('is plain data — nothing from three.js leaks into it', () => {
    const vm = sidebarViewModel(sources());

    // A structural clone that comes back equal proves there is no Material,
    // Mesh or Object3D hiding in here.
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
    expect(vm.targets.length).toBeGreaterThan(0);
    expect(Object.keys(vm.targets[0]).toSorted()).toEqual([
      'currentHex',
      'displayName',
      'key',
      'originalHex',
    ]);
  });

  it('snapshots paint targets instead of handing over the live ones', () => {
    const input = sources();
    const before = sidebarViewModel(input);
    const north = before.targets.find((t) => t.key === 'PAINT_Living_North')!;
    const originalHex = north.currentHex;

    input.registry.setColor('PAINT_Living_North', '#3a7fd5');

    // The registry mutates its targets in place. If the view model handed
    // those out, this row would have changed underneath the sidebar's diff and
    // a repaint would be invisible to it.
    expect(north.currentHex).toBe(originalHex);
    const after = sidebarViewModel(input);
    expect(after.targets.find((t) => t.key === 'PAINT_Living_North')!.currentHex).toBe('#3a7fd5');
  });

  it('names the loaded file, and falls back before one is open', () => {
    expect(sidebarViewModel(sources()).fileLabel).toBe('apartment.glb');
    expect(sidebarViewModel(sources({ scene: null })).fileLabel).toBe('—');
  });

  it('carries the scheme slots and the live one as a single view', () => {
    const input = sources();
    input.store.saveScheme('slot-2', { PAINT_Living_North: '#e8e4da' });
    input.store.setActiveScheme('slot-2');

    const { schemes } = sidebarViewModel(input);

    // One object, so the sidebar and the toolbar cannot disagree about it.
    expect(schemes.activeId).toBe('slot-2');
    expect(schemes.schemes.map((s) => s.id)).toEqual(['slot-1', 'slot-2', 'slot-3']);
    expect(schemes.schemes[1].colors).toEqual({ PAINT_Living_North: '#e8e4da' });
  });

  it('passes selection and hover through untouched', () => {
    const vm = sidebarViewModel(
      sources({ selectedKey: 'PAINT_Living_East', hoveredKey: 'PAINT_Ceiling' }),
    );
    expect(vm.selectedKey).toBe('PAINT_Living_East');
    expect(vm.hoveredKey).toBe('PAINT_Ceiling');
  });

  it('lists every material for tagging, not just the paintable ones', () => {
    const vm = sidebarViewModel(sources());
    const names = vm.materials.map((m) => m.name);

    expect(names).toContain('Floor_Oak');
    expect(vm.materials.find((m) => m.name === 'Floor_Oak')?.isPaintable).toBe(false);
    expect(vm.targets.map((t) => t.key)).not.toContain('Floor_Oak');
  });
});
