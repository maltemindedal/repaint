// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Viewer } from '../src/core/Viewer.ts';

/**
 * `Viewer` needs a WebGL context to construct, but `screenshot` only touches the
 * renderer's pixel ratio and size, one render, and `canvas.toBlob`. A Viewer
 * built without its constructor and given fakes for those is enough to drive it,
 * with `toBlob` held open so captures can overlap.
 */
function makeViewer() {
  const state = { ratio: 1, ratios: [] as number[], failNextRender: false };
  const renderer = {
    getPixelRatio: () => state.ratio,
    setPixelRatio: (ratio: number) => {
      state.ratio = ratio;
      state.ratios.push(ratio);
    },
    setSize: vi.fn(),
    render: vi.fn(() => {
      if (state.failNextRender) {
        state.failNextRender = false;
        throw new Error('render failed');
      }
    }),
  };
  const pending: ((blob: Blob | null) => void)[] = [];
  const canvas = document.createElement('canvas');
  canvas.toBlob = (callback) => void pending.push(callback);

  const viewer: Viewer = Object.create(Viewer.prototype);
  Object.assign(viewer, { renderer, canvas, scene: {}, camera: {} });
  return {
    viewer,
    state,
    renderer,
    pending,
    finishCapture: (blob: Blob | null) => pending.shift()?.(blob),
  };
}

const png = () => new Blob(['png'], { type: 'image/png' });

describe('Viewer.screenshot', () => {
  it('renders at twice the pixel ratio and puts the ratio back afterwards', async () => {
    const { viewer, state, finishCapture } = makeViewer();

    const shot = viewer.screenshot(2);
    expect(state.ratio).toBe(2);
    const blob = png();
    finishCapture(blob);

    expect(await shot).toBe(blob);
    expect(state.ratio).toBe(1);
  });

  it('caps the capture at a pixel ratio of 4', async () => {
    const { viewer, state, finishCapture } = makeViewer();
    state.ratio = 3;

    const shot = viewer.screenshot(2);
    expect(state.ratio).toBe(4);
    finishCapture(png());
    await shot;

    expect(state.ratio).toBe(3);
  });

  it('leaves the ratio alone when two captures overlap', async () => {
    const { viewer, state, finishCapture } = makeViewer();

    const first = viewer.screenshot(2);
    const second = viewer.screenshot(2);
    finishCapture(png());
    await Promise.all([first, second]);

    expect(state.ratio).toBe(1);
  });

  it('shares one capture between overlapping calls', async () => {
    const { viewer, pending, finishCapture } = makeViewer();

    const first = viewer.screenshot(2);
    const second = viewer.screenshot(2);
    expect(pending).toHaveLength(1);
    const blob = png();
    finishCapture(blob);

    expect(await first).toBe(blob);
    expect(await second).toBe(blob);
  });

  it('takes a fresh capture once the previous one has finished', async () => {
    const { viewer, pending, finishCapture } = makeViewer();

    const first = viewer.screenshot(2);
    finishCapture(png());
    await first;
    const second = viewer.screenshot(2);

    expect(pending).toHaveLength(1);
    finishCapture(png());
    await second;
  });

  it('puts the ratio back if rendering throws, and reports the failure', async () => {
    const { viewer, state } = makeViewer();
    state.failNextRender = true;

    await expect(viewer.screenshot(2)).rejects.toThrow('render failed');

    expect(state.ratio).toBe(1);
  });

  it('can capture again after a failure', async () => {
    const { viewer, state, finishCapture } = makeViewer();
    state.failNextRender = true;
    await expect(viewer.screenshot(2)).rejects.toThrow();

    const shot = viewer.screenshot(2);
    finishCapture(png());
    await shot;

    expect(state.ratio).toBe(1);
  });

  it('resolves with null when the canvas gives no image', async () => {
    const { viewer, finishCapture } = makeViewer();

    const shot = viewer.screenshot(2);
    finishCapture(null);

    expect(await shot).toBeNull();
  });
});
