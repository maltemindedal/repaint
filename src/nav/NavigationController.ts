import { Box3, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WalkControls } from './WalkControls.ts';
import { WalkMotion } from './WalkMotion.ts';
import type { CameraPose, NavMode } from '../types.ts';

/**
 * The slice of the viewer that navigation needs: a camera to drive, and an
 * element to listen on. Narrow enough that mode switching can be exercised
 * without a renderer.
 */
export interface NavHost {
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLElement;
}

/**
 * How far the camera must move in one frame to count as moving: 1e-6 m (the
 * threshold is squared), and a turn of about 9e-6 rad (`1 - |dot|` of two
 * orientations is about an eighth of the angle squared). Both are far below a
 * pixel at any distance the viewer allows, so a camera easing to a stop is drawn
 * until nobody could see it move, and no longer.
 */
const MOVE_EPSILON = 1e-12;
const TURN_EPSILON = 1e-11;

const ORBIT_DAMPING = 0.075;
/**
 * OrbitControls keeps its damping inertia (what a flick leaves behind) and only
 * spends it inside `update()`, by (1 - damping) each call. Against a polar limit the
 * camera does not move while that happens, so "the camera moved" cannot tell that
 * inertia is left: it would be frozen, then subtracted from the next drag. So after
 * a gesture, and for as long as one is held, `update()` keeps being called until
 * the inertia is down to about 1e-5 of what it was.
 */
const ORBIT_COAST_FRAMES = Math.ceil(Math.log(1e-5) / Math.log(1 - ORBIT_DAMPING));

/**
 * Owns both navigation modes and the hand-off between them.
 *
 * A bare switch never teleports the camera: each controller adopts the other's
 * final transform, so `Tab` is a change of input scheme, not of viewpoint. Only
 * an explicit `restorePose` moves you back to where you last stood in the
 * mode you are entering.
 */
export class NavigationController {
  readonly orbit: OrbitControls;
  /** Walk-mode camera state: ask this what walk mode is doing, and tell it to move. */
  readonly walk: WalkMotion;
  /** The listeners that drive `walk`. Pointer lock is forwarded below. */
  private readonly walkInput: WalkControls;

  private _mode: NavMode = 'orbit';
  private bounds: Box3 | null = null;
  private floorY = 0;

  /** Smooth double-click retarget. */
  private targetAnim: { from: Vector3; to: Vector3; t: number } | null = null;

  /** The camera as of the last `update`, to tell whether it is still moving. */
  private lastPosition: Vector3;
  private lastQuaternion: Quaternion;
  /** Between OrbitControls' `start` and `end`: a pointer is down or a wheel is turning. */
  private orbitGesture = false;
  /** Updates left to spend on the inertia a finished gesture leaves behind. */
  private orbitCoastFrames = 0;

  onModeChange: ((mode: NavMode) => void) | null = null;
  onPoseChange: ((mode: NavMode, pose: CameraPose) => void) | null = null;

