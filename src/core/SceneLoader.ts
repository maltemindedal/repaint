import { Object3D, Vector3, type Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createGLTFLoader } from './loaders.ts';
import { isInstancedMesh, isMesh, isTexture, materialsOf } from './materials.ts';
import { processScene } from './processScene.ts';
import { createFallbackScene, FALLBACK_KEY, FALLBACK_LABEL } from './fallbackScene.ts';
import type { LoadedScene } from '../types.ts';
import type { Viewer } from './Viewer.ts';

export type ProgressFn = (fraction: number, label: string) => void;

/**
 * Thrown by `loadFile` when a newer request has replaced it. Its result was
 * going to be thrown away, so this is not a failure to show the user.
 */
export class LoadSuperseded extends Error {
  constructor(file: File, options?: ErrorOptions) {
    super(`${file.name} was replaced by a newer load`, options);
    this.name = 'LoadSuperseded';
  }
}

/** Frees every GPU resource under a subtree. */
export function disposeSubtree(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    if (!isMesh(obj)) return;
    // The renderer frees an instanced mesh's matrix/colour buffers from the
    // mesh's own dispose event; disposing its geometry and materials never fires it.
    if (isInstancedMesh(obj)) obj.dispose();
    obj.geometry?.dispose();
    for (const mat of materialsOf(obj)) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if (isTexture(value)) textures.add(value);
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
    reader.addEventListener('load', () => {
      // `readAsArrayBuffer` guarantees an ArrayBuffer result, but check it
      // rather than assert it. A null result rejects instead of exploding
      // downstream in the GLTF parser.
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Could not read file'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read file')),
    );
    reader.readAsArrayBuffer(file);
  });
}

export class SceneLoader {
  private current: Object3D | null = null;
  /** Counts `loadFile` calls; only the latest one may touch the viewer. */
  private generation = 0;

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

  /**
   * Latest request wins. Two files can be in flight at once (a drop while one is
   * still loading, or Open twice) and finish in either order; without this the
   * older one could land last and replace the file the user asked for most
   * recently. A replaced load throws `LoadSuperseded` and, from that point,
   * neither reports progress nor changes the scene.
   */
  async loadFile(file: File, onProgress: ProgressFn = () => {}): Promise<LoadedScene> {
    const generation = ++this.generation;
    const stale = () => generation !== this.generation;
    const progress: ProgressFn = (fraction, label) => {
      if (!stale()) onProgress(fraction, label);
    };

    try {
      const buffer = await readFile(file, progress);
      if (stale()) throw new LoadSuperseded(file);
      progress(0.55, 'Parsing glTF…');

      const loader = createGLTFLoader(this.viewer.renderer);
      const gltf: GLTF = await loader.parseAsync(buffer, '');
      if (stale()) throw new LoadSuperseded(file);

      // Nothing below awaits, so no other request can slip in before the swap.
      progress(0.85, 'Preparing materials…');

      // `gltf.scene` is typed as always present, but a glTF with no `scenes` array
      // is valid JSON and parses to `undefined`.
      const root: Object3D | undefined = gltf.scene ?? gltf.scenes[0];
      if (!root) throw new Error(`${file.name} contains no scene`);
      root.name = root.name || file.name;
      // Everything that can throw happens here, on the detached root, so a bad file
      // leaves the scene on screen (and the UI describing it) untouched.
      const processed = processScene(root);
      const used = new Set(
        ((gltf.parser.json as { extensionsUsed?: string[] }).extensionsUsed ?? []).map(String),
      );

      this.unload();
      this.viewer.scene.add(root);
      this.current = root;

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

      progress(1, 'Done');
      logSceneReport(scene, file);
      return scene;
    } catch (err) {
      // Whatever a replaced load ran into no longer matters.
      if (stale() && !(err instanceof LoadSuperseded)) {
        throw new LoadSuperseded(file, { cause: err });
      }
      throw err;
    }
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
  if (scene.startCam) console.log('START_CAM found. Using it for the initial view.');
  if (scene.lights.length) console.log(`${scene.lights.length} punctual light(s) in the file.`);

  if (size.y > 100 || size.y < 0.5) {
    console.warn(
      '[scene] The scene is an unusual height for an apartment. Check the "Scene unit" / scale setting in the glTF exporter.',
    );
  }
  console.groupEnd();
}
