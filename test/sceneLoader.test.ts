// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, type WebGLRenderer } from 'three';
import { SceneLoader } from '../src/core/SceneLoader.ts';
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
