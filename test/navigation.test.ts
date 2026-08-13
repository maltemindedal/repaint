import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { NavigationController } from '../src/nav/NavigationController.ts';
import type { CameraPose, NavMode } from '../src/types.ts';

/**
 * Mode switching as a state transition over a camera — no renderer, no canvas.
 *
 * `OrbitControls` and `WalkControls` only ever need an event target and a few
 * layout numbers, so a stub element is enough to exercise the real controller
 * in node.
 */

const pointerLockListeners = new Set<() => void>();

/**
 * `WalkControls` binds WASD on `window`, so driving a walk needs a stub that
 * actually delivers events rather than swallowing them.
 */
const windowListeners = new Map<string, Set<(event: unknown) => void>>();

const fakeWindow = {
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(listener);
  },
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    windowListeners.get(type)?.delete(listener);
  },
  /** `target: null` so `isTypingTarget` reads it as "not typing". */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of windowListeners.get(type) ?? []) {
      listener({ target: null, preventDefault() {}, ...event });
    }
  },
};

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
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument });
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
  // Controllers are never torn down — #6 deleted dispose() as untested fiction
  // — so drop the listeners by hand; otherwise a controller from an earlier
  // test still sees the next one's lock changes and keystrokes.
  pointerLockListeners.clear();
  windowListeners.clear();
  fakeDocument.pointerLockElement = null;
  fakeDocument.exitPointerLockCalls = 0;
});

/** Advances the frame loop at a steady 60 Hz. */
function step(nav: NavigationController, frames: number): void {
  for (let i = 0; i < frames; i++) nav.update(1 / 60);
}

/**
 * The poses emitted for one mode. A switch reports twice — the mode being left
 * and the mode being entered — so a bare index would depend on which is which.
 */
function posesFor(emitted: { mode: NavMode; pose: CameraPose }[], mode: NavMode): CameraPose[] {
  return emitted.filter((e) => e.mode === mode).map((e) => e.pose);
}

describe('mode switching', () => {
  it('emits the pose that is actually on screen, once', () => {
    // Standing high and looking dead level at the far wall.
    const { nav, camera, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    expect(nav.mode).toBe('walk');
    // One pose for the mode entered. (The mode being left reports too, which is
    // what stops a quick exit from dropping where you stood — covered below.)
    expect(posesFor(emitted, 'walk')).toHaveLength(1);

    // Compare against the camera a frame later — that is what renders. Reading
    // getPose() back instead would only compare one function against itself.
    nav.update(1 / 60);
    expect(posesFor(emitted, 'walk')).toHaveLength(1);
    expect(
      distance(posesFor(emitted, 'walk')[0].position, camera.position.toArray() as Triple),
    ).toBeLessThan(1e-6);
  });

  it('drops to eye height before reporting, so the view does not tilt', () => {
    const { nav, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    // Pairing the old camera height with a target computed at the new one would
    // emit a level view as an ~8.5° downward tilt, which a restore then adopts.
    const [walkPose] = posesFor(emitted, 'walk');
    expect(walkPose.position[1]).toBeCloseTo(EYE_HEIGHT, 5);
    expect(pitchOf(walkPose)).toBeCloseTo(0, 1);
  });

  it('emits the restored pose, not the carried-over one', () => {
    const { nav, emitted } = buildNav();

    nav.switchMode('walk', WALK_POSE);

    const walkPoses = posesFor(emitted, 'walk');
    expect(walkPoses).toHaveLength(1);
    // The carried-over camera stood at ORBIT_POSE; the emitted pose is where
    // walk mode actually ended up.
    expect(distance(walkPoses[0].position, WALK_POSE.position)).toBeLessThan(1e-6);
    expect(distance(walkPoses[0].position, ORBIT_POSE.position)).toBeGreaterThan(1);
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
    // round-trips — but it must not rotate.
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

describe('leaving a mode', () => {
  it('emits the walk pose you were standing at, even when leaving immediately', () => {
    const { nav, camera, emitted } = buildNav();

    nav.switchMode('walk');
    step(nav, 1);
    const start = camera.position.clone();
    emitted.length = 0;

    // Walk forward for half a second, then let go and switch straight away —
    // well inside the settle delay that would otherwise emit the pose.
    fakeWindow.dispatch('keydown', { code: 'KeyW' });
    step(nav, 30);
    fakeWindow.dispatch('keyup', { code: 'KeyW' });
    step(nav, 6);

    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.5);
    // Read while still in walk mode, so `getPose` takes the walk branch.
    const standingPose = nav.getPose();

    // Nothing has settled, so the spot being stood on is still unsaved.
    expect(emitted).toHaveLength(0);

    nav.switchMode('orbit');

    // Capture-out precedes restore-in: the walk pose must be banked before the
    // orbit pose the switch settles on, or the stale one survives instead.
    expect(emitted.map((e) => e.mode)).toEqual(['walk', 'orbit']);
    expect(distance(emitted[0].pose.position, standingPose.position)).toBeLessThan(1e-6);
    // Position alone would pass even if the emit happened after the mode
    // flipped; the look direction is what proves it read the walk controller.
    expect(distance(emitted[0].pose.target, standingPose.target)).toBeLessThan(1e-6);
  });

  it('emits the outgoing orbit pose when entering walk mode', () => {
    const { nav, emitted } = buildNav();

    nav.switchMode('walk', WALK_POSE);

    const [orbitPose] = posesFor(emitted, 'orbit');
    expect(orbitPose).toBeDefined();
    expect(distance(orbitPose.position, ORBIT_POSE.position)).toBeLessThan(1e-6);
    expect(distance(orbitPose.target, ORBIT_POSE.target)).toBeLessThan(1e-6);
  });

  it('stops tracking a pose the switch already banked', () => {
    const { nav, emitted } = buildNav();

    nav.switchMode('walk');
    fakeWindow.dispatch('keydown', { code: 'KeyW' });
    step(nav, 30);
    fakeWindow.dispatch('keyup', { code: 'KeyW' });

    // Out and straight back in, without ever pausing long enough to settle.
    nav.switchMode('orbit');
    nav.switchMode('walk');
    emitted.length = 0;

    // A full second of stillness. The walk pose was banked on the way out, so
    // the settle timer has nothing left to report.
    step(nav, 60);

    expect(emitted).toHaveLength(0);
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
