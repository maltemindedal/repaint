import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { NavigationController } from '../src/nav/NavigationController.ts';
import type { Viewer } from '../src/core/Viewer.ts';
import type { CameraPose, NavMode } from '../src/types.ts';

/**
 * Headless exercise of the mode hand-off. `NavigationController` only ever
 * touches `viewer.camera` and `viewer.canvas`, so a stub DOM is enough to drive
 * `update()` frame by frame in node and watch which poses get emitted.
 */

// ------------------------------------------------------------------ stub DOM

/** Minimal event target: enough for `addEventListener` plus manual dispatch. */
function makeEventTarget() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type: string, fn: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: Record<string, unknown> = {}) {
      for (const fn of listeners.get(type) ?? []) {
        fn({ target: null, preventDefault() {}, ...event });
      }
    },
  };
}

type StubTarget = ReturnType<typeof makeEventTarget>;

interface Harness {
  nav: NavigationController;
  camera: PerspectiveCamera;
  win: StubTarget;
  emitted: { mode: NavMode; pose: CameraPose }[];
}

const cleanup: (() => void)[] = [];

function makeHarness(): Harness {
  const win = makeEventTarget();
  const doc = { ...makeEventTarget(), pointerLockElement: null, exitPointerLock() {} };

  const canvas = {
    ...makeEventTarget(),
    style: {} as CSSStyleDeclaration,
    classList: { add() {}, remove() {}, toggle() {} },
    getRootNode: () => doc,
    ownerDocument: doc,
    requestPointerLock: () => Promise.resolve(),
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const prevWindow = globals.window;
  const prevDocument = globals.document;
  globals.window = win;
  globals.document = doc;

  const camera = new PerspectiveCamera(55, 1, 0.05, 500);
  camera.position.set(0, 1.65, 0);

  const viewer = { camera, canvas } as unknown as Viewer;
  const nav = new NavigationController(viewer);
  nav.setBounds(new Box3(new Vector3(-5, 0, -5), new Vector3(5, 2.6, 5)));

  const emitted: Harness['emitted'] = [];
  nav.onPoseChange = (mode, pose) => emitted.push({ mode, pose });

  cleanup.push(() => {
    nav.dispose();
    globals.window = prevWindow;
    globals.document = prevDocument;
  });

  return { nav, camera, win, emitted };
}

/** Advances the frame loop at a steady 60 Hz. */
function step(nav: NavigationController, frames: number): void {
  for (let i = 0; i < frames; i++) nav.update(1 / 60);
}

/** Orbit round-trips through spherical coordinates, so exact equality is out. */
function expectNear(actual: [number, number, number], expected: [number, number, number]): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
}

afterEach(() => {
  for (const fn of cleanup.splice(0).toReversed()) fn();
});

// -------------------------------------------------------------------- tests

describe('mode hand-off', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('emits the walk pose you were standing at, even when leaving immediately', () => {
    const { nav, camera, win, emitted } = harness;

    nav.setMode('walk');
    step(nav, 1);
    const start = camera.position.clone();
    // Ignore the pose carried over by the mode entry itself.
    emitted.length = 0;

    // Walk forward for half a second, then let go and switch straight away —
    // well inside the settle delay that would otherwise emit the pose.
    win.dispatch('keydown', { code: 'KeyW' });
    step(nav, 30);
    win.dispatch('keyup', { code: 'KeyW' });
    step(nav, 6);

    const standingAt = camera.position.clone();
    expect(standingAt.distanceTo(start)).toBeGreaterThan(0.5);

    // Nothing has settled, so the spot being stood on is still unsaved.
    expect(emitted).toHaveLength(0);

    nav.setMode('orbit');

    // Capture-out precedes restore-in: the walk pose must be banked before the
    // orbit pose the switch carries over, or the stale one survives instead.
    expect(emitted.map((e) => e.mode)).toEqual(['walk', 'orbit']);
    expect(new Vector3().fromArray(emitted[0].pose.position)).toEqual(standingAt);
  });

  it('emits the outgoing orbit pose when entering walk mode', () => {
    const { nav, camera, emitted } = harness;

    camera.position.set(2, 1.8, 3);
    nav.orbit.target.set(0, 1, 0);
    step(nav, 1);
    emitted.length = 0;

    nav.setMode('walk');

    expect(emitted[0].mode).toBe('orbit');
    expectNear(emitted[0].pose.position, [2, 1.8, 3]);
    expectNear(emitted[0].pose.target, [0, 1, 0]);
  });

  it('does not emit anything when the mode is unchanged', () => {
    const { nav, emitted } = harness;

    nav.setMode('orbit');

    expect(emitted).toHaveLength(0);
  });
});
