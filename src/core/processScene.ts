import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Light,
  type Texture,
} from 'three';
import type { CameraPose, SceneStats } from '../types.ts';
import { START_CAM_NAME } from '../types.ts';
import { isStandard, materialsOf } from './materials.ts';

/**
 * Renderer-free scene post-processing. Everything that has to happen to a
 * freshly parsed GLB *and* to the procedural fallback lives here, so the smoke
 * test can exercise the exact same code path without a GPU.
 */

export interface ProcessResult {
  bounds: Box3;
  lights: Light[];
  startCam: CameraPose | null;
  startCamFov: number | null;
  /** Materials whose bake drives `lightMap` (standalone occlusion texture). */
  bakedMaterials: MeshStandardMaterial[];
  /** Materials whose occlusion is ORM-packed and therefore AO-only. */
  aoOnlyMaterials: MeshStandardMaterial[];
  materials: MeshStandardMaterial[];
  stats: Omit<SceneStats, 'draco' | 'meshopt' | 'ktx2'>;
}

/** `START_CAM`, `START_CAM.001`, `start_cam` all count. */
function isStartCamName(name: string): boolean {
  return name.replace(/\.\d{3}$/, '').toUpperCase() === START_CAM_NAME;
}

/**
 * Rough GPU cost of a texture including a full mip chain.
 *
 * Counted per `Texture.source`, not per `Texture`: GLTFLoader hands out a
 * separate Texture instance for every material that references an image, but
 * they share one `source` and therefore one upload. Counting instances would
 * over-report VRAM by the number of materials — and the perf hint reads this
 * number.
 */
function textureBytes(tex: Texture): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return 0;
  const base = w * h * 4;
  return Math.round(tex.generateMipmaps === false ? base : base * 1.34);
}

/**
 * `lightMap` feeds three's `irradiance`, which `RE_IndirectDiffuse_Physical`
 * then multiplies by `BRDF_Lambert() = albedo / π`. A Cycles *Diffuse* or
 * *Combined* bake stores outgoing radiance for a white surface — i.e. the
 * result you want *before* that division — so reproducing the Blender render
 * needs the π put back. Hence the default intensity, not 1.
 */
export const LIGHTMAP_INTENSITY = Math.PI;

/**
 * True when the glTF packed occlusion into the R channel of a shared
 * Occlusion-Roughness-Metallic texture. GLTFLoader hands each slot its own
 * Texture instance but they share one `source`, which is the tell.
 */
function isPackedORM(material: MeshStandardMaterial, baked: Texture): boolean {
  const source = baked.source;
  return (
    (material.roughnessMap != null && material.roughnessMap.source === source) ||
    (material.metalnessMap != null && material.metalnessMap.source === source)
  );
}

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/**
 * Wires a glTF occlusion texture into the lightmap slot.
 *
 * Blender's glTF exporter has no lightmap slot, so the documented workflow is
 * to plug the bake into the *occlusion* input of a `glTF Material Output` node
 * group — GLTFLoader lands that in `material.aoMap`.
 *
 * Two shapes arrive here and they must be handled differently:
 *
 *  - **A standalone bake.** `lightMap` samples full RGB and multiplies into
 *    diffuse irradiance, which is exactly what baked lighting is. The texture
 *    is flagged sRGB (a Cycles bake saved as PNG/JPG is sRGB-encoded; reading
 *    it as linear data washes the room out) and both slots point at the *same*
 *    instance — one upload, one colour-space decision — with `aoMapIntensity`
 *    at 0 so the occlusion isn't multiplied in twice.
 *
 *  - **An ORM-packed texture**, where glTF has stuffed occlusion into R and
 *    roughness/metallic into G/B. `aoMap` reads R only and copes fine; feeding
 *    the same texture to `lightMap` would light the room with the roughness and
 *    metallic channels. So: AO only, left linear, and a console hint.
 */
type BakeKind = 'lightmap' | 'ao' | null;

