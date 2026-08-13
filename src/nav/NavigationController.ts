import { Box3, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WalkControls } from './WalkControls.ts';
import type { CameraPose, NavMode } from '../types.ts';
import type { Viewer } from '../core/Viewer.ts';

/**
 * Owns both navigation modes and the hand-off between them.
 *
 * Switching modes never teleports the camera: each controller adopts the other's
 * final transform, so `Tab` is a change of input scheme, not of viewpoint.
 */
export class NavigationController {
  readonly orbit: OrbitControls;
  readonly walk: WalkControls;

  private _mode: NavMode = 'orbit';
  private bounds: Box3 | null = null;
  private floorY = 0;

  /** Smooth double-click retarget. */
  private targetAnim: { from: Vector3; to: Vector3; t: number } | null = null;

  onModeChange: ((mode: NavMode) => void) | null = null;
  onPoseChange: ((mode: NavMode, pose: CameraPose) => void) | null = null;

  constructor(private viewer: Viewer) {
    this.orbit = new OrbitControls(viewer.camera, viewer.canvas);
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

    this.walk = new WalkControls(viewer.camera, viewer.canvas);
    this.walk.enabled = false;

    this.orbit.addEventListener('end', () => this.emitPose());
    this.walk.onChange = () => this.emitPose();
  }

  // ---------------------------------------------------------------- mode

  get mode(): NavMode {
    return this._mode;
  }

  setMode(mode: NavMode): void {
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
      const eye = this.walk.eye;
      eye.y = this.floorY + this.walk.eyeHeight;
      this.viewer.canvas.classList.add('walk-mode');
    } else {
      this.walk.enabled = false;
      this.walk.exitPointerLock();
      this.orbit.enabled = true;
      // Put the orbit pivot a few metres ahead of where you were looking.
      const forward = new Vector3(0, 0, -1).applyQuaternion(this.viewer.camera.quaternion);
      this.orbit.target.copy(this.viewer.camera.position).addScaledVector(forward, 2.5);
      this.orbit.update();
      this.viewer.canvas.classList.remove('walk-mode');
    }

    this.targetAnim = null;
    this.onModeChange?.(mode);
    this.emitPose();
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

    this.viewer.camera.position.copy(position);
    this.viewer.camera.lookAt(target);

    if (this._mode === 'walk') {
      this.walk.setPose(position, target);
    } else {
      this.orbit.target.copy(target);
      this.orbit.update();
    }
    this.targetAnim = null;
  }

  getPose(): CameraPose {
    const position = this.viewer.camera.position.toArray() as [number, number, number];
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
      this.viewer.camera.position.copy(eye);
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
      if (this.viewer.camera.position.y < minY) this.viewer.camera.position.y = minY;
    } else {
      this.walk.update(dt);
    }
  }
}