  constructor(private host: NavHost) {
    this.orbit = new OrbitControls(host.camera, host.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = ORBIT_DAMPING;
    this.orbit.rotateSpeed = 0.55;
    this.orbit.zoomSpeed = 0.8;
    this.orbit.panSpeed = 0.7;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.35;
    this.orbit.maxDistance = 60;
    // Never orbit under the horizon of the target. This keeps you out of the floor.
    this.orbit.maxPolarAngle = Math.PI / 2;

    this.walk = new WalkMotion(host.camera);
    this.walkInput = new WalkControls(this.walk, host.canvas);
    this.walkInput.enabled = false;

    this.lastPosition = host.camera.position.clone();
    this.lastQuaternion = host.camera.quaternion.clone();

    this.orbit.addEventListener('start', () => {
      this.orbitGesture = true;
    });
    this.orbit.addEventListener('end', () => {
      this.orbitGesture = false;
      this.orbitCoastFrames = ORBIT_COAST_FRAMES;
      this.emitPose();
    });
    this.walk.onPoseSettled = () => this.emitPose();
  }

  // ---------------------------------------------------------------- mode

  get mode(): NavMode {
    return this._mode;
  }

  /**
   * Hands control to the other mode and settles the camera in one step.
   *
   * The incoming mode first adopts the outgoing one's transform; `restorePose`
   * where this mode was last left, then overrides it. Only the settled pose
   * is emitted, so a switch never reports the transform carried over from the
   * mode you just left.
   */
  switchMode(mode: NavMode, restorePose?: CameraPose | null): void {
    if (mode === this._mode) return;
    this._mode = mode;

    if (mode === 'walk') {
      this.orbit.enabled = false;
      this.orbitGesture = false;
      this.orbitCoastFrames = 0;
      this.walkInput.enabled = true;
      // Stands at eye height where the camera already is. Walk mode owns that
      // arithmetic, so it isn't repeated out here.
      this.walk.syncFromCamera();
      this.host.canvas.classList.add('walk-mode');
    } else {
      this.walkInput.enabled = false;
      this.walkInput.exitPointerLock();
      this.orbit.enabled = true;
      // Put the orbit pivot a few metres ahead of where you were looking.
      const forward = new Vector3(0, 0, -1).applyQuaternion(this.host.camera.quaternion);
      this.orbit.target.copy(this.host.camera.position).addScaledVector(forward, 2.5);
      this.orbit.update();
      this.host.canvas.classList.remove('walk-mode');
    }

    this.targetAnim = null;
    if (restorePose) this.applyPose(restorePose);
    this.onModeChange?.(mode);
    this.emitPose();
  }

  // -------------------------------------------------------- pointer lock

  /** No-op outside walk mode. Orbit has no use for a captured pointer. */
  requestPointerLock(): void {
    this.walkInput.requestPointerLock();
  }

  exitPointerLock(): void {
    this.walkInput.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.walkInput.isPointerLocked;
  }

  // -------------------------------------------------------------- bounds

  setBounds(bounds: Box3): void {
    this.bounds = bounds;
    this.floorY = bounds.min.y;
    this.walk.setBounds(bounds);

    const size = bounds.getSize(new Vector3());
    const diagonal = size.length();
    this.orbit.maxDistance = Math.max(10, diagonal * 2.5);
    this.orbit.minDistance = Math.max(0.15, diagonal * 0.01);
  }

  // --------------------------------------------------------------- poses

  applyPose(pose: CameraPose): void {
    const position = new Vector3().fromArray(pose.position);
    const target = new Vector3().fromArray(pose.target);

    this.host.camera.position.copy(position);
    this.host.camera.lookAt(target);

    if (this._mode === 'walk') {
      this.walk.setPose(position, target);
    } else {
      this.orbit.target.copy(target);
      this.orbit.update();
    }
    this.targetAnim = null;
  }

  getPose(): CameraPose {
    const position = this.host.camera.position.toArray() as [number, number, number];
    const target =
      this._mode === 'walk'
        ? (this.walk.getTargetPoint().toArray() as [number, number, number])
        : (this.orbit.target.toArray() as [number, number, number]);
    return { position, target };
  }

  private emitPose(): void {
    this.onPoseChange?.(this._mode, this.getPose());
  }

  /** Double-click in orbit mode: ease the pivot to the clicked surface. */
  focusPoint(point: Vector3): void {
    if (this._mode !== 'orbit') return;
    this.targetAnim = { from: this.orbit.target.clone(), to: point.clone(), t: 0 };
  }

  /** Frames the whole scene from a comfortable three-quarter angle. */
  frameScene(): void {
    if (!this.bounds) return;
    const center = this.bounds.getCenter(new Vector3());
    const size = this.bounds.getSize(new Vector3());
    const radius = Math.max(size.x, size.z, size.y) * 0.9;
    const eye = new Vector3(
      center.x + radius * 0.8,
      this.floorY + Math.max(1.6, size.y * 0.75),
      center.z + radius * 0.8,
    );
    if (this._mode === 'walk') {
      this.walk.setPose(eye, center);
    } else {
      this.host.camera.position.copy(eye);
      this.orbit.target.copy(center);
      this.orbit.update();
    }
    this.emitPose();
  }

  // --------------------------------------------------------------- frame

  /**
   * Advances the camera one frame. True while it still has somewhere to go: the
   * camera moved since the last frame, a double-click retarget is under way, orbit
   * is holding or still spending inertia, or walk mode is waiting out the pause
   * before it reports where you stopped.
   */
  update(dt: number): boolean {
    if (this.targetAnim) {
      const anim = this.targetAnim;
      anim.t = Math.min(1, anim.t + dt * 3.2);
      const eased = 1 - Math.pow(1 - anim.t, 3);
      this.orbit.target.lerpVectors(anim.from, anim.to, eased);
      if (anim.t >= 1) {
        this.targetAnim = null;
        this.emitPose();
      }
    }

    if (this._mode === 'orbit') {
      this.orbit.update();
      // Belt-and-braces floor clamp: panning can push the eye below the slab
      // even with maxPolarAngle limited.
      const minY = this.floorY + 0.08;
      if (this.host.camera.position.y < minY) this.host.camera.position.y = minY;
    } else {
      this.walk.update(dt);
    }

    // Each is evaluated every frame (no short-circuit): both keep a count or a snapshot.
    const moved = this.cameraMoved();
    const inertia = this.orbitSpendingInertia();
    return (
      moved ||
      this.targetAnim !== null ||
      inertia ||
      // `walk.update` only runs in walk mode, so that is the only place its
      // settle timer can finish; left in orbit mode it would never sleep.
      (this._mode === 'walk' && this.walk.settling)
    );
  }

  private orbitSpendingInertia(): boolean {
    if (this._mode !== 'orbit') return false;
    if (this.orbitGesture) return true;
    if (this.orbitCoastFrames === 0) return false;
    this.orbitCoastFrames--;
    return true;
  }

  /**
   * Whether the camera differs from the last frame's. `OrbitControls.update()`
   * answers a similar question, but with a threshold coarse enough that a damped
   * orbit would be called finished while it still had a little way to drift.
   */
  private cameraMoved(): boolean {
    const camera = this.host.camera;
    const moved =
      camera.position.distanceToSquared(this.lastPosition) > MOVE_EPSILON ||
      1 - Math.abs(camera.quaternion.dot(this.lastQuaternion)) > TURN_EPSILON;
    this.lastPosition.copy(camera.position);
    this.lastQuaternion.copy(camera.quaternion);
    return moved;
  }
}
