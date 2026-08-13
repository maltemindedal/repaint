import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { WalkMotion } from './WalkMotion.ts';
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
 *
 * This half is only input: pointer, wheel and key events become calls on a
 * `WalkMotion`, which holds the camera state and can be stepped without a DOM.
 * The state half is forwarded rather than exposed, so callers keep asking one
 * object about walk mode instead of learning which of the two halves to reach
 * for.
 */

/** Metres of eye height per unit of wheel delta. */
const WHEEL_TO_METRES = 0.0012;

export class WalkControls {
  enabled = false;

  private motion: WalkMotion;
  private dragging = false;
  private pointerLocked = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    camera: PerspectiveCamera,
    private domElement: HTMLElement,
  ) {
    this.motion = new WalkMotion(camera);

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

  /** Fired once the pose has settled after movement. */
  get onPoseSettled(): (() => void) | null {
    return this.motion.onPoseSettled;
  }

  set onPoseSettled(handler: (() => void) | null) {
    this.motion.onPoseSettled = handler;
  }

  /** Fired for every eye-height change, wherever it came from. */
  get onEyeHeightChange(): ((value: number) => void) | null {
    return this.motion.onEyeHeightChange;
  }

  set onEyeHeightChange(handler: ((value: number) => void) | null) {
    this.motion.onEyeHeightChange = handler;
  }

  get speed(): number {
    return this.motion.speed;
  }

  set speed(value: number) {
    this.motion.speed = value;
  }

  // Read-only, unlike `speed`: every write has to pick a direction, so it goes
  // through `setEyeHeight` (reported outward) or `adoptEyeHeight` (silent).
  get eyeHeight(): number {
    return this.motion.eyeHeight;
  }

  setEyeHeight(value: number): void {
    this.motion.setEyeHeight(value);
  }

  adoptEyeHeight(value: number): void {
    this.motion.adoptEyeHeight(value);
  }

  setBounds(bounds: Box3 | null): void {
    this.motion.setBounds(bounds);
  }

  /** Adopts the camera's current transform, so mode switches don't jump. */
  syncFromCamera(): void {
    this.motion.syncFromCamera();
  }

  setPose(position: Vector3, target: Vector3): void {
    this.motion.setPose(position, target);
  }

  getTargetPoint(distance = 3): Vector3 {
    return this.motion.getTargetPoint(distance);
  }

  get eye(): Vector3 {
    return this.motion.eye;
  }

  // ------------------------------------------------------------- pointer

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    this.dragging = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.motion.applyLook(event.movementX, event.movementY);
      return;
    }
    if (!this.dragging) return;
    this.motion.applyLook(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

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
    this.motion.nudgeEyeHeight(-event.deltaY * WHEEL_TO_METRES);
  };

  // ---------------------------------------------------------------- keys

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    this.motion.keys.add(event.code);
    if (this.enabled && MOVE_CODES.has(event.code)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.motion.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.motion.keys.clear();
    this.dragging = false;
  };

  // --------------------------------------------------------------- frame

  update(dt: number): void {
    if (!this.enabled) return;
    this.motion.update(dt);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
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
