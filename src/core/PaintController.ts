/**
 * Owns the fan-out behind "a wall's colour changed".
 *
 * Every paint edit has to reach the registry (what's on the GPU), the store
 * (what survives a reload) and the views (rows, swatches, scheme highlights).
 * Doing that by hand at each call site is how the subsets drift apart — so the
 * writes live here, and views learn about them from a single change event.
 */

import type { PaintRegistry } from './PaintRegistry.ts';
import type { PaintTarget, Scheme, SchemeView } from '../types.ts';

/** The slice of `AppStore` the controller writes through. */
export interface PaintStore {
  readonly schemes: Scheme[];
  readonly activeSchemeId: string | null;
  setCurrentColor(key: string, hex: string): void;
  clearCurrentColor(key: string): void;
  setActiveScheme(id: string | null): void;
  saveScheme(id: string, colors: Record<string, string>): void;
}

/** What changed, in one payload: repainted targets, and the scheme rows if stale. */
export interface PaintChange {
  /** Targets whose colour actually moved, mapped to their new sRGB hex. */
  readonly colors: ReadonlyMap<string, string>;
  /** Non-null only when the scheme rows need re-rendering. */
  readonly schemes: SchemeView | null;
}

export type PaintListener = (change: PaintChange) => void;

/** Why a scheme apply did or didn't happen — the caller only has to phrase it. */
export type ApplySchemeResult =
  | { outcome: 'missing' }
  | { outcome: 'empty'; scheme: Scheme }
  | { outcome: 'applied'; scheme: Scheme; applied: number; requested: number };

export class PaintController {
  onPaintChanged: PaintListener | null = null;

  constructor(
    private registry: PaintRegistry,
    private store: PaintStore,
  ) {}

  /** Paints one target. Null when the scene has no such target. */
  apply(key: string, hex: string): PaintTarget | null {
    const target = this.registry.get(key);
    if (!target) return null;
    const before = target.currentHex;
    this.registry.setColor(key, hex);
    this.store.setCurrentColor(key, target.currentHex);
    // Hand-painting a wall means the scene no longer *is* the saved scheme.
    this.emit(moved(target, before), this.selectScheme(null));
    return target;
  }

  /** Puts one target back to the colour the GLB shipped with. */
  reset(key: string): PaintTarget | null {
    const target = this.registry.get(key);
    if (!target) return null;
    const before = target.currentHex;
    this.registry.resetColor(key);
    this.store.clearCurrentColor(key);
    this.emit(moved(target, before), this.selectScheme(null));
    return target;
  }

  /** Puts the whole scene back to its exported colours. */
  resetAll(): void {
    const before = this.snapshot();
    this.registry.resetAll();
    for (const target of this.registry.list()) this.store.clearCurrentColor(target.key);
    this.emit(this.changedSince(before), this.selectScheme(null));
  }

  /** Paints a saved slot over the scene. Keys the scene lacks are counted, not applied. */
  applyScheme(id: string): ApplySchemeResult {
    const scheme = this.scheme(id);
    if (!scheme) return { outcome: 'missing' };
    const requested = Object.keys(scheme.colors).length;
    if (requested === 0) return { outcome: 'empty', scheme };

    const before = this.snapshot();
    const applied = this.registry.applyScheme(scheme.colors);
    // Persist the whole scene, not just the slot's keys: what you see now is
    // what a reload has to bring back.
    for (const target of this.registry.list()) {
      this.store.setCurrentColor(target.key, target.currentHex);
    }
    this.emit(this.changedSince(before), this.selectScheme(id));
    return { outcome: 'applied', scheme, applied, requested };
  }

  /** Stores the scene's current colours into a slot. Null when there's no such slot. */
  capture(id: string): Scheme | null {
    const scheme = this.scheme(id);
    if (!scheme) return null;
    this.store.saveScheme(id, this.registry.capture());
    this.selectScheme(id);
    // Nothing on the walls moved, but the slot's swatches just did.
    this.emit(new Map(), true);
    return scheme;
  }

  private scheme(id: string): Scheme | null {
    return this.store.schemes.find((s) => s.id === id) ?? null;
  }

  /** Moves the active slot. False when it was already there — nothing to re-render. */
  private selectScheme(id: string | null): boolean {
    if (this.store.activeSchemeId === id) return false;
    this.store.setActiveScheme(id);
    return true;
  }

  /** Colours as they stand now — strings, so it survives the writes that follow. */
  private snapshot(): Map<string, string> {
    return new Map(this.registry.list().map((target) => [target.key, target.currentHex]));
  }

  private changedSince(before: Map<string, string>): Map<string, string> {
    const changed = new Map<string, string>();
    for (const target of this.registry.list()) {
      if (before.get(target.key) !== target.currentHex) changed.set(target.key, target.currentHex);
    }
    return changed;
  }

  private emit(colors: Map<string, string>, schemesChanged: boolean): void {
    if (colors.size === 0 && !schemesChanged) return;
    const change: PaintChange = {
      colors,
      schemes: schemesChanged
        ? { schemes: this.store.schemes, activeId: this.store.activeSchemeId }
        : null,
    };
    this.onPaintChanged?.(change);
  }
}

/** One-target change set, empty when the write landed on the colour already there. */
function moved(target: PaintTarget, before: string): Map<string, string> {
  return before === target.currentHex ? new Map() : new Map([[target.key, target.currentHex]]);
}
