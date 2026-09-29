// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugPanel, type DebugHooks } from '../src/ui/DebugPanel.ts';
import { DEFAULT_SETTINGS } from '../src/state/store.ts';

/**
 * lil-gui's `listen()` is a loop that asks for an animation frame every frame for
 * as long as it listens. The panel's five read-only lines use it, and a timer feeds
 * them, so both must stop when the panel is hidden: otherwise a page with nothing
 * to draw is woken sixty times a second (and twice more) for the sake of numbers
 * nobody can see.
 */

let pending: Map<number, FrameRequestCallback>;
let nextId: number;

beforeEach(() => {
  pending = new Map();
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(nextId, callback);
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  // The panel starts a real interval; keep it from outliving the test.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  // The fps meter draws on a 2D canvas, which happy-dom does not provide.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      new Proxy(
        {},
        { get: () => () => undefined, set: () => true },
      ) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function hooks(overrides: Partial<DebugHooks> = {}): DebugHooks {
  return {
    settings: DEFAULT_SETTINGS,
    setSetting: vi.fn(),
    setEyeHeight: vi.fn(),
    setBackground: vi.fn(),
    setMaxPixelRatio: vi.fn(),
    frameScene: vi.fn(),
    resetColors: vi.fn(),
    logMaterialReport: vi.fn(),
    hasPunctualLights: () => false,
    hasBakedTextures: () => false,
    stats: () => null,
    ...overrides,
  };
}

/** Runs every pending animation frame once, as the browser would; the loops re-request. */
function runFrame(): void {
  const callbacks = [...pending.values()];
  pending.clear();
  for (const callback of callbacks) callback(0);
}

describe('DebugPanel polling', () => {
  it('runs no frame loop while hidden, including right after it is built', () => {
    const panel = new DebugPanel(hooks());
    panel.mount(document.body);

    runFrame();
    expect(pending.size).toBe(0);
  });

  it('polls its readouts every frame while shown', () => {
    const panel = new DebugPanel(hooks());
    panel.mount(document.body);

    panel.setVisible(true);
    expect(pending.size).toBe(5);
    runFrame();
    expect(pending.size).toBe(5);
    runFrame();
    expect(pending.size).toBe(5);
  });

  it('stops polling when hidden again, and starts again when shown', () => {
    const panel = new DebugPanel(hooks());
    panel.mount(document.body);
    panel.setVisible(true);
    runFrame();

    panel.setVisible(false);
    expect(pending.size).toBe(0);
    runFrame();
    expect(pending.size).toBe(0);

    panel.toggle();
    expect(pending.size).toBe(5);
  });
});

/** What the panel's text inputs show. */
const shown = () => [...document.querySelectorAll('input')].map((input) => input.value);

describe('DebugPanel readout timer', () => {
  it('has no timer running while hidden, including right after it is built', () => {
    const panel = new DebugPanel(hooks());
    panel.mount(document.body);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs one timer while shown, and none again once hidden', () => {
    const panel = new DebugPanel(hooks());
    panel.mount(document.body);

    panel.setVisible(true);
    expect(vi.getTimerCount()).toBe(1);
    panel.setVisible(true);
    expect(vi.getTimerCount()).toBe(1);

    panel.setVisible(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows current values the moment it is shown, and keeps them current while it is', () => {
    let lights = false;
    const panel = new DebugPanel(hooks({ hasPunctualLights: () => lights }));
    panel.mount(document.body);

    lights = true; // changed while the panel was hidden
    panel.setVisible(true);
    expect(shown()).toContain('in file');

    lights = false;
    vi.advanceTimersByTime(500);
    runFrame(); // lil-gui's own loop paints the changed value
    expect(shown()).toContain('none');
  });
});
