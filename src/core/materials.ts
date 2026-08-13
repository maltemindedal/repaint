import type {
  Light,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Texture,
} from 'three';

/**
 * Shared material helpers and three.js type guards used by scene processing
 * and paint discovery. three's classes discriminate on `is*` flags rather
 * than subclassing alone, so these guards centralise the one cast each check
 * needs.
 */

export function isStandard(m: Material): m is MeshStandardMaterial {
  return (m as MeshStandardMaterial).isMeshStandardMaterial === true;
}

export function isMesh(obj: Object3D): obj is Mesh {
  return (obj as Mesh).isMesh === true;
}

export function isLight(obj: Object3D): obj is Light {
  return (obj as Light).isLight === true;
}

export function isPerspectiveCamera(obj: Object3D): obj is PerspectiveCamera {
  return (obj as PerspectiveCamera).isPerspectiveCamera === true;
}

export function isTexture(value: unknown): value is Texture {
  return typeof value === 'object' && value !== null && (value as Texture).isTexture === true;
}

export function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
