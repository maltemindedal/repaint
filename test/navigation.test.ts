import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { must } from './helpers.ts';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { NavigationController } from '../src/nav/NavigationController.ts';
import type { CameraPose, NavMode } from '../src/types.ts';

/**
 * Mode switching as a state transition over a camera. No renderer or canvas.
 *
 * `OrbitControls` and `WalkControls` only ever need an event target and a few
 * layout numbers, so a stub element is enough to exercise the real controller
 * in node.
 */

const pointerLockListeners = new Set<() => void>();

const fakeDocument = {
  pointerLockElement: null as unknown,
  exitPointerLockCalls: 0,
  addEventListener(type: string, listener: () => void): void {
    if (type === 'pointerlockchange') pointerLockListeners.add(listener);
  },
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'pointerlockchange') pointerLockListeners.delete(listener);
  },
  exitPointerLock(): void {
    fakeDocument.exitPointerLockCalls += 1;
    fakeDocument.setPointerLock(null);
  },
  /** Locks (or releases) the pointer the way the browser would: state, then event. */
  setPointerLock(element: unknown): void {
    fakeDocument.pointerLockElement = element;
    for (const listener of pointerLockListeners) listener();
  },
};

class FakeCanvas {
  style: Record<string, string> = {};
  clientWidth = 800;
  clientHeight = 600;
  pointerLockRequests = 0;
  classList = { add(): void {}, remove(): void {}, toggle(): void {} };

