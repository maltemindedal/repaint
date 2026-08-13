import type { Box3, Light, Mesh, MeshStandardMaterial, Object3D } from 'three';

/** Material-name prefix that marks a material as recolorable paint. */
export const PAINT_PREFIX = 'PAINT_';

/** Name of the optional Blender camera used for the initial view. */
export const START_CAM_NAME = 'START_CAM';

export type NavMode = 'orbit' | 'walk';

/**
 * One recolorable surface. Grouped by *material name*, never by mesh name —
 * glTF import can hand back several material instances that share a name
 * (three clones a material when a mesh needs a shader variant), so a target
 * owns a list of instances and writes to all of them at once.
 */
export interface PaintTarget {
  /** Material name, exactly as authored in Blender. Stable persistence key. */
  key: string;
  /** `PAINT_Living_North.001` -> `Living North`. */
  displayName: string;
  materials: MeshStandardMaterial[];
  meshes: Mesh[];
  /** sRGB hex (`#rrggbb`) the GLB shipped with. */
  exportedHex: string;
  currentHex: string;
  /** True when discovered via the `PAINT_` prefix, false when manually tagged. */
  auto: boolean;
}

export interface MaterialInfo {
  name: string;
  isPaintable: boolean;
  auto: boolean;
  /** Materials with a base-colour texture can't be recoloured cleanly. */
  hasColorMap: boolean;
  meshCount: number;
}

export interface CameraPose {
  position: [number, number, number];
  /** Orbit target, or the walk-mode look direction anchor. */
  target: [number, number, number];
}

export interface LoadedScene {
  root: Object3D;
  /** localStorage key for this scene: the dropped file name. */
  key: string;
  label: string;
  bounds: Box3;
  lights: Light[];
  startCam: CameraPose | null;
  startCamFov: number | null;
  /** Materials wired up with a baked lightmap — the debug intensity sliders. */
  bakedMaterials: MeshStandardMaterial[];
  /** Materials whose occlusion is ORM-packed: AO-only, no lightmap. */
  aoOnlyMaterials: MeshStandardMaterial[];
  /** True when at least one material carries a real lightmap (not just AO). */
  hasBakedTextures: boolean;
  stats: SceneStats;
  isFallback: boolean;
}

export interface SceneStats {
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  /** Rough GPU bytes for all textures, mips included. */
  textureBytes: number;
  draco: boolean;
  meshopt: boolean;
  ktx2: boolean;
}

export interface LibraryColor {
  id: string;
  name: string;
  hex: string;
}

export interface Scheme {
  id: string;
  name: string;
  /** material name -> sRGB hex */
  colors: Record<string, string>;
}

/** What the scheme renderers need — the slots plus which one is active. */
export interface SchemeView {
  schemes: Scheme[];
  activeId: string | null;
}

export interface SceneSettings {
  exposure: number;
  toneMapping: boolean;
  lightMapIntensity: number;
  aoMapIntensity: number;
  envIntensity: number;
  punctualLights: boolean;
  eyeHeight: number;
  walkSpeed: number;
  highlights: boolean;
}

export interface ScenePrefs {
  /** Material names manually marked paintable when no `PAINT_` prefix exists. */
  tagged: string[];
  /** Material names explicitly un-tagged even though they match `PAINT_`. */
  untagged: string[];
  schemes: Scheme[];
  activeSchemeId: string | null;
  poses: Partial<Record<NavMode, CameraPose>>;
  settings: Partial<SceneSettings>;
  /** Live colours, so a reload picks up exactly where you left off. */
  current: Record<string, string>;
}

export interface AppData {
  version: 1;
  library: LibraryColor[];
  scenes: Record<string, ScenePrefs>;
}
