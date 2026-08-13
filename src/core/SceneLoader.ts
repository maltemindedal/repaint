import { Mesh, Object3D, Vector3, type Material, type Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createGLTFLoader } from './loaders.ts';
import { processScene } from './processScene.ts';
import { createFallbackScene, FALLBACK_KEY, FALLBACK_LABEL } from './fallbackScene.ts';
import type { LoadedScene } from '../types.ts';
import type { Viewer } from './Viewer.ts';

export type ProgressFn = (fraction: number, label: string) => void;

/** Frees every GPU resource under a subtree. */
export function disposeSubtree(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        const tex = value as Texture | null;
        if (tex && (tex as Texture).isTexture) textures.add(tex);
      }
      mat.dispose();
    }
  });
  for (const tex of textures) tex.dispose();
  root.removeFromParent();
}

function readFile(file: File, onProgress: ProgressFn): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 0.5, 'Reading file…');
    });
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer));
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read file')),
    );
    reader.readAsArrayBuffer(file);
  });
}

export class SceneLoader {
  private current: Object3D | null = null;

  constructor(private viewer: Viewer) {}

  /** The procedural room shown before you drop anything. */
  loadFallback(): LoadedScene {
    this.unload();
    const root = createFallbackScene();
    const processed = processScene(root);
    this.viewer.scene.add(root);
    this.current = root;

    return {
      root,
      key: FALLBACK_KEY,
      label: FALLBACK_LABEL,
      bounds: processed.bounds,
      lights: processed.lights,
      startCam: processed.startCam,
      startCamFov: processed.startCamFov,
      bakedMaterials: processed.bakedMaterials,
      aoOnlyMaterials: processed.aoOnlyMaterials,
      hasBakedTextures: processed.bakedMaterials.length > 0,
      stats: { ...processed.stats, draco: false, meshopt: false, ktx2: false },
      isFallback: true,
    };
  }

  async loadFile(file: File, onProgress: ProgressFn = () => {}): Promise<LoadedScene> {
    const buffer = await readFile(file, onProgress);
    onProgress(0.55, 'Parsing glTF…');

    const loader = createGLTFLoader(this.viewer.renderer);
    const gltf: GLTF = await loader.parseAsync(buffer, '');

    onProgress(0.85, 'Preparing materials…');
    this.unload();

    const root = gltf.scene ?? gltf.scenes[0];
    root.name = root.name || file.name;
    const processed = processScene(root);

    this.viewer.scene.add(root);
    this.current = root;

    const used = new Set(
      ((gltf.parser.json as { extensionsUsed?: string[] }).extensionsUsed ?? []).map(String),
    );

    const scene: LoadedScene = {
      root,
      key: file.name,
      label: file.name,
      bounds: processed.bounds,
      lights: processed.lights,
      startCam: processed.startCam,
      startCamFov: processed.startCamFov,
      bakedMaterials: processed.bakedMaterials,
      aoOnlyMaterials: processed.aoOnlyMaterials,
      hasBakedTextures: processed.bakedMaterials.length > 0,
      stats: {
        ...processed.stats,
        draco: used.has('KHR_draco_mesh_compression'),
        meshopt: used.has('EXT_meshopt_compression'),
        ktx2: used.has('KHR_texture_basisu'),
      },
      isFallback: false,
    };

    onProgress(1, 'Done');
    logSceneReport(scene, file);
    return scene;
  }

  unload(): void {
    if (!this.current) return;
    disposeSubtree(this.current);
    this.current = null;
  }
}

const MB = 1024 * 1024;

function logSceneReport(scene: LoadedScene, file: File): void {
  const { stats } = scene;
  const size = scene.bounds.getSize(new Vector3());

  console.groupCollapsed(
    `%c[scene] ${file.name}%c  ${stats.meshes} meshes · ${stats.triangles.toLocaleString()} tris · ${(file.size / MB).toFixed(1)} MB`,
    'font-weight:600',
    'font-weight:400;color:#888',
  );
  console.log(
    `dimensions: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m (assuming Blender metres, +Y up)`,
  );
  console.log(
    `materials: ${stats.materials}, textures: ${stats.textures} (~${(stats.textureBytes / MB).toFixed(0)} MB VRAM)`,
  );
  console.log(`compression: draco=${stats.draco} meshopt=${stats.meshopt} ktx2=${stats.ktx2}`);
  console.log(`baked lighting detected: ${scene.hasBakedTextures}`);
  if (scene.startCam) console.log('START_CAM found — using it for the initial view.');
  if (scene.lights.length) console.log(`${scene.lights.length} punctual light(s) in the file.`);

  if (size.y > 100 || size.y < 0.5) {
    console.warn(
      '[scene] The scene is an unusual height for an apartment. Check the "Scene unit" / scale setting in the glTF exporter.',
    );
  }
  console.groupEnd();
}
