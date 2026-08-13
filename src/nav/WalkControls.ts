import { WalkMotion } from './WalkMotion.ts';
import { isTypingTarget } from '../util/dom.ts';

/**
 * The input half of walk mode: pointer, wheel and key events become calls on a
 * `WalkMotion`, which holds the camera state.
 *
 * Nothing here reads that state back — the wheel nudges by a delta rather than
 * fetching the height to write it again — so this class stays a translation
 * layer between the DOM and the state machine, and callers with something to
 * ask about walk mode ask the `WalkMotion` directly.
 */

/** Metres of eye height per unit of wheel delta. */
const WHEEL_TO_METRES = 0.0012;

export class WalkControls {
  enabled = false;

  private dragging = false;
  private pointerLocked = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    private motion: WalkMotion,
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
