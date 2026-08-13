import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WalkControls } from './WalkControls.ts';
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
 * Owns both navigation modes and the hand-off between them.
 *
 * A bare switch never teleports the camera: each controller adopts the other's
 * final transform, so `Tab` is a change of input scheme, not of viewpoint. Only
 * an explicit `restorePose` moves you — back to where you last stood in the
 * mode you are entering.
 */
export class NavigationController {
  readonly orbit: OrbitControls;
  private readonly walk: WalkControls;

  private _mode: NavMode = 'orbit';
  private bounds: Box3 | null = null;
  private floorY = 0;

  /** Smooth double-click retarget. */
  private targetAnim: { from: Vector3; to: Vector3; t: number } | null = null;

  onModeChange: ((mode: NavMode) => void) | null = null;
  onPoseChange: ((mode: NavMode, pose: CameraPose) => void) | null = null;

  constructor(private host: NavHost) {
    this.orbit = new OrbitControls(host.camera, host.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.rotateSpeed = 0.55;
    this.orbit.zoomSpeed = 0.8;
    this.orbit.panSpeed = 0.7;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.35;
    this.orbit.maxDistance = 60;
    // Never orbit under the horizon of the target — keeps you out of the floor.
    this.orbit.maxPolarAngle = Math.PI / 2;

    this.walk = new WalkControls(host.camera, host.canvas);
    this.walk.enabled = false;

    this.orbit.addEventListener('end', () => this.emitPose());
    this.walk.onChange = () => this.emitPose();
  }

  // ---------------------------------------------------------------- mode

  get mode(): NavMode {
    return this._mode;
  }

  /**
   * Hands control to the other mode and settles the camera in one step.
   *
   * The incoming mode first adopts the outgoing one's transform; `restorePose`
   * — where this mode was last left — then overrides it. Only the settled pose
   * is emitted for the incoming mode, so a switch never reports the transform
   * carried over from the mode you just left.
   *
   * The mode being *left* reports its pose too, once, before the hand-off —
   * see below. So a switch emits twice, under two different modes, and never
   * twice for the same one.
   */
  switchMode(mode: NavMode, restorePose?: CameraPose | null): void {
    if (mode === this._mode) return;

    // Capture-out, then restore-in. Walk mode only reports a pose once the
    // camera has been still for half a second, so switching away sooner than
    // that would drop the spot you were actually standing at. Emitting here —
    // while `_mode` is still the outgoing one, so `getPose` reads the right
    // controller — persists it before the hand-off.
    this.emitPose();
    if (this._mode === 'walk') this.walk.markPoseSaved();

    this._mode = mode;

    if (mode === 'walk') {
      this.orbit.enabled = false;
      this.walk.enabled = true;
      this.walk.syncFromCamera();
      // Stand at eye height where the camera already is.
      this.walk.standAt(this.floorY);
      this.host.canvas.classList.add('walk-mode');
    } else {
      this.walk.enabled = false;
      this.walk.exitPointerLock();
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

  /** No-op outside walk mode — orbit has no use for a captured pointer. */
  requestPointerLock(): void {
    this.walk.requestPointerLock();
  }

  exitPointerLock(): void {
    this.walk.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.walk.isPointerLocked;
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

  update(dt: number): void {
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
  }

  // ------------------------------------------------------------ settings

  // #6 deleted these as pure pass-throughs, on the grounds that callers could
  // reach `walk` directly. They can't any more — the seam closed — so removing
  // them now would push complexity back onto `App`, which is the test #6 set.
  // The clamps stay where #6 put them, in WalkControls.

  setEyeHeight(value: number): void {
    this.walk.setEyeHeight(value);
  }

  setWalkSpeed(value: number): void {
    this.walk.setSpeed(value);
  }
}
