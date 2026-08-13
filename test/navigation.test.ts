import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const live: NavigationController[] = [];

function buildNav(startPose: CameraPose = ORBIT_POSE) {
  const canvas = new FakeCanvas();
  const camera = new PerspectiveCamera(60, 1.6, 0.1, 100);
  const nav = new NavigationController({ camera, canvas: canvas as unknown as HTMLElement });
  live.push(nav);
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
  fakeDocument.pointerLockElement = null;
  fakeDocument.exitPointerLockCalls = 0;
});

afterEach(() => {
  // Disposing also unhooks the pointer-lock listeners, so a controller from an
  // earlier test can't see the next one's lock changes.
  while (live.length > 0) live.pop()!.dispose();
});

describe('mode switching', () => {
  it('emits the pose that is actually on screen, once', () => {
    // Standing high and looking dead level at the far wall.
    const { nav, camera, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    expect(nav.mode).toBe('walk');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('walk');

    // Compare against the camera a frame later — that is what renders. Reading
    // getPose() back instead would only compare one function against itself.
    nav.update(1 / 60);
    expect(emitted).toHaveLength(1);
    expect(distance(emitted[0].pose.position, camera.position.toArray() as Triple)).toBeLessThan(
      1e-6,
    );
  });

  it('drops to eye height before reporting, so the view does not tilt', () => {
    const { nav, emitted } = buildNav({ position: [0, 2.1, 4], target: [0, 2.1, -4] });

    nav.switchMode('walk');

    // Pairing the old camera height with a target computed at the new one would
    // emit a level view as an ~8.5° downward tilt, which a restore then adopts.
    expect(emitted[0].pose.position[1]).toBeCloseTo(EYE_HEIGHT, 5);
    expect(pitchOf(emitted[0].pose)).toBeCloseTo(0, 1);
  });

  it('emits the restored pose, not the carried-over one', () => {
    const { nav, emitted } = buildNav();

    nav.switchMode('walk', WALK_POSE);

    expect(emitted).toHaveLength(1);
    // The carried-over camera stood at ORBIT_POSE; the emitted pose is where
    // walk mode actually ended up.
    expect(distance(emitted[0].pose.position, WALK_POSE.position)).toBeLessThan(1e-6);
    expect(distance(emitted[0].pose.position, ORBIT_POSE.position)).toBeGreaterThan(1);
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
