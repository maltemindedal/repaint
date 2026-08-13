import {
  Color,
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import type { PaintRegistry } from './PaintRegistry.ts';
import type { PaintTarget } from '../types.ts';
import type { Viewer } from './Viewer.ts';

/**
 * Hover + click picking, plus the "this surface is clickable" feedback.
 *
 * The highlight is an additive nudge to `material.emissive`. That is
 * deliberate: emissive is always present in the standard-material shader, so
 * writing it is a uniform update — unlike toggling a map or a material flag,
 * which would invalidate the program cache and stall a frame every time your
 * pointer crossed a wall.
 */

const HOVER_STRENGTH = 0.05;
const SELECT_PULSE = 0.16;
const PULSE_DURATION = 0.7;

export class Picker {
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private pointerInside = false;
  private dirty = false;

  private root: Object3D | null = null;
  private paintMeshes: Mesh[] = [];
  private allMeshes: Mesh[] = [];

  private hovered: PaintTarget | null = null;
  /** key -> the materials being highlighted and the emissive they started with. */
  private highlightState = new Map<string, { materials: MeshStandardMaterial[]; emissive: Color }>();
  private pulse = new Map<string, number>();
  private scratch = new Color();

  enabled = true;
  highlightsEnabled = true;

  onHover: ((target: PaintTarget | null) => void) | null = null;
  onSelect: ((target: PaintTarget | null) => void) | null = null;
  onDoubleClick: ((point: Vector3) => void) | null = null;

  constructor(
    private viewer: Viewer,
    private registry: PaintRegistry,
  ) {
    const canvas = viewer.canvas;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('dblclick', this.handleDoubleClick);
  }

  /** Call after every load / re-discovery. */
  setScene(root: Object3D | null): void {
    this.clearHighlights();
    this.root = root;
    this.allMeshes = [];
    this.paintMeshes = [];
    this.highlightState.clear();
    this.pulse.clear();
    if (!root) return;

    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) this.allMeshes.push(mesh);
    });
    this.refreshTargets();
  }

  /** Re-reads the registry (after manual tagging changes which walls exist). */
  refreshTargets(): void {
    const meshes = new Set<Mesh>();
    for (const target of this.registry.list()) {
      for (const mesh of target.meshes) meshes.add(mesh);
      this.trackTarget(target);
    }
    this.paintMeshes = [...meshes];
  }

  private trackTarget(target: PaintTarget): void {
    if (this.highlightState.has(target.key)) return;
    this.highlightState.set(target.key, {
      materials: target.materials,
      emissive: target.materials[0].emissive.clone(),
    });
  }

  // ------------------------------------------------------------- pointer

  private updatePointer(event: PointerEvent | MouseEvent): void {
    // Under pointer lock there is no cursor — pick down the centre crosshair.
    if (document.pointerLockElement === this.viewer.canvas) {
      this.pointer.set(0, 0);
      return;
    }
    const rect = this.viewer.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.pointerInside = true;
    this.dirty = true;
  };

  private handlePointerLeave = (): void => {
    this.pointerInside = false;
    this.dirty = true;
  };

  private downAt = { x: 0, y: 0 };

  private handlePointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY };
    this.viewer.canvas.addEventListener('pointerup', this.handlePointerUp, { once: true });
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    // Ignore the pointerup that ends an orbit/look drag.
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y);
    if (moved > 4) return;

    this.updatePointer(event);
    const target = this.pickPaintable();
    if (target) this.selectPulse(target);
    this.onSelect?.(target);
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    if (!this.enabled || !this.onDoubleClick) return;
    this.updatePointer(event);
    const hit = this.pickAny();
    if (hit) this.onDoubleClick(hit.point.clone());
  };

  // ------------------------------------------------------------ raycasts

  private pickPaintable(): PaintTarget | null {
    if (!this.root || this.paintMeshes.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
    const hits = this.raycaster.intersectObjects(this.paintMeshes, false);
    for (const hit of hits) {
      const mesh = hit.object as Mesh;
      const target = this.registry.targetForMaterial(mesh.material);
      if (target) return target;
    }
    return null;
  }

  private pickAny(): Intersection | null {
    if (!this.root || this.allMeshes.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
    const hits = this.raycaster.intersectObjects(this.allMeshes, false);
    return hits[0] ?? null;
  }

  // ----------------------------------------------------------- highlight

  /** Selection feedback: a short pulse rather than a persistent tint, so a
   *  selected wall still shows its true colour while you judge it. */
  selectPulse(target: PaintTarget): void {
    if (!this.highlightsEnabled) return;
    this.trackTarget(target);
    this.pulse.set(target.key, PULSE_DURATION);
  }

  setHovered(target: PaintTarget | null): void {
    if (this.hovered?.key === target?.key) return;
    if (this.hovered) this.restoreEmissive(this.hovered.key);
    this.hovered = target;
    this.onHover?.(target);
    this.viewer.canvas.classList.toggle('hover-paintable', Boolean(target));
  }

  private restoreEmissive(key: string): void {
    const state = this.highlightState.get(key);
    if (!state) return;
    for (const mat of state.materials) mat.emissive.copy(state.emissive);
  }

  private applyEmissive(key: string, amount: number): void {
    const state = this.highlightState.get(key);
    if (!state) return;
    this.scratch.copy(state.emissive).addScalar(amount);
    for (const mat of state.materials) mat.emissive.copy(this.scratch);
  }

  /** Restores every touched emissive from its own record — safe to call even
   *  after the registry has been rebuilt for a different scene. */
  clearHighlights(): void {
    for (const key of this.highlightState.keys()) this.restoreEmissive(key);
    this.hovered = null;
    this.pulse.clear();
    this.viewer.canvas.classList.remove('hover-paintable');
  }

  /** Drive from the render loop. */
  update(dt: number): void {
    if (this.dirty && this.enabled) {
      this.dirty = false;
      this.setHovered(this.pointerInside ? this.pickPaintable() : null);
    }

    if (!this.highlightsEnabled) return;

    // Hover: a barely-there lift so you can tell what is clickable.
    if (this.hovered && !this.pulse.has(this.hovered.key)) {
      this.applyEmissive(this.hovered.key, HOVER_STRENGTH);
    }

    // Selection pulse decays back to the material's own emissive.
    for (const [key, remaining] of [...this.pulse]) {
      const next = remaining - dt;
      if (next <= 0) {
        this.pulse.delete(key);
        if (this.hovered?.key === key) this.applyEmissive(key, HOVER_STRENGTH);
        else this.restoreEmissive(key);
        continue;
      }
      this.pulse.set(key, next);
      const t = next / PULSE_DURATION;
      // Two quick beats, easing out.
      const wave = Math.abs(Math.sin(t * Math.PI * 2)) * t;
      this.applyEmissive(key, SELECT_PULSE * wave + HOVER_STRENGTH * (1 - t));
    }
  }

  dispose(): void {
    const canvas = this.viewer.canvas;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('dblclick', this.handleDoubleClick);
  }
}
