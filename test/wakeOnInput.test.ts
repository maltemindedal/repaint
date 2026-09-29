// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wakeOnInput } from '../src/core/wakeOnInput.ts';

const stop: (() => void)[] = [];
afterEach(() => {
  for (const fn of stop.splice(0)) fn();
  document.body.replaceChildren();
});

function setup() {
  const canvas = document.createElement('canvas');
  const sidebar = document.createElement('div');
  const input = document.createElement('input');
  sidebar.append(input);
  document.body.append(canvas, sidebar);
  const wake = vi.fn();
  stop.push(wakeOnInput(window, canvas, wake));
  return { canvas, sidebar, input, wake };
}

const fire = (target: EventTarget, type: string, init: PointerEventInit = {}) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }));

describe('wakeOnInput', () => {
  it.each(['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'input', 'change'])(
    'wakes on %s, wherever it lands',
    (type) => {
      const { sidebar, wake } = setup();
      fire(sidebar, type);
      expect(wake).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['keydown', 'keyup'])('wakes on %s', (type) => {
    const { input, wake } = setup();
    input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, code: 'KeyW' }));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('wakes when the tab becomes visible again', () => {
    const { wake } = setup();
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('wakes for a pointer moving over the canvas', () => {
    const { canvas, wake } = setup();
    fire(canvas, 'pointermove');
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('ignores a pointer moving over the rest of the page', () => {
    const { sidebar, wake } = setup();
    fire(sidebar, 'pointermove');
    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes for a pointer moving with a button down, wherever it is', () => {
    const { sidebar, wake } = setup();
    fire(sidebar, 'pointermove', { buttons: 1 });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('hears the event before a handler on the element that handles it', () => {
    const { input, wake } = setup();
    const order: string[] = [];
    wake.mockImplementation(() => order.push('wake'));
    input.addEventListener('input', () => order.push('handler'));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(order).toEqual(['wake', 'handler']);
  });

  it('hears an event whose handler stops it from bubbling', () => {
    const { input, wake } = setup();
    input.addEventListener('click', (event) => event.stopPropagation());
    input.click();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('stops listening when told to', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const wake = vi.fn();
    const remove = wakeOnInput(window, canvas, wake);
    remove();
    fire(canvas, 'pointerdown');
    fire(canvas, 'pointermove');
    expect(wake).not.toHaveBeenCalled();
  });
});
