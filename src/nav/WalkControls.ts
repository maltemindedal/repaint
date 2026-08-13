import { Box3, Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { isTypingTarget } from '../util/dom.ts';

/**
 * First-person controls tuned for standing still and staring at a wall.
 *
 * Both translation and rotation are critically damped rather than snapped:
 * judging a colour needs a stable image, and a camera that eases into place
 * beats one that jitters with every mouse tick.
 *
 * No collision — as specified. Movement is clamped to the scene bounding box
 * (slightly inset) so you can't wander off into the void.
 */

const UP = new Vector3(0, 1, 0);

export class WalkControls {
  enabled = false;

  eyeHeight = 1.65;
  speed = 2.4;
  sprintMultiplier = 3;
  lookSensitivity = 0.0022;
  /** 0 = no smoothing, 1 = never arrives. Applied per 60 Hz frame. */
  damping = 0.82;

  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;

  private position = new Vector3();
  private velocity = new Vector3();
  private keys = new Set<string>();
  private euler = new Euler(0, 0, 0, 'YXZ');

  private dragging = false;
  private pointerLocked = false;
  private bounds: Box3 | null = null;

  // Pose-change tracking: WASD and mouse-look mutate the camera every frame,
  // so instead of emitting per frame, note the movement and emit once after a
  // short quiet period. Without this, walking somewhere is never persisted.
  private lastEmitted = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
  private quietFor = 0;
  private poseDirty = false;

  /** Fired when the pose has settled after movement, and on eye-height changes. */
  onChange: (() => void) | null = null;

  constructor(
    private camera: PerspectiveCamera,
    private domElement: HTMLElement,
  ) {
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  // --------------------------------------------------------------- state

  setBounds(bounds: Box3 | null): void {
    this.bounds = bounds;
  }

  /** Adopts the camera's current transform, so mode switches don't jump. */
  syncFromCamera(): void {
    this.position.copy(this.camera.position);
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.targetYaw = this.euler.y;
    this.pitch = this.targetPitch = this.euler.x;
    this.velocity.set(0, 0, 0);
  }

  setPose(position: Vector3, target: Vector3): void {
    this.position.copy(position);
    const dir = target.clone().sub(position);
    this.targetYaw = this.yaw = Math.atan2(-dir.x, -dir.z);
    this.targetPitch = this.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    this.velocity.set(0, 0, 0);
    this.applyToCamera();
  }

  getTargetPoint(distance = 3): Vector3 {
    const dir = new Vector3(0, 0, -1).applyEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return this.position.clone().addScaledVector(dir, distance);
  }

  get eye(): Vector3 {
    return this.position;
  }

  // ------------------------------------------------------------- pointer

  private lastPointer = { x: 0, y: 0 };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    this.dragging = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.applyLook(event.movementX, event.movementY);
      return;
    }
    if (!this.dragging) return;
    this.applyLook(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private applyLook(dx: number, dy: number): void {
    this.targetYaw -= dx * this.lookSensitivity;
    this.targetPitch -= dy * this.lookSensitivity;
    const limit = Math.PI / 2 - 0.02;
    this.targetPitch = MathUtils.clamp(this.targetPitch, -limit, limit);
  }

  requestPointerLock(): void {
    if (!this.enabled) return;
    void this.domElement.requestPointerLock();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.domElement) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    this.domElement.classList.toggle('pointer-locked', this.pointerLocked);
  };

  /** Scroll changes eye height in walk mode (orbit's dolly makes no sense here). */
  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.setEyeHeight(this.eyeHeight - event.deltaY * 0.0012);
  };

  setEyeHeight(value: number): void {
    this.eyeHeight = MathUtils.clamp(value, 0.2, 6);
    this.onChange?.();
  }

  /** Clamped because a hand-edited or imported settings file can carry anything. */
  setSpeed(value: number): void {
    this.speed = MathUtils.clamp(value, 0.2, 20);
  }

  // ---------------------------------------------------------------- keys

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    this.keys.add(event.code);
    if (this.enabled && MOVE_CODES.has(event.code)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  // --------------------------------------------------------------- frame

  update(dt: number): void {
    if (!this.enabled) return;

    // Frame-rate independent exponential smoothing.
    const lerp = 1 - Math.pow(1 - this.damping, dt * 60);

    this.yaw = MathUtils.lerp(this.yaw, this.targetYaw, lerp);
    this.pitch = MathUtils.lerp(this.pitch, this.targetPitch, lerp);

    const forward =
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const strafe =
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const rise = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));

    if (rise !== 0) this.setEyeHeight(this.eyeHeight + rise * dt * 1.1);

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = this.speed * (sprint ? this.sprintMultiplier : 1);

    // Walk on the ground plane: looking up shouldn't launch you upward.
    const dir = new Vector3();
    if (forward !== 0 || strafe !== 0) {
      const ahead = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new Vector3().crossVectors(ahead, UP).normalize();
      dir.addScaledVector(ahead, forward).addScaledVector(right, strafe).normalize();
    }

    const desired = dir.multiplyScalar(speed);
    this.velocity.lerp(desired, 1 - Math.pow(0.0016, dt));
    this.position.addScaledVector(this.velocity, dt);

    if (this.bounds) {
      const pad = 0.25;
      this.position.x = MathUtils.clamp(
        this.position.x,
        this.bounds.min.x - pad,
        this.bounds.max.x + pad,
      );
      this.position.z = MathUtils.clamp(
        this.position.z,
        this.bounds.min.z - pad,
        this.bounds.max.z + pad,
      );
      this.position.y = this.bounds.min.y + this.eyeHeight;
    } else {
      this.position.y = this.eyeHeight;
    }

    this.applyToCamera();
    this.trackPoseSettled(dt);
  }

  /** Emits `onChange` once the camera has been still for a beat. */
  private trackPoseSettled(dt: number): void {
    const last = this.lastEmitted;

    // First frame: record a baseline without treating it as movement.
    // (NaN never compares true, so without this the check below is inert.)
    if (Number.isNaN(last.x)) {
      this.recordPose();
      return;
    }

    const moved =
      Math.abs(this.position.x - last.x) > 1e-4 ||
      Math.abs(this.position.y - last.y) > 1e-4 ||
      Math.abs(this.position.z - last.z) > 1e-4 ||
      Math.abs(this.yaw - last.yaw) > 1e-4 ||
      Math.abs(this.pitch - last.pitch) > 1e-4;

    if (moved) {
      this.poseDirty = true;
      this.quietFor = 0;
      this.recordPose();
      return;
    }

    if (!this.poseDirty) return;
    this.quietFor += dt;
    if (this.quietFor >= 0.5) {
      this.poseDirty = false;
      this.onChange?.();
    }
  }

  /**
   * Declares the current pose already persisted, so the settle timer stops
   * holding movement it no longer owes anyone. The mode switch banks the pose
   * on the way out; without this the two "needs saving" trackers disagree.
   */
  markPoseSaved(): void {
    this.poseDirty = false;
    this.quietFor = 0;
    this.recordPose();
  }

  private recordPose(): void {
    const last = this.lastEmitted;
    last.x = this.position.x;
    last.y = this.position.y;
    last.z = this.position.z;
    last.yaw = this.yaw;
    last.pitch = this.pitch;
  }

  private applyToCamera(): void {
    this.camera.position.copy(this.position);
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
  }
}

const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
