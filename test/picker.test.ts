// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Color, PerspectiveCamera } from 'three';
import { Picker } from '../src/core/Picker.ts';
import type { PaintRegistry } from '../src/core/PaintRegistry.ts';
import type { Viewer } from '../src/core/Viewer.ts';
import type { PaintTarget } from '../src/types.ts';

/**
 * The picker only needs a canvas to listen on, a camera, and a way to ask for a
 * frame. What it reports back to the render loop is the point here: while a
 * selection pulse is fading the loop must keep going, and only then.
 */
function setup() {
  const canvas = document.createElement('canvas');
  const invalidate = vi.fn();
  const viewer = { canvas, camera: new PerspectiveCamera(), invalidate } as unknown as Viewer;
  const registry = {
    list: () => [],
    targetForMaterial: () => undefined,
  } as unknown as PaintRegistry;
  const picker = new Picker(viewer, registry);
  const material = { emissive: new Color(0, 0, 0) };
  const target = {
    key: 'wall',
    displayName: 'Wall',
    materials: [material],
    meshes: [],
  } as unknown as PaintTarget;
  return { picker, canvas, invalidate, material, target };
}

describe('Picker.update', () => {
  it('reports nothing moving when nothing is pulsing', () => {
    const { picker } = setup();
    expect(picker.update(1 / 60)).toBe(false);
  });

  it('reports motion for as long as a selection pulse fades, then stops', () => {
    const { picker, material, target } = setup();
    picker.selectPulse(target);

    expect(picker.update(0.3)).toBe(true);
    expect(material.emissive.r).toBeGreaterThan(0);
    expect(picker.update(0.3)).toBe(true);
    // The frame that ends the pulse restores the colour, and reports it done.
    expect(picker.update(0.3)).toBe(false);
    expect(material.emissive.r).toBeCloseTo(0, 6);
    expect(picker.update(1 / 60)).toBe(false);
  });

  it('starts no pulse when highlights are off', () => {
    const { picker, target } = setup();
    picker.highlightsEnabled = false;
    picker.selectPulse(target);
    expect(picker.update(0.1)).toBe(false);
  });
});

describe('Picker pointer input', () => {
  it('asks for a frame when the pointer moves over the canvas, to find what is under it', () => {
    const { canvas, invalidate } = setup();
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5 }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('asks for a frame when the pointer leaves, to clear the hover', () => {
    const { canvas, invalidate } = setup();
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
