import { describe, expect, it } from 'vitest';
import { createFallbackScene } from '../src/core/fallbackScene.ts';
import { PaintRegistry } from '../src/core/PaintRegistry.ts';
import { PaintController, type PaintChange, type PaintStore } from '../src/core/PaintController.ts';
import type { Scheme, SchemeView } from '../src/types.ts';

/**
 * The paint fan-out, exercised headlessly: a real PaintRegistry over the
 * procedural room plus a fake store, so every write the controller makes is
 * observable without a browser.
 */

/** Stands in for AppStore, recording the writes rather than persisting them. */
class FakeStore implements PaintStore {
  current: Record<string, string> = {};
  schemes: Scheme[] = [
    { id: 'slot-1', name: 'Scheme 1', colors: {} },
    { id: 'slot-2', name: 'Scheme 2', colors: {} },
  ];
  activeSchemeId: string | null = null;

  setCurrentColor(key: string, hex: string): void {
    this.current[key] = hex;
  }

  clearCurrentColor(key: string): void {
    delete this.current[key];
  }

  setActiveScheme(id: string | null): void {
    this.activeSchemeId = id;
  }

  saveScheme(id: string, colors: Record<string, string>): void {
    const scheme = this.schemes.find((s) => s.id === id);
    if (scheme) scheme.colors = { ...colors };
  }
}

/** Stands in for a view that draws the scheme slots, recording its re-renders. */
class FakeSchemeRows {
  renders: SchemeView[] = [];

  constructor(paint: PaintController) {
    paint.onChange((change) => {
      if (change.schemes) this.renders.push(change.schemes);
    });
  }
}

function setup() {
  const registry = new PaintRegistry();
  registry.discover(createFallbackScene());
  const store = new FakeStore();
  const paint = new PaintController(registry, store);
  const changes: PaintChange[] = [];
  paint.onChange((change) => changes.push(change));
  return { registry, store, paint, changes };
}

describe('paint fan-out', () => {
  it('mirrors a wall repaint into the registry, the store and one event', () => {
    const { registry, store, paint, changes } = setup();

    // Not the wall's exported #e8e4da — a write has to actually move it.
    expect(paint.apply('PAINT_Living_North', '#3a7fd5')).toBe(true);

    expect(registry.get('PAINT_Living_North')?.currentHex).toBe('#3a7fd5');
    expect(store.current).toEqual({ PAINT_Living_North: '#3a7fd5' });
    expect(changes).toHaveLength(1);
    expect([...changes[0].colors]).toEqual([['PAINT_Living_North', '#3a7fd5']]);
  });

  it('drops the active scheme once, not on every write of a picker drag', () => {
    const { store, paint, changes } = setup();
    store.activeSchemeId = 'slot-1';

    // Three pointermoves of one drag.
    paint.apply('PAINT_Living_North', '#111111');
    paint.apply('PAINT_Living_North', '#222222');
    paint.apply('PAINT_Living_North', '#333333');

    expect(store.activeSchemeId).toBeNull();
    // Only the write that actually de-selected the slot asks for a re-render;
    // the rest are cheap row updates.
    expect(changes.map((change) => change.schemes)).toEqual([
      { schemes: store.schemes, activeId: null },
      null,
      null,
    ]);
  });

  it('resets one wall to its exported colour and forgets the saved override', () => {
    const { registry, store, paint, changes } = setup();
    const original = registry.get('PAINT_Living_East')?.originalHex;
    paint.apply('PAINT_Living_East', '#ff0000');
    store.activeSchemeId = 'slot-2';
    changes.length = 0;

    expect(paint.reset('PAINT_Living_East')).toBe(true);

    expect(registry.get('PAINT_Living_East')?.currentHex).toBe(original);
    expect(store.current).toEqual({});
    expect(changes).toHaveLength(1);
    expect([...changes[0].colors]).toEqual([['PAINT_Living_East', original]]);
    // Undoing one wall deviates from the saved scheme exactly as painting it does.
    expect(store.activeSchemeId).toBeNull();
  });

  it('resets every wall in one event, naming only the walls that moved', () => {
    const { registry, store, paint, changes } = setup();
    paint.apply('PAINT_Living_North', '#111111');
    paint.apply('PAINT_Ceiling', '#222222');
    store.activeSchemeId = 'slot-1';
    changes.length = 0;

    paint.resetAll();

    expect(store.current).toEqual({});
    expect(store.activeSchemeId).toBeNull();
    expect(changes).toHaveLength(1);
    expect([...changes[0].colors.keys()].toSorted()).toEqual([
      'PAINT_Ceiling',
      'PAINT_Living_North',
    ]);
    expect(changes[0].colors.get('PAINT_Ceiling')).toBe(registry.get('PAINT_Ceiling')?.originalHex);
  });

  it('says nothing when a write moves nothing', () => {
    const { paint, changes } = setup();
    paint.apply('PAINT_Living_North', '#aabbcc');
    changes.length = 0;

    expect(paint.apply('PAINT_Nonexistent', '#aabbcc')).toBe(false);
    expect(paint.apply('PAINT_Living_North', '#aabbcc')).toBe(true);
    expect(paint.reset('PAINT_Ceiling')).toBe(true);

    expect(changes).toEqual([]);
  });

  it('re-renders both scheme views together, so neither is left highlighted', () => {
    const { store, paint } = setup();
    // The sidebar and the toolbar both draw the scheme slots; the bug this
    // guards is one of them updating while the other keeps its highlight.
    const sidebar = new FakeSchemeRows(paint);
    const toolbar = new FakeSchemeRows(paint);
    store.activeSchemeId = 'slot-1';

    paint.apply('PAINT_Living_North', '#3a7fd5');
    paint.apply('PAINT_Living_North', '#111111');

    expect(sidebar.renders).toEqual([{ schemes: store.schemes, activeId: null }]);
    expect(toolbar.renders).toEqual(sidebar.renders);
  });
});

