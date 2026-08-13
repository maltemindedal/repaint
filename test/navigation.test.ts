import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { NavigationController } from '../src/nav/NavigationController.ts';
import type { Viewer } from '../src/core/Viewer.ts';
import type { CameraPose, NavMode } from '../src/types.ts';

/**
 * Headless exercise of the mode hand-off.
 *
 * `NavigationController` is the one module under `nav/` that can be driven
 * without a renderer — it only reads `viewer.camera` and `viewer.canvas`. It
 * does need listeners, though, so unlike the smoke test this one stands up a
 * stub DOM on `globalThis` for the duration of each test. That is the whole
 * cost of keeping `environment: 'node'`; the alternative is a jsdom dependency
 * for a handful of `addEventListener` calls.
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
  /** Drops what's been recorded so far — used to ignore a mode entry's own emit. */
  resetEmitted(): void;
  /**
   * Restores the globals. There is no controller teardown to do: #6 deleted
   * `dispose()` from both nav classes as untested fiction, and nothing here
   * needs it — every harness builds its own stub window, document and canvas,
   * so the listeners a discarded controller leaves behind are attached to
   * objects that die with it.
   */
  dispose(): void;
}

function makeHarness(): Harness {
  const win = makeEventTarget();
  const doc = { ...makeEventTarget(), pointerLockElement: null, exitPointerLock() {} };
  const canvas = {
    ...makeEventTarget(),
    // `style` and `getRootNode` are reached by OrbitControls.connect,
    // `ownerDocument` by its disconnect, `classList` by the walk-mode class.
    style: {} as CSSStyleDeclaration,
    getRootNode: () => doc,
    ownerDocument: doc,
    classList: { add() {}, remove() {} },
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { window: globals.window, document: globals.document };
  const restore = () => {
    globals.window = previous.window;
    globals.document = previous.document;
  };
  globals.window = win;
  globals.document = doc;

  // Anything from here on can throw with the globals swapped in; leaving them
  // patched would corrupt every later test in the file.
  try {
    const camera = new PerspectiveCamera(55, 1, 0.05, 500);
    camera.position.set(0, 1.65, 0);

    // `Pick` names the exact surface the controller is allowed to touch: if it
    // grows a `viewer.renderer` read, this stops compiling rather than
    // throwing at runtime.
    const viewer: Pick<Viewer, 'camera' | 'canvas'> = {
      camera,
      canvas: canvas as unknown as HTMLCanvasElement,
    };

    const nav = new NavigationController(viewer as Viewer);
    nav.setBounds(new Box3(new Vector3(-5, 0, -5), new Vector3(5, 2.6, 5)));

    const emitted: Harness['emitted'] = [];
    nav.onPoseChange = (mode, pose) => emitted.push({ mode, pose });

    return {
      nav,
      camera,
      win,
      emitted,
      resetEmitted: () => void (emitted.length = 0),
      dispose: restore,
    };
  } catch (error) {
    restore();
    throw error;
  }
}

/** Advances the frame loop at a steady 60 Hz. */
function step(nav: NavigationController, frames: number): void {
  for (let i = 0; i < frames; i++) nav.update(1 / 60);
}

/** Orbit round-trips through spherical coordinates, so exact equality is out. */
function expectNear(actual: [number, number, number], expected: [number, number, number]): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
}

// -------------------------------------------------------------------- tests

describe('mode hand-off', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it('emits the walk pose you were standing at, even when leaving immediately', () => {
    const { nav, camera, win, emitted, resetEmitted } = harness;

    nav.setMode('walk');
    step(nav, 1);
    const start = camera.position.clone();
    resetEmitted();

    // Walk forward for half a second, then let go and switch straight away —
    // well inside the settle delay that would otherwise emit the pose.
    win.dispatch('keydown', { code: 'KeyW' });
    step(nav, 30);
    win.dispatch('keyup', { code: 'KeyW' });
    step(nav, 6);

    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.5);
    // Read while still in walk mode, so `getPose` takes the walk branch.
    const standingPose = nav.getPose();

    // Nothing has settled, so the spot being stood on is still unsaved.
    expect(emitted).toHaveLength(0);

    nav.setMode('orbit');

    // Capture-out precedes restore-in: the walk pose must be banked before the
    // orbit pose the switch carries over, or the stale one survives instead.
    expect(emitted.map((e) => e.mode)).toEqual(['walk', 'orbit']);
    expect(emitted[0].pose).toEqual(standingPose);
    // Position alone would pass even if the emit happened after `_mode` flipped;
    // the look direction is what proves it read the walk controller.
    expect(emitted[0].pose.target).not.toEqual(nav.orbit.target.toArray());
  });

  it('emits the outgoing orbit pose when entering walk mode', () => {
    const { nav, camera, emitted, resetEmitted } = harness;

    camera.position.set(2, 1.8, 3);
    nav.orbit.target.set(0, 1, 0);
    step(nav, 1);
    resetEmitted();

    nav.setMode('walk');

    expect(emitted[0].mode).toBe('orbit');
    expectNear(emitted[0].pose.position, [2, 1.8, 3]);
    expectNear(emitted[0].pose.target, [0, 1, 0]);
  });

  it('stops tracking a pose the switch already banked', () => {
    const { nav, win, emitted, resetEmitted } = harness;

    nav.setMode('walk');
    win.dispatch('keydown', { code: 'KeyW' });
    step(nav, 30);
    win.dispatch('keyup', { code: 'KeyW' });

    // Out and straight back in, without ever pausing long enough to settle.
    nav.setMode('orbit');
    nav.setMode('walk');
    resetEmitted();

    // A full second of stillness. The walk pose was banked on the way out, so
    // the settle timer has nothing left to report.
    step(nav, 60);

    expect(emitted).toHaveLength(0);
  });

  it('does not emit anything when the mode is unchanged', () => {
    const { nav, emitted } = harness;

    nav.setMode('orbit');

    expect(emitted).toHaveLength(0);
  });
});
