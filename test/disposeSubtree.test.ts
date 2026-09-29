import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Texture,
  type EventDispatcher,
} from 'three';
import { disposeSubtree } from '../src/core/SceneLoader.ts';

/** Counts the 'dispose' events an object dispatches; that is what the renderer frees GPU memory on. */
function disposals(target: EventDispatcher<{ dispose: object }>) {
  const listener = vi.fn();
  target.addEventListener('dispose', listener);
  return listener;
}

describe('disposeSubtree', () => {
  it('frees the geometry, material and textures of every mesh, once each', () => {
    const map = new Texture();
    const material = new MeshStandardMaterial({ map });
    const geometry = new BoxGeometry();
    const root = new Group().add(new Group().add(new Mesh(geometry, material)));

    const freed = [disposals(geometry), disposals(material), disposals(map)];
    disposeSubtree(root);

    for (const listener of freed) expect(listener).toHaveBeenCalledTimes(1);
  });

  it('frees a texture shared by two materials only once', () => {
    const shared = new Texture();
    const root = new Group().add(
      new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: shared })),
      new Mesh(new BoxGeometry(), new MeshStandardMaterial({ lightMap: shared })),
    );

    const freed = disposals(shared);
    disposeSubtree(root);

    expect(freed).toHaveBeenCalledTimes(1);
  });

  it('frees the instance buffers of an instanced mesh (EXT_mesh_gpu_instancing)', () => {
    const instanced = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 4);
    const root = new Group().add(instanced);

    // The renderer releases the instance matrix/colour buffers from this event only.
    const freed = disposals(instanced);
    disposeSubtree(root);

    expect(freed).toHaveBeenCalledTimes(1);
  });

  it('detaches the subtree from its parent', () => {
    const parent = new Group();
    const root = new Group();
    parent.add(root);

    disposeSubtree(root);

    expect(root.parent).toBeNull();
    expect(parent.children).toEqual([]);
  });
});
