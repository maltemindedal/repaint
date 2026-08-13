import { Box3, Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

/** A person's eye can sit anywhere from a crouch to a stepladder. */
export const EYE_HEIGHT_RANGE = { min: 0.2, max: 6 } as const;

/** How fast Q/E crouch and stand you up. */
const RISE_METRES_PER_SECOND = 1.1;

/**
 * First-person walk state, tuned for standing still and staring at a wall.
 *
 * Both translation and rotation are critically damped rather than snapped:
 * judging a colour needs a stable image, and a camera that eases into place
 * beats one that jitters with every mouse tick.
 *
 * No collision — as specified. Movement is clamped to the scene bounding box
 * (slightly inset) so you can't wander off into the void.
 *
 * There is no DOM here: it is a state machine over held keys, accumulated look
 * deltas and that bounding box, so it can be stepped a frame at a time in a
 * test. `WalkControls` owns the listeners that drive it.
 *
 * Eye height lives here while walk mode runs — the scroll wheel and Q/E both
 * move it — but the module never *owns* the persisted value. Every change
 * leaves through `onEyeHeightChange`, so the listener that stores it is always
 * looking at what the user actually did.
 */
export class WalkMotion {
  speed = 2.4;
  sprintMultiplier = 3;
  lookSensitivity = 0.0022;
  /** 0 = no smoothing, 1 = never arrives. Applied per 60 Hz frame. */
  damping = 0.82;

  /** Key codes currently held, written by whoever is listening for them. */
  readonly keys = new Set<string>();

  private _eyeHeight = 1.65;

  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;

  private position = new Vector3();
  private velocity = new Vector3();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private bounds: Box3 | null = null;

  // Pose-change tracking: WASD and mouse-look mutate the camera every frame,
  // so instead of emitting per frame, note the movement and emit once after a
  // short quiet period. Without this, walking somewhere is never persisted.
  private lastEmitted = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
  private quietFor = 0;
  private poseDirty = false;

  /** Fired once the pose has settled after movement. */
  onPoseSettled: (() => void) | null = null;

  /** Fired for every accepted eye-height change, already clamped. */
  onEyeHeightChange: ((value: number) => void) | null = null;

  constructor(private camera: PerspectiveCamera) {}

  // --------------------------------------------------------------- state

  setBounds(bounds: Box3 | null): void {
    this.bounds = bounds;
  }

  /** Clamped because a hand-edited or imported settings file can carry anything. */
  setSpeed(value: number): void {
    this.speed = MathUtils.clamp(value, 0.2, 20);
  }

  /** The floor the eye stands on; 0 until a scene has given us its bounds. */
  private get floorY(): number {
    return this.bounds ? this.bounds.min.y : 0;
  }

  /**
   * Adopts the camera's transform, standing the eye at walking height.
   *
   * Writes the eye straight back to the camera rather than waiting for the next
   * `update()`: a pose read in between would pair the camera's old height with
   * a target computed from the new one, which is neither what renders nor a
   * coherent pose to restore — it reconstructs as a downward tilt.
   */
  syncFromCamera(): void {
    this.position.copy(this.camera.position);
    this.position.y = this.floorY + this._eyeHeight;
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.targetYaw = this.euler.y;
    this.pitch = this.targetPitch = this.euler.x;
    this.velocity.set(0, 0, 0);
    this.applyToCamera();
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

  // ----------------------------------------------------------- eye height

  get eyeHeight(): number {
    return this._eyeHeight;
  }

  /** A change originating here — the owner is told about it. */
  setEyeHeight(value: number): void {
    const clamped = MathUtils.clamp(value, EYE_HEIGHT_RANGE.min, EYE_HEIGHT_RANGE.max);
    // Q/E and the wheel keep calling this while held; only real movement is
    // worth waking the listener (and its debounced save) for.
    if (clamped === this._eyeHeight) return;
    this._eyeHeight = clamped;
    this.onEyeHeightChange?.(clamped);
  }

  /** Nudges the height by a delta, so callers never read it back out to write it. */
  nudgeEyeHeight(delta: number): void {
    this.setEyeHeight(this._eyeHeight + delta);
  }

  /**
   * Takes the height the owner already holds — a scene arriving with one of its
   * own. Silent when that height was usable: reporting it would be the owner
   * hearing its own value come back as though the user had moved, which is how
   * a scene the user never touched ends up with a stored height of its own.
   *
   * When it *wasn't* usable, say so. Storage only checks that a setting is a
   * finite number, so a hand-edited or imported file can carry a height no one
   * can stand at; clamping it in silence would leave the owner holding a value
   * walk mode refuses — two truths again.
   */
  adoptEyeHeight(value: number): void {
    const clamped = MathUtils.clamp(value, EYE_HEIGHT_RANGE.min, EYE_HEIGHT_RANGE.max);
    this._eyeHeight = clamped;
    if (clamped !== value) this.onEyeHeightChange?.(clamped);
  }

  // ----------------------------------------------------------------- look

  applyLook(dx: number, dy: number): void {
    this.targetYaw -= dx * this.lookSensitivity;
    this.targetPitch -= dy * this.lookSensitivity;
    const limit = Math.PI / 2 - 0.02;
    this.targetPitch = MathUtils.clamp(this.targetPitch, -limit, limit);
  }

  // --------------------------------------------------------------- frame

  update(dt: number): void {
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

    if (rise !== 0) this.nudgeEyeHeight(rise * dt * RISE_METRES_PER_SECOND);

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
    }
    this.position.y = this.floorY + this._eyeHeight;

    this.applyToCamera();
    this.trackPoseSettled(dt);
  }

  /** Emits `onPoseSettled` once the camera has been still for a beat. */
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
      this.onPoseSettled?.();
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
