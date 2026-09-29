// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { WalkControls } from '../src/nav/WalkControls.ts';
import { WalkMotion } from '../src/nav/WalkMotion.ts';

/**
 * Keys are the only part of walk mode that touches the rest of the browser: a
 * key it swallows is a browser shortcut that stops working. The documented rule
 * (docs/reference/keyboard-shortcuts.md) is that anything pressed with Cmd, Ctrl
 * or Alt is passed through untouched.
 */
function walk() {
  const motion = new WalkMotion(new PerspectiveCamera());
  const element = document.createElement('div');
  document.body.appendChild(element);
  const controls = new WalkControls(motion, element);
  controls.enabled = true;
  return { motion, controls };
}

function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function release(code: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, ...init }));
}

describe('WalkControls keys', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('holds a movement key while it is down and lets go when it is released', () => {
    const { motion } = walk();

    press('KeyW');
    expect(motion.keys.has('KeyW')).toBe(true);
    release('KeyW');

    expect(motion.keys.has('KeyW')).toBe(false);
  });

  it('keeps the browser from scrolling or focusing on a movement key', () => {
    walk();

    expect(press('KeyS').defaultPrevented).toBe(true);
    expect(press('ArrowUp').defaultPrevented).toBe(true);
  });

  it('records Shift as the sprint modifier', () => {
    const { motion } = walk();

    press('ShiftLeft', { shiftKey: true });

    expect(motion.keys.has('ShiftLeft')).toBe(true);
  });

  it('sprints with a movement key held under Shift', () => {
    const { motion } = walk();

    press('ShiftLeft', { shiftKey: true });
    press('KeyW', { shiftKey: true });

    expect([...motion.keys].toSorted()).toEqual(['KeyW', 'ShiftLeft']);
  });

  it.each([
    ['Ctrl+S', 'KeyS', { ctrlKey: true }],
    ['Ctrl+D', 'KeyD', { ctrlKey: true }],
    ['Cmd+E', 'KeyE', { metaKey: true }],
    ['Alt+W', 'KeyW', { altKey: true }],
    ['Alt+Left (browser Back)', 'ArrowLeft', { altKey: true }],
    ['Cmd+Right', 'ArrowRight', { metaKey: true }],
  ])('leaves %s to the browser', (_label, code, init) => {
    const { motion } = walk();

    const event = press(code, init);

    expect(event.defaultPrevented).toBe(false);
    expect(motion.keys.has(code)).toBe(false);
  });

  it('does not walk while a chord is pressed', () => {
    const { motion } = walk();

    press('ControlLeft', { ctrlKey: true });
    press('KeyS', { ctrlKey: true });

    expect(motion.keys.size).toBe(0);
  });

  it('ignores keys typed into a text field', () => {
    const { motion } = walk();
    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));

    expect(motion.keys.size).toBe(0);
  });
});
