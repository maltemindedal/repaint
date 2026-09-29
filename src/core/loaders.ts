import { LoadingManager, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * A GLTFLoader with every compression path Blender (or gltf-transform) can
 * emit already wired up: DRACO geometry, KTX2/Basis textures, and meshopt.
 *
 * Decoder binaries are *not* fetched from a CDN. Since r180 the three.js
 * loaders resolve their own WASM through `new URL(…, import.meta.url)`, so Vite
 * emits version-matched copies into `dist/assets` and everything works offline.
 * That is why neither `setDecoderPath()` nor `setTranscoderPath()` is called
 * here. Overriding them would mean hand-copying binaries that must stay in
 * lockstep with the installed three version.
 *
 * The loaders are module-level singletons: each one spins up a worker pool, and
 * re-creating them per dropped file would leak workers.
 */

let draco: DRACOLoader | null = null;
let ktx2: KTX2Loader | null = null;

/**
 * A dropped file is read with `FileReader` and handed over as bytes, so the only
 * resources it can legitimately reference are ones embedded in it (`data:`) or
 * that GLTFLoader itself builds from a bufferView (`blob:`). Any other `uri` in
 * the glTF JSON would make the tab request a third-party address on the file's
 * say-so, which the README promises never happens, so it is refused.
 */
const EMBEDDED_URI = /^(?:data|blob):/i;

export function embeddedOnlyManager(): LoadingManager {
  const manager = new LoadingManager();
  // `about:blank` cannot be fetched, so a refused resource fails the way a 404 does.
  manager.setURLModifier((url) => (EMBEDDED_URI.test(url) ? url : 'about:blank'));
  return manager;
}

export function createGLTFLoader(renderer: WebGLRenderer): GLTFLoader {
  const loader = new GLTFLoader(embeddedOnlyManager());

  draco ??= new DRACOLoader();
  loader.setDRACOLoader(draco);

  ktx2 ??= new KTX2Loader();
  // detectSupport needs the live renderer to choose a transcode target
  // (ASTC / ETC / BC / uncompressed fallback) for this GPU.
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);

  loader.setMeshoptDecoder(MeshoptDecoder);

  return loader;
}
