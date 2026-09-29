// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, type WebGLRenderer } from 'three';
import { LoadSuperseded, SceneLoader } from '../src/core/SceneLoader.ts';
import type { Viewer } from '../src/core/Viewer.ts';
import { makeGlb } from './helpers.ts';

/**
 * `SceneLoader` only touches the viewer's scene graph and hands its renderer to
 * the loaders (KTX2 asks which texture formats the GPU has), so a bare scene and
 * a renderer that reports no extensions are all it needs.
 */
function harness() {
  const scene = new Scene();
  const renderer = {
    extensions: { has: () => false, get: () => null },
  } as unknown as WebGLRenderer;
  const loader = new SceneLoader({ scene, renderer } as unknown as Viewer);
  return { scene, loader };
}

const glbFile = (name: string, json?: Record<string, unknown>) =>
  new File([makeGlb('PAINT_Test', json)], name);

describe('SceneLoader.loadFile', () => {
  // The scene report writes a collapsed console group per load.
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  afterEach(() => vi.clearAllMocks());

  it('puts the file into the viewer scene, named after the file', async () => {
    const { scene, loader } = harness();

    const loaded = await loader.loadFile(glbFile('room.glb'));

    expect(scene.children).toEqual([loaded.root]);
    expect(loaded.root.name).toBe('room.glb');
    expect(loaded).toMatchObject({ key: 'room.glb', label: 'room.glb', isFallback: false });
    expect(loaded.stats).toMatchObject({ meshes: 1, triangles: 1, draco: false, ktx2: false });
  });

  it('reports progress up to done', async () => {
    const { loader } = harness();
    const progress: [number, string][] = [];

    await loader.loadFile(glbFile('room.glb'), (fraction, label) =>
      progress.push([fraction, label]),
    );

    expect(progress.at(-1)).toEqual([1, 'Done']);
    expect(progress.map(([fraction]) => fraction)).toEqual(progress.map(([f]) => f).toSorted());
  });

  it('replaces the previous scene rather than stacking on it', async () => {
    const { scene, loader } = harness();

    const first = await loader.loadFile(glbFile('one.glb'));
    const second = await loader.loadFile(glbFile('two.glb'));

    expect(scene.children).toEqual([second.root]);
    expect(first.root.parent).toBeNull();
  });

  it('keeps the current scene when the file is not a glTF at all', async () => {
    const { scene, loader } = harness();
    const first = await loader.loadFile(glbFile('one.glb'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(loader.loadFile(new File(['not a model'], 'notes.glb'))).rejects.toThrow();

    expect(scene.children).toEqual([first.root]);
  });

  it('keeps the current scene when the glTF contains no scene', async () => {
    const { scene, loader } = harness();
    const first = await loader.loadFile(glbFile('one.glb'));

    await expect(
      loader.loadFile(glbFile('empty.glb', { scene: undefined, scenes: undefined })),
    ).rejects.toThrow(/no scene/i);

    expect(scene.children).toEqual([first.root]);
    expect(first.root.parent).toBe(scene);
  });
});

describe('SceneLoader with overlapping requests', () => {
  /**
   * A FileReader that finishes only when the test says so, to put two loads in
   * flight and finish them in either order.
   */
  const held = new Map<string, () => void>();
  class HeldReader extends EventTarget {
    result: ArrayBuffer | null = null;
    error: Error | null = null;
    readAsArrayBuffer(file: File): void {
      held.set(file.name, () => {
        void file.arrayBuffer().then((buffer) => {
          this.result = buffer;
          this.dispatchEvent(new Event('load'));
        });
      });
    }
  }
  const release = async (name: string) => {
    held.get(name)?.();
    // Let the read, the parse and the continuation run.
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  afterEach(() => {
    held.clear();
    vi.unstubAllGlobals();
  });

  it('shows the file requested last even when an older one finishes after it', async () => {
    vi.stubGlobal('FileReader', HeldReader);
    const { scene, loader } = harness();

    const older = loader.loadFile(glbFile('older.glb'));
    const newer = loader.loadFile(glbFile('newer.glb'));
    const olderResult = older.then(
      () => 'loaded',
      (err: unknown) => err,
    );

    await release('newer.glb');
    const loaded = await newer;
    await release('older.glb');

    expect(await olderResult).toBeInstanceOf(LoadSuperseded);
    expect(scene.children).toEqual([loaded.root]);
    expect(loaded.label).toBe('newer.glb');
  });

  it('drops the older file when it finishes first, too', async () => {
    vi.stubGlobal('FileReader', HeldReader);
    const { scene, loader } = harness();

    const older = loader.loadFile(glbFile('older.glb'));
    const newer = loader.loadFile(glbFile('newer.glb'));
    const olderResult = older.then(
      () => 'loaded',
      (err: unknown) => err,
    );

    await release('older.glb');
    expect(await olderResult).toBeInstanceOf(LoadSuperseded);
    expect(scene.children).toEqual([]);

    await release('newer.glb');
    const loaded = await newer;
    expect(scene.children).toEqual([loaded.root]);
  });

  it('stops reporting progress for a load that has been replaced', async () => {
    vi.stubGlobal('FileReader', HeldReader);
    const { loader } = harness();
    const olderProgress = vi.fn();

    const older = loader.loadFile(glbFile('older.glb'), olderProgress).catch(() => {});
    const newer = loader.loadFile(glbFile('newer.glb'));
    await release('older.glb');
    await older;
    await release('newer.glb');
    await newer;

    expect(olderProgress).not.toHaveBeenCalled();
  });

  it('reports a replaced load as superseded even if its own file was bad', async () => {
    vi.stubGlobal('FileReader', HeldReader);
    const { loader } = harness();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const older = loader.loadFile(new File(['not a model'], 'older.glb'));
    const newer = loader.loadFile(glbFile('newer.glb'));
    const olderResult = older.then(
      () => 'loaded',
      (err: unknown) => err,
    );

    await release('older.glb');
    expect(await olderResult).toBeInstanceOf(LoadSuperseded);
    await release('newer.glb');
    await newer;
  });

  it('still reports a real failure for the newest load', async () => {
    vi.stubGlobal('FileReader', HeldReader);
    const { loader } = harness();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const only = loader.loadFile(new File(['not a model'], 'only.glb'));
    const result = only.then(
      () => 'loaded',
      (err: unknown) => err,
    );
    await release('only.glb');

    const err = await result;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoadSuperseded);
  });
});