describe('schemes', () => {
  it('applies a saved slot, marks it active and reports the hit rate', () => {
    const { registry, store, paint, changes } = setup();
    store.schemes[0].colors = { PAINT_Living_North: '#aabbcc', PAINT_Nonexistent: '#000000' };

    const result = paint.applyScheme('slot-1');

    expect(result).toEqual({
      outcome: 'applied',
      scheme: store.schemes[0],
      applied: 1,
      requested: 2,
    });
    expect(registry.get('PAINT_Living_North')?.currentHex).toBe('#aabbcc');
    expect(store.activeSchemeId).toBe('slot-1');
    expect(changes).toHaveLength(1);
    expect([...changes[0].colors]).toEqual([['PAINT_Living_North', '#aabbcc']]);
    expect(changes[0].schemes).toEqual({ schemes: store.schemes, activeId: 'slot-1' });
    // The whole visible scene is persisted, not just the walls the slot names.
    expect(Object.keys(store.current).toSorted()).toEqual(
      registry
        .list()
        .map((target) => target.key)
        .toSorted(),
    );
  });

  it('leaves the scene alone for an unknown or empty slot', () => {
    const { store, paint, changes } = setup();

    expect(paint.applyScheme('nope')).toEqual({ outcome: 'missing' });
    expect(paint.applyScheme('slot-2')).toEqual({ outcome: 'empty', scheme: store.schemes[1] });

    expect(changes).toEqual([]);
    expect(store.current).toEqual({});
    expect(store.activeSchemeId).toBeNull();
  });

  it('captures the scene into a slot and refreshes the rows without repainting', () => {
    const { store, paint, changes } = setup();
    paint.apply('PAINT_Living_North', '#aabbcc');
    changes.length = 0;

    expect(paint.capture('slot-2')).toBe(store.schemes[1]);

    expect(store.schemes[1].colors.PAINT_Living_North).toBe('#aabbcc');
    expect(store.activeSchemeId).toBe('slot-2');
    expect(changes).toHaveLength(1);
    // No wall moved — but the slot's swatches did, so the rows still re-render.
    expect(changes[0].colors.size).toBe(0);
    expect(changes[0].schemes).toEqual({ schemes: store.schemes, activeId: 'slot-2' });

    expect(paint.capture('nope')).toBeNull();
    expect(changes).toHaveLength(1);
  });
});
