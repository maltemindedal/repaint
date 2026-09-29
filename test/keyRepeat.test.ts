// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ignoreKeyRepeat } from '../src/util/dom.ts';

/**
 * Holding a key sends a stream of keydown events with `repeat` set. Shortcuts are
 * one-shot, so the app acts on the first and ignores the rest.
 */
const keydown = (code: string, repeat: boolean) =>
  new KeyboardEvent('keydown', { code, repeat, cancelable: true });

describe('ignoreKeyRepeat', () => {
  it('lets a fresh press through, untouched', () => {
    const event = keydown('KeyT', false);

    expect(ignoreKeyRepeat(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a fresh Tab or Backquote press through without preventing its default itself', () => {
    // The caller decides what a fresh Tab or Backquote does, including its default.
    for (const code of ['Tab', 'Backquote']) {
      const event = keydown(code, false);
      expect(ignoreKeyRepeat(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it.each(['KeyT', 'KeyP', 'KeyR', 'KeyF', 'KeyL', 'Digit1', 'Escape'])(
    'ignores a repeat of %s',
    (code) => {
      const event = keydown(code, true);

      expect(ignoreKeyRepeat(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it.each(['Tab', 'Backquote'])(
    'ignores a repeat of %s but still keeps the browser from acting on it',
    (code) => {
      const event = keydown(code, true);

      expect(ignoreKeyRepeat(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    },
  );
});