function wireBakedTexture(material: MeshStandardMaterial, mesh: Mesh): BakeKind {
  const baked = material.aoMap;
  if (!baked) return null;

  // lightMap/aoMap sample the UV channel recorded on the texture. glTF
  // TEXCOORD_1 becomes the `uv1` attribute; if the exporter promised a second
  // UV set but didn't ship one, fall back to uv0 rather than rendering black.
  const channel = baked.channel ?? 0;
  const geometry = mesh.geometry;
  if (channel === 1 && !geometry.getAttribute('uv1')) {
    const uv = geometry.getAttribute('uv');
    if (uv) {
      geometry.setAttribute('uv1', uv);
      warnOnce(
        `uv1:${material.name}`,
        `[scene] "${material.name}" has a baked texture on TEXCOORD_1 but the mesh has no second UV set. ` +
          'Falling back to UV0 — re-export with the lightmap UV layer included.',
      );
    } else {
      warnOnce(
        `uv:${material.name}`,
        `[scene] "${material.name}" has a baked texture but the mesh has no UVs at all.`,
      );
      return null;
    }
  }

  if (isPackedORM(material, baked)) {
    material.aoMapIntensity = 1;
    material.lightMap = null;
    warnOnce(
      'orm',
      `[scene] "${material.name}" shares one Occlusion/Roughness/Metallic texture, so only its red ` +
        'channel is occlusion. Using it as ambient occlusion rather than a lightmap. For baked ' +
        'lighting, export the bake as its own image connected to the glTF Material Output node.',
    );
    material.needsUpdate = true;
    return 'ao';
  }

  baked.colorSpace = SRGBColorSpace;
  baked.needsUpdate = true;

  material.lightMap = baked;
  material.lightMapIntensity = LIGHTMAP_INTENSITY;
  material.aoMapIntensity = 0;

  material.needsUpdate = true;
  return 'lightmap';
}

export function processScene(root: Object3D): ProcessResult {
  const lights: Light[] = [];
  const seenMaterials = new Set<MeshStandardMaterial>();
  const bakedMaterials = new Set<MeshStandardMaterial>();
  const aoOnlyMaterials = new Set<MeshStandardMaterial>();
  // Keyed by Texture.source — see textureBytes().
  const seenSources = new Set<unknown>();

  let meshes = 0;
  let triangles = 0;
  let bytes = 0;

  let startCamObject: Object3D | null = null;

  root.updateWorldMatrix(true, true);

  root.traverse((obj) => {
    if ((obj as Light).isLight) lights.push(obj as Light);
    if (isStartCamName(obj.name) && !startCamObject) startCamObject = obj;

    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;

    meshes++;
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (index) triangles += index.count / 3;
    else if (position) triangles += position.count / 3;

    for (const mat of materialsOf(mesh)) {
      if (!mat || !isStandard(mat)) continue;
      if (!seenMaterials.has(mat)) {
        seenMaterials.add(mat);
        for (const key of [
          'map',
          'aoMap',
          'lightMap',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'emissiveMap',
        ] as const) {
          const tex = mat[key] as Texture | null;
          const source = tex?.source ?? tex?.image;
          if (tex && source && !seenSources.has(source)) {
            seenSources.add(source);
            bytes += textureBytes(tex);
          }
        }
      }
      const kind = wireBakedTexture(mat, mesh);
      if (kind === 'lightmap') bakedMaterials.add(mat);
      else if (kind === 'ao') aoOnlyMaterials.add(mat);
    }
  });

  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1));

  let startCam: CameraPose | null = null;
  let startCamFov: number | null = null;
  if (startCamObject) {
    const cam = startCamObject as Object3D & { isCamera?: boolean; fov?: number };
    cam.updateWorldMatrix(true, false);
    const position = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    // glTF cameras look down local -Z; Blender's exporter already baked the
    // Z-up -> Y-up correction into the node transform.
    const forward = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
    const target = position.clone().add(forward.multiplyScalar(3));
    startCam = { position: position.toArray(), target: target.toArray() };
    if (cam.isCamera && typeof cam.fov === 'number') startCamFov = cam.fov;
  }

  return {
    bounds,
    lights,
    startCam,
    startCamFov,
    bakedMaterials: [...bakedMaterials],
    aoOnlyMaterials: [...aoOnlyMaterials],
    materials: [...seenMaterials],
    stats: {
      meshes,
      triangles: Math.round(triangles),
      materials: seenMaterials.size,
      textures: seenSources.size,
      textureBytes: bytes,
    },
  };
}

/**
 * Fallback view for a scene with no `START_CAM`.
 *
 * Deliberately *inside* the bounding box at standing height rather than the
 * usual orbit-from-outside framing: an apartment viewed from outside is mostly
 * backface-culled walls, and the first thing you want to see is the room.
 */
export function defaultPose(bounds: Box3): CameraPose {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const eye = Math.min(bounds.min.y + 1.6, bounds.max.y - 0.15);

  return {
    position: [center.x + size.x * 0.3, eye, center.z + size.z * 0.3],
    target: [center.x - size.x * 0.2, eye - 0.1, center.z - size.z * 0.2],
  };
}