  addEventListener(): void {}
  removeEventListener(): void {}
  getRootNode(): unknown {
    return fakeDocument;
  }
  get ownerDocument(): unknown {
    return fakeDocument;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  requestPointerLock(): void {
    this.pointerLockRequests += 1;
    fakeDocument.setPointerLock(this);
  }
}

beforeAll(() => {
  Object.assign(globalThis, {
    window: { addEventListener(): void {}, removeEventListener(): void {} },
    document: fakeDocument,
  });
});

const ORBIT_POSE: CameraPose = { position: [4, 2.1, 4], target: [0, 1, 0] };
const WALK_POSE: CameraPose = { position: [-1, 1.65, 2], target: [-1, 1.65, -1] };
const EYE_HEIGHT = 1.65;

function buildNav(startPose: CameraPose = ORBIT_POSE) {
  const canvas = new FakeCanvas();
  const camera = new PerspectiveCamera(60, 1.6, 0.1, 100);
  const nav = new NavigationController({ camera, canvas: canvas as unknown as HTMLElement });
  nav.setBounds(new Box3(new Vector3(-5, 0, -5), new Vector3(5, 2.6, 5)));
  nav.applyPose(startPose);

  // The store, as `App` wires it: the last emitted pose per mode, handed back
  // on the next switch into that mode.
  const emitted: { mode: NavMode; pose: CameraPose }[] = [];
  const poses = new Map<NavMode, CameraPose>();
  nav.onPoseChange = (mode, pose) => {
    emitted.push({ mode, pose });
    poses.set(mode, pose);
  };
  const store = {
    get: (mode: NavMode) => poses.get(mode) ?? null,
    set: (mode: NavMode, pose: CameraPose) => poses.set(mode, pose),
  };

  return { nav, camera, canvas, emitted, store };
}

type Triple = readonly [number, number, number];

function distance(a: Triple, b: Triple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The pitch a restored pose would reconstruct, in degrees. */
function pitchOf(pose: CameraPose): number {
  const dir = new Vector3().fromArray(pose.target).sub(new Vector3().fromArray(pose.position));
  return (Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 180) / Math.PI;
}

beforeEach(() => {
  // Controllers are never torn down. #6 deleted dispose() as untested fiction,
  // so drop the listeners by hand. Otherwise a controller from an earlier
  // test still sees the next one's lock changes.
  pointerLockListeners.clear();
  fakeDocument.pointerLockElement = null;
  fakeDocument.exitPointerLockCalls = 0;
});

describe('mode switching', () => {
  it('emits the pose that is actually on screen, once', () => {
    // Standing high and looking dead level at the far wall.
    const { nav, camera, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    expect(nav.mode).toBe('walk');
    expect(emitted).toHaveLength(1);
    expect(must(emitted[0]).mode).toBe('walk');

    // Compare against the camera a frame later. That is what renders. Reading
    // getPose() back instead would only compare one function against itself.
    nav.update(1 / 60);
    expect(emitted).toHaveLength(1);
    expect(
      distance(must(emitted[0]).pose.position, camera.position.toArray() as Triple),
    ).toBeLessThan(1e-6);
  });

  it('drops to eye height before reporting, so the view does not tilt', () => {
    const { nav, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    // Pairing the old camera height with a target computed at the new one would
    // emit a level view as an ~8.5° downward tilt, which a restore then adopts.
    expect(must(emitted[0]).pose.position[1]).toBeCloseTo(EYE_HEIGHT, 5);
    expect(pitchOf(must(emitted[0]).pose)).toBeCloseTo(0, 1);
  });

  it('emits the restored pose, not the carried-over one', () => {
    const { nav, emitted } = buildNav();

    nav.switchMode('walk', WALK_POSE);

    expect(emitted).toHaveLength(1);
    // The carried-over camera stood at ORBIT_POSE; the emitted pose is where
    // walk mode actually ended up.
    expect(distance(must(emitted[0]).pose.position, WALK_POSE.position)).toBeLessThan(1e-6);
    expect(distance(must(emitted[0]).pose.position, ORBIT_POSE.position)).toBeGreaterThan(1);
  });

  it("keeps each mode's pose stable across repeated toggles", () => {
    const { nav, store } = buildNav();
    store.set('orbit', ORBIT_POSE);
    store.set('walk', WALK_POSE);

    for (let i = 0; i < 3; i++) {
      nav.switchMode('walk', store.get('walk'));
      nav.switchMode('orbit', store.get('orbit'));
    }

    expect(distance(store.get('orbit')!.position, ORBIT_POSE.position)).toBeLessThan(1e-6);
    expect(distance(store.get('orbit')!.target, ORBIT_POSE.target)).toBeLessThan(1e-6);
    expect(distance(store.get('walk')!.position, WALK_POSE.position)).toBeLessThan(1e-6);
    // Walk stores a look-at point at a fixed distance, so only the direction
    // round-trips, but it must not rotate.
    const look = new Vector3()
      .fromArray(store.get('walk')!.target)
      .sub(new Vector3().fromArray(WALK_POSE.position));
    const original = new Vector3()
      .fromArray(WALK_POSE.target)
      .sub(new Vector3().fromArray(WALK_POSE.position));
    expect(look.normalize().dot(original.normalize())).toBeCloseTo(1, 6);
  });

  it('stands the camera at eye height when entering walk mode', () => {
    const { nav, camera } = buildNav();

    nav.switchMode('walk');
    nav.update(1 / 60);

    expect(camera.position.y).toBeCloseTo(1.65, 5);
  });

  it('ignores a switch to the mode already in effect', () => {
    const { nav, emitted } = buildNav();
    let modeChanges = 0;
    nav.onModeChange = () => modeChanges++;

    nav.switchMode('orbit', WALK_POSE);

    expect(emitted).toHaveLength(0);
    expect(modeChanges).toBe(0);
    expect(nav.getPose().position[1]).toBeCloseTo(ORBIT_POSE.position[1], 5);
  });
});

describe('pointer lock', () => {
  it('locks only in walk mode', () => {
    const { nav, canvas } = buildNav();

    nav.requestPointerLock();
    expect(canvas.pointerLockRequests).toBe(0);
    expect(nav.isPointerLocked).toBe(false);

    nav.switchMode('walk');
    nav.requestPointerLock();
    expect(canvas.pointerLockRequests).toBe(1);
    expect(nav.isPointerLocked).toBe(true);
  });

  it('releases the lock it holds', () => {
    const { nav } = buildNav();
    nav.switchMode('walk');
    nav.requestPointerLock();

    nav.exitPointerLock();

    expect(fakeDocument.exitPointerLockCalls).toBe(1);
    expect(nav.isPointerLocked).toBe(false);
  });

  it('releases the lock when leaving walk mode', () => {
    const { nav } = buildNav();
    nav.switchMode('walk');
    nav.requestPointerLock();

    nav.switchMode('orbit');

    expect(fakeDocument.exitPointerLockCalls).toBe(1);
    expect(nav.isPointerLocked).toBe(false);
  });
});

/** Frames until `update` first says the camera is at rest. Fails if it never does. */
function framesUntilStill(nav: NavigationController): number {
  for (let frame = 1; frame <= 1200; frame++) {
    if (!nav.update(1 / 60)) return frame;
  }
  throw new Error('the camera never came to rest');
}

/** OrbitControls' leftover damping inertia, which it keeps in a private field. */
const inertiaOf = (nav: NavigationController) =>
  (nav.orbit as unknown as { _sphericalDelta: { phi: number } })._sphericalDelta;

describe('reporting motion', () => {
  it('says a camera at rest is not moving', () => {
    const { nav } = buildNav();
    nav.update(1 / 60); // the first frame after the pose was applied

    expect(nav.update(1 / 60)).toBe(false);
    expect(nav.update(1 / 60)).toBe(false);
  });

  it('says so when something else has moved the camera since the last frame', () => {
    const { nav, camera } = buildNav();
    framesUntilStill(nav);

    camera.position.x += 0.5;

    expect(nav.update(1 / 60)).toBe(true);
    expect(framesUntilStill(nav)).toBeLessThan(5);
  });

  it('reports a move of a few hundredths of a millimetre, and ignores one nobody could see', () => {
    // Walk mode: the camera goes where the walker is, with no re-aiming to give the move
    // away. And 2e-5 m is under the 1e-4 that walk mode itself calls movement.
    const { nav } = buildNav(WALK_POSE);
    nav.switchMode('walk', WALK_POSE);
    framesUntilStill(nav);

    nav.walk.eye.x += 2e-5;
    expect(nav.update(1 / 60)).toBe(true);
    framesUntilStill(nav);

    nav.walk.eye.x += 1e-7;
    expect(nav.update(1 / 60)).toBe(false);
  });

  it('reports a turn of a fraction of a pixel across, and ignores one far below that', () => {
    const { nav } = buildNav();
    framesUntilStill(nav);

    // The pivot is a few metres away, so this is about 2e-4 rad; the next is 2e-7.
    nav.orbit.target.x += 0.001;
    expect(nav.update(1 / 60)).toBe(true);
    framesUntilStill(nav);

    nav.orbit.target.x += 1e-6;
    expect(nav.update(1 / 60)).toBe(false);
  });

  it('keeps reporting motion while an eased retarget is under way, then stops', () => {
    const { nav } = buildNav();
    framesUntilStill(nav);

    nav.focusPoint(new Vector3(1, 1, -2));
    const frames = framesUntilStill(nav);

    // A third of a second at 60 Hz, then the frame that lands it.
    expect(frames).toBeGreaterThan(15);
    expect(frames).toBeLessThan(30);
    expect(distance(nav.orbit.target.toArray() as Triple, [1, 1, -2])).toBeLessThan(1e-6);
  });

  it('keeps going through a retarget that moves nothing, so its end is still reported', () => {
    const { nav, emitted } = buildNav();
    framesUntilStill(nav);
    const reported = emitted.length;

    // Double-clicking the point that is already the pivot: the camera never
    // moves, but the animation still ends by reporting the pose.
    nav.focusPoint(nav.orbit.target.clone());
    const frames = framesUntilStill(nav);

    expect(frames).toBeGreaterThan(15);
    expect(emitted.length).toBe(reported + 1);
  });

  it('keeps reporting motion while walking, and until the stop has been reported', () => {
    const { nav, camera, emitted } = buildNav(WALK_POSE);
    nav.switchMode('walk', WALK_POSE);
    framesUntilStill(nav);
    const reported = emitted.length;
    const start = camera.position.clone();

    nav.walk.keys.add('KeyW');
    for (let frame = 0; frame < 60; frame++) expect(nav.update(1 / 60)).toBe(true);
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.5);

    nav.walk.keys.delete('KeyW');
    framesUntilStill(nav);

    // Walking stopped being reported as movement only after `onPoseSettled` had
    // fired: a loop that slept earlier would never save where you stopped.
    expect(nav.walk.settling).toBe(false);
    expect(emitted.length).toBe(reported + 1);
    expect(must(emitted[reported]).mode).toBe('walk');
  });

  it('keeps reporting motion while a look-around eases to a stop', () => {
    const { nav, camera } = buildNav(WALK_POSE);
    nav.switchMode('walk', WALK_POSE);
    framesUntilStill(nav);
    const facing = camera.quaternion.clone();

    nav.walk.applyLook(300, 0);

    expect(nav.update(1 / 60)).toBe(true);
    framesUntilStill(nav);
    expect(camera.quaternion.angleTo(facing)).toBeGreaterThan(0.3);
  });

  it('lets the loop sleep after walk mode is left inside its settle window', () => {
    const { nav } = buildNav(WALK_POSE);
    nav.switchMode('walk', WALK_POSE);
    framesUntilStill(nav);
    nav.walk.keys.add('KeyW');
    for (let frame = 0; frame < 30; frame++) nav.update(1 / 60);
    nav.walk.keys.delete('KeyW');
    nav.update(1 / 60);
    expect(nav.walk.settling).toBe(true);

    // Tab back to orbit before the stop was reported. Walk's timer can no longer
    // run, and must not keep the loop awake for the rest of the session.
    nav.switchMode('orbit');

    expect(() => framesUntilStill(nav)).not.toThrow();
  });

  describe('orbit inertia', () => {
    // A camera at the horizon limit: a drag into it leaves inertia in OrbitControls
    // (its `_sphericalDelta`), which it spends only when `update()` is called, and
    // which moves nothing while the camera is pinned.
    const HORIZON: CameraPose = { position: [4, 1, 4], target: [0, 1, 0] };
    it('keeps updating after a release until the inertia is spent, though the camera cannot move', () => {
      const { nav } = buildNav(HORIZON);
      framesUntilStill(nav);
      inertiaOf(nav).phi = 1;

      nav.orbit.dispatchEvent({ type: 'end' });
      framesUntilStill(nav);

      // Frozen at 1, it would have been subtracted from the next drag.
      expect(Math.abs(inertiaOf(nav).phi)).toBeLessThan(1e-4);
    });

    it('does the same for a wheel notch, which starts and ends in one event', () => {
      const { nav } = buildNav(HORIZON);
      framesUntilStill(nav);
      inertiaOf(nav).phi = 1;

      nav.orbit.dispatchEvent({ type: 'start' });
      nav.orbit.dispatchEvent({ type: 'end' });
      const frames = framesUntilStill(nav);

      expect(frames).toBeGreaterThan(100);
      expect(Math.abs(inertiaOf(nav).phi)).toBeLessThan(1e-4);
    });

    it('keeps updating for as long as a pointer is held, however still it is', () => {
      const { nav } = buildNav(HORIZON);
      framesUntilStill(nav);
      inertiaOf(nav).phi = 1;

      nav.orbit.dispatchEvent({ type: 'start' });
      for (let frame = 0; frame < 300; frame++) expect(nav.update(1 / 60)).toBe(true);
      // Spent while held, as it was when every frame was drawn.
      expect(Math.abs(inertiaOf(nav).phi)).toBeLessThan(1e-4);

      nav.orbit.dispatchEvent({ type: 'end' });
      expect(framesUntilStill(nav)).toBeGreaterThan(100);
    });

    it('lets go of a held gesture when walk mode takes over, for good', () => {
      const { nav } = buildNav(HORIZON);
      framesUntilStill(nav);
      nav.orbit.dispatchEvent({ type: 'start' });

      nav.switchMode('walk');
      nav.switchMode('orbit');

      // Its `end` never came (walk mode had disabled the controls), and must not be waited for.
      expect(() => framesUntilStill(nav)).not.toThrow();
    });
  });

  it('is still while the pointer sits idle in walk mode', () => {
    const { nav } = buildNav(WALK_POSE);
    nav.switchMode('walk', WALK_POSE);
    framesUntilStill(nav);

    for (let frame = 0; frame < 120; frame++) expect(nav.update(1 / 60)).toBe(false);
  });
});
