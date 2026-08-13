import { Color, Mesh, MeshStandardMaterial, Object3D, SRGBColorSpace, type Material } from 'three';
import { PAINT_PREFIX, type MaterialInfo, type PaintTarget } from '../types.ts';
import { isStandard, materialsOf } from './materials.ts';

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
  private scratch = new Color();

  /** Rebuilds from a scene graph. Safe to call again after re-tagging. */
  discover(root: Object3D, options: DiscoverOptions = {}): void {
    const tagged = new Set(options.tagged ?? []);
    const untagged = new Set(options.untagged ?? []);

    this.groups.clear();
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      for (const mat of materialsOf(mesh)) {
        if (!mat || !isStandard(mat) || !mat.name) continue;
        let group = this.groups.get(mat.name);
        if (!group) {
          group = { name: mat.name, materials: [], meshes: [], hasColorMap: false };
          this.groups.set(mat.name, group);
        }
        if (!group.materials.includes(mat)) group.materials.push(mat);
        if (!group.meshes.includes(mesh)) group.meshes.push(mesh);
        if (mat.map) group.hasColorMap = true;
      }
    });

    // Preserve any colour already applied to a surviving target across a
    // re-discovery (e.g. after toggling a manual tag).
    const previous = new Map([...this.targets].map(([k, t]) => [k, t.currentHex]));

    this.targets.clear();
    this.byMaterial.clear();

    for (const group of this.groups.values()) {
      const auto = isAutoPaintName(group.name);
      const paintable = (auto && !untagged.has(group.name)) || tagged.has(group.name);
      if (!paintable) continue;

      const originalHex = `#${group.materials[0].color.getHexString(SRGBColorSpace)}`;
      const target: PaintTarget = {
        key: group.name,
        displayName: displayNameFor(group.name),
        materials: group.materials,
        meshes: group.meshes,
        originalHex,
        currentHex: previous.get(group.name) ?? originalHex,
        auto,
      };
      this.targets.set(group.name, target);
      for (const mat of group.materials) this.byMaterial.set(mat, group.name);
    }

    // Re-apply preserved colours so the GPU state matches `currentHex`.
    for (const target of this.targets.values()) {
      if (target.currentHex !== target.originalHex) this.setColor(target.key, target.currentHex);
    }
  }

  list(): PaintTarget[] {
    return [...this.targets.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { numeric: true }),
    );
  }

  get(key: string): PaintTarget | undefined {
    return this.targets.get(key);
  }

  get size(): number {
    return this.targets.size;
  }

  /** Every material in the scene, for the manual-tagging list. */
  allMaterials(): MaterialInfo[] {
    return [...this.groups.values()]
      .map((group) => ({
        name: group.name,
        isPaintable: this.targets.has(group.name),
        auto: isAutoPaintName(group.name),
        hasColorMap: group.hasColorMap,
        meshCount: group.meshes.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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
    target.currentHex = `#${this.scratch.getHexString(SRGBColorSpace)}`;
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
