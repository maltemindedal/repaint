import { Color, Mesh, MeshStandardMaterial, Object3D, SRGBColorSpace, type Material } from 'three';
import { PAINT_PREFIX, type MaterialInfo, type PaintTarget } from '../types.ts';
import { isMesh, isStandard, materialsOf } from './materials.ts';

/**
 * Discovers recolorable surfaces and owns every write to `material.color`.
 *
 * Discovery is **always** by material name, never by mesh name. A material may
 * be instantiated more than once by GLTFLoader (a mesh needing flat shading or
 * vertex colours gets its own clone), so one logical wall is a *group* of
 * material instances sharing a name.
 */

/** `PAINT_Living_North.001` -> `Living North`. */
export function displayNameFor(materialName: string): string {
  let name = materialName.replace(/\.\d{3}$/, ''); // Blender duplicate suffix
  if (name.toUpperCase().startsWith(PAINT_PREFIX)) name = name.slice(PAINT_PREFIX.length);
  name = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return materialName;
  // Only touch all-lowercase words so `NORTH` and `sRGB` survive intact.
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function isAutoPaintName(materialName: string): boolean {
  return materialName.toUpperCase().startsWith(PAINT_PREFIX);
}

/** A three `Color` -> the sRGB `#rrggbb` the rest of the app speaks. */
function hexOf(color: Color): string {
  return `#${color.getHexString(SRGBColorSpace)}`;
}

export interface DiscoverOptions {
  /** Material names manually marked paintable (no `PAINT_` prefix). */
  tagged?: string[];
  /** Material names to exclude even though they match the prefix. */
  untagged?: string[];
}

interface MaterialGroup {
  name: string;
  materials: MeshStandardMaterial[];
  meshes: Mesh[];
  hasColorMap: boolean;
}

export class PaintRegistry {
  private targets = new Map<string, PaintTarget>();
  private groups = new Map<string, MaterialGroup>();
  /** material instance -> target key, for O(1) raycast hit resolution. */
  private byMaterial = new Map<MeshStandardMaterial, string>();
  /**
   * material name -> the sRGB hex the GLB shipped with, captured the first time
   * we see a scene graph — while the materials are still pristine.
   *
   * A re-discovery of the *same* graph (a manual tag toggle, a settings import)
   * runs against materials that already carry the user's paint, so the live
   * colour is no longer a usable source. Dropped when the root changes, since a
   * new load brings its own materials.
   */
  private originalHexes = new Map<string, string>();
  /** The graph we last discovered. A different one means a fresh load. */
  private root: Object3D | null = null;
  private scratch = new Color();

  // Both sorted views cost an Intl collation per comparison, and both change
  // only when `discover` runs — but they are read on every sidebar render, so
  // they are built once per discovery instead.
  private sortedTargets: PaintTarget[] | null = null;
  private sortedMaterials: MaterialInfo[] | null = null;

  /**
   * Rebuilds from a scene graph. Safe to call again after re-tagging.
   *
   * Reads colour, never writes it: `currentHex` comes back on whatever the
   * graph currently says. Putting back what was on screen belongs to
   * `SceneSession.discoverTargets`.
   *
   * `originalHex` is the one thing the graph can no longer answer for on a
   * re-discovery — by then the materials wear the user's paint — so it comes
   * from `this.originalHexes`, banked on the way past below.
   */
  discover(root: Object3D, options: DiscoverOptions = {}): void {
    const tagged = new Set(options.tagged ?? []);
    const untagged = new Set(options.untagged ?? []);

    if (root !== this.root) {
      this.root = root;
      this.originalHexes.clear();
    }

    this.sortedTargets = null;
    this.sortedMaterials = null;
    this.groups.clear();
    root.traverse((obj) => {
      if (!isMesh(obj)) return;
      for (const mat of materialsOf(obj)) {
        if (!mat || !isStandard(mat) || !mat.name) continue;
        let group = this.groups.get(mat.name);
        if (!group) {
          group = { name: mat.name, materials: [], meshes: [], hasColorMap: false };
          this.groups.set(mat.name, group);
          // Bank the shipped colour here, where the material is first seen and
          // still pristine — and for every material, paintable or not: an
          // untagged one keeps whatever paint it was wearing, so its exported
          // colour has to be on record before it can be tagged again.
          if (!this.originalHexes.has(mat.name)) this.originalHexes.set(mat.name, hexOf(mat.color));
        }
        if (!group.materials.includes(mat)) group.materials.push(mat);
        if (!group.meshes.includes(obj)) group.meshes.push(obj);
        if (mat.map) group.hasColorMap = true;
      }
    });

    this.targets.clear();
    this.byMaterial.clear();

    for (const group of this.groups.values()) {
      const auto = isAutoPaintName(group.name);
      const paintable = (auto && !untagged.has(group.name)) || tagged.has(group.name);
      if (!paintable) continue;

      const firstMaterial = group.materials[0];
      if (!firstMaterial) continue;
      const live = hexOf(firstMaterial.color);
      const target: PaintTarget = {
        key: group.name,
        displayName: displayNameFor(group.name),
        materials: group.materials,
        meshes: group.meshes,
        originalHex: this.originalHexes.get(group.name) ?? live,
        currentHex: live,
        auto,
      };
      this.targets.set(group.name, target);
      for (const mat of group.materials) this.byMaterial.set(mat, group.name);
    }
  }

  /**
   * The targets, display-name order. The array is shared and must be treated
   * as read-only; the `PaintTarget`s in it are the live ones this registry
   * mutates, so `currentHex` is always up to date.
   */
  list(): PaintTarget[] {
    this.sortedTargets ??= [...this.targets.values()].toSorted((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { numeric: true }),
    );
    return this.sortedTargets;
  }

  get(key: string): PaintTarget | undefined {
    return this.targets.get(key);
  }

  get size(): number {
    return this.targets.size;
  }

  /** Every material in the scene, for the manual-tagging list. Read-only. */
  allMaterials(): MaterialInfo[] {
    this.sortedMaterials ??= [...this.groups.values()]
      .map((group) => ({
        name: group.name,
        isPaintable: this.targets.has(group.name),
        auto: isAutoPaintName(group.name),
        hasColorMap: group.hasColorMap,
        meshCount: group.meshes.length,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return this.sortedMaterials;
  }

  /** Resolves a raycast hit back to the target that owns it. */
  targetForMaterial(material: Material | Material[]): PaintTarget | null {
    const list = Array.isArray(material) ? material : [material];
    for (const mat of list) {
      if (!isStandard(mat)) continue;
      const key = this.byMaterial.get(mat);
      if (key) return this.targets.get(key) ?? null;
    }
    return null;
  }

  /**
   * The only place paint colour is written.
   *
   * `Color.setStyle()` parses the hex as sRGB and converts into three's linear
   * working space, so a pasted `#E8E4DA` renders as that colour (tone mapping
   * aside — see the README).
   *
   * Deliberately does **not** touch `material.needsUpdate`: writing a uniform
   * value never invalidates the program cache key, so recolouring costs a
   * uniform upload and nothing more. No shader recompiles, no frame hitch.
   */
  setColor(key: string, hex: string): boolean {
    const target = this.targets.get(key);
    if (!target) return false;
    this.scratch.setStyle(hex, SRGBColorSpace);
    for (const mat of target.materials) mat.color.copy(this.scratch);
    target.currentHex = hexOf(this.scratch);
    return true;
  }

  resetColor(key: string): boolean {
    const target = this.targets.get(key);
    if (!target) return false;
    return this.setColor(key, target.originalHex);
  }

  resetAll(): void {
    for (const key of this.targets.keys()) this.resetColor(key);
  }

  /** Applies a saved scheme; keys the scene no longer has are ignored. */
  applyScheme(colors: Record<string, string>): number {
    let applied = 0;
    for (const [key, hex] of Object.entries(colors)) {
      if (this.setColor(key, hex)) applied++;
    }
    return applied;
  }

  /** Snapshot of every current colour, for saving into a scheme slot. */
  capture(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, target] of this.targets) out[key] = target.currentHex;
    return out;
  }
}
