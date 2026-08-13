import type { Material, Mesh, MeshStandardMaterial } from 'three';

/** Shared material helpers used by scene processing and paint discovery. */

export function isStandard(m: Material): m is MeshStandardMaterial {
  return (m as MeshStandardMaterial).isMeshStandardMaterial === true;
}

export function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
