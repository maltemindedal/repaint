import type { Box3, Object3D } from 'three';
import { defaultPose } from './processScene.ts';
import type { PaintRegistry } from './PaintRegistry.ts';
import type { AppStore } from '../state/store.ts';
import type { CameraPose, LoadedScene, NavMode, PaintTarget } from '../types.ts';

/**
 * Owns everything that has to happen for a scene to become *the* scene.
 *
 * Activation is a sequence, not a set: the store slot has to be current before
 * anything reads settings, discovery has to precede the picker, bounds have to
 * precede the pose, and settings have to come last. Those constraints live in
 * `load()` below and nowhere else — a caller loads a scene, it does not
 * assemble one.
 */

/** The camera knobs activation touches — `Viewer.camera` satisfies this. */
export interface SessionCamera {
  fov: number;
  updateProjectionMatrix(): void;
}

/** What activation needs from the picker — `Picker` satisfies this. */
export interface SessionPicker {
  setScene(root: Object3D): void;
  refreshTargets(): void;
}

/** What activation needs from navigation — `NavigationController` satisfies this. */
export interface SessionNav {
  readonly mode: NavMode;
  setBounds(bounds: Box3): void;
  applyPose(pose: CameraPose): void;
}

export interface SceneSessionDeps {
  camera: SessionCamera;
  registry: PaintRegistry;
  picker: SessionPicker;
  nav: SessionNav;
  store: AppStore;
}

export interface SceneSessionHooks {
  /**
   * Push the store's settings into the world and the UI.
   *
   * Called from inside `load()`, at the one point in the sequence where it is
   * safe: it sets the walk eye height, which emits a pose change, so running it
   * before the new pose is in place persists the *previous* scene's camera.
   */
  applySettings(): void;
  /** The paint-target list changed: a load, a manual re-tag, or an import. */
  targetsChanged(targets: PaintTarget[]): void;
}

export class SceneSession {
  private current: LoadedScene | null = null;

  constructor(
    private deps: SceneSessionDeps,
    private hooks: SceneSessionHooks,
  ) {}

  /** The scene currently on screen, for the things that outlive activation. */
  get scene(): LoadedScene | null {
    return this.current;
  }

  /** Makes `scene` the live one: prefs, paint targets, picker, camera, settings. */
  load(scene: LoadedScene): void {
    const { camera, nav, picker, registry, store } = this.deps;
    this.current = scene;

    // The store slot first. Everything below reads through it, and the
    // heuristics next write into it.
    store.useScene(scene.key);
    this.applyHeuristicDefaults(scene);

    // Discovery before the picker. The picker builds its highlight bookkeeping
    // from the registry, keyed by material name, and keeps the first instance
    // it sees for a key — so refreshing it while the registry still describes
    // the previous scene pins *that* scene's material instances under names the
    // new one reuses.
    this.discoverTargets();
    picker.setScene(scene.root);
    this.hooks.targetsChanged(registry.list());

    // Bounds before the pose: the walk controller clamps an applied pose
    // against them, and the previous apartment's bounds are the wrong box.
    nav.setBounds(scene.bounds);
    if (scene.startCamFov) {
      camera.fov = scene.startCamFov;
      camera.updateProjectionMatrix();
    }
    nav.applyPose(store.getPose(nav.mode) ?? scene.startCam ?? defaultPose(scene.bounds));

    // Last — see `SceneSessionHooks.applySettings`.
    this.hooks.applySettings();
  }

  /**
   * Re-runs discovery against the scene already on screen, after a manual tag
   * change or a settings import. The scene graph is unchanged, so the picker
   * refreshes in place instead of resetting.
   */
  rediscover(): void {
    if (!this.current) return;
    this.discoverTargets();
    this.deps.picker.refreshTargets();
    this.hooks.targetsChanged(this.deps.registry.list());
  }

  /**
   * Two per-scene defaults that are guesses, not preferences: only ever set
   * when the user has not made the call for this file themselves.
   */
  private applyHeuristicDefaults(scene: LoadedScene): void {
    const { store } = this.deps;
    const settings = store.scene.settings;

    // Baked scenes shouldn't be double-lit, but a scene *without* a bake
    // clearly wants its exported lights on.
    if (settings.punctualLights === undefined && scene.lights.length > 0) {
      store.setSetting('punctualLights', !scene.hasBakedTextures);
    }

    // ORM-packed occlusion can't drive a lightmap, so for those materials the
    // AO slider is the whole effect. The global default of 0 (right for
    // lightmapped scenes, where the bake already contains its occlusion) would
    // silently disable it — give this file a default of 1 instead.
    if (settings.aoMapIntensity === undefined && scene.aoOnlyMaterials.length > 0) {
      store.setSetting('aoMapIntensity', 1);
    }
  }

  /**
   * Rebuilds the paint targets and repaints them from the store — the single
   * record of what was on screen. Discovery deliberately restores nothing of
   * its own: it reports the graph as it finds it, and everything the user
   * chose comes back through here.
   */
  private discoverTargets(): void {
    const { registry, store } = this.deps;
    const scene = this.current;
    if (!scene) return;

    const prefs = store.scene;
    registry.discover(scene.root, { tagged: prefs.tagged, untagged: prefs.untagged });
    for (const [key, hex] of Object.entries(store.currentColors)) registry.setColor(key, hex);
  }
}
