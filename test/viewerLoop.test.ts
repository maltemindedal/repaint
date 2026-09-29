// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Viewer needs a WebGL context to construct. Swapping in a renderer that only
 * records what it is asked lets its frame loop be driven for real: this is where
 * the rule that anything changing the picture asks for a frame is pinned down.
 */
const renderer = vi.hoisted(() => ({
  render: vi.fn(),
  setSize: vi.fn(),
  setPixelRatio: vi.fn(),
  getPixelRatio: () => 1,
}));
const environment = vi.hoisted(() => ({ fromScene: vi.fn(), dispose: vi.fn() }));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  return {
    ...three,
    WebGLRenderer: vi.fn(function () {
      return renderer;
    }),
    PMREMGenerator: vi.fn(function () {
      return environment;
    }),
  };
});

const { Viewer } = await import('../src/core/Viewer.ts');

let queued: FrameRequestCallback | null;
let now: number;
/** A Viewer never stops listening, so each test takes its window listeners back. */
let listeners: Parameters<typeof window.addEventListener>[];

/** Runs the requested animation frame, `ms` after the previous one. */
function frame(ms = 1000 / 60): void {
  const callback = queued;
  if (!callback) throw new Error('no frame was requested');
  queued = null;
  now += ms;
  callback(now);
}

function makeViewer() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const viewer = new Viewer(canvas);
  return { viewer, canvas };
}

/** A viewer that has drawn its first frame and gone to sleep. */
function sleepingViewer() {
  const made = makeViewer();
  made.viewer.start();
  frame();
  expect(queued).toBeNull();
  renderer.render.mockClear();
  return made;
}

beforeEach(() => {
  queued = null;
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    expect(queued, 'a second frame was requested while one was waiting').toBeNull();
    queued = callback;
    return 1;
  });
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((...args) => {
    listeners.push(args);
    add(...args);
  });
  environment.fromScene.mockReturnValue({ texture: { dispose: vi.fn() } });
  renderer.render.mockClear();
  renderer.setSize.mockClear();
  environment.fromScene.mockClear();
});

afterEach(() => {
  for (const [type, listener, options] of listeners) {
    window.removeEventListener(type, listener, options);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Viewer frame loop', () => {
  it('draws nothing until started, then draws once and sleeps', () => {
    const { viewer } = makeViewer();
    viewer.invalidate();
    expect(queued).toBeNull();

    viewer.start();
    frame();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(queued).toBeNull();
  });

  it('runs every frame callback each frame, and keeps going while any of them says it is moving', () => {
    const { viewer } = makeViewer();
    const ran: string[] = [];
    viewer.onFrame(() => (ran.push('a'), true));
    viewer.onFrame(() => (ran.push('b'), false));
    viewer.start();

    frame();
    expect(ran).toEqual(['a', 'b']);
    expect(queued).not.toBeNull();
  });

  it('sleeps once every callback says it has stopped', () => {
    const { viewer } = makeViewer();
    viewer.onFrame(() => false);
    viewer.start();
    frame();
    expect(queued).toBeNull();
  });

  it('draws every frame while keepAlive says so', () => {
    const { viewer } = makeViewer();
    let alive = true;
    viewer.keepAlive = () => alive;
    viewer.start();
    frame();
    frame();
    expect(queued).not.toBeNull();

    alive = false;
    frame();
    expect(queued).toBeNull();
  });

  it('does not count the first frame after a sleep towards the frame rate', () => {
    const { viewer } = makeViewer();
    viewer.onFrame(() => true);
    viewer.start();
    frame(); // resumed: its step is nominal, not a measurement
    frame(100);
    expect(viewer.fps).toBeCloseTo(10, 5);
  });
});

describe('Viewer asks for a frame when the picture changes', () => {
  const changes: [string, (viewer: InstanceType<typeof Viewer>) => void][] = [
    ['setExposure', (viewer) => viewer.setExposure(1.4)],
    ['setToneMapping', (viewer) => viewer.setToneMapping(false)],
    ['setEnvIntensity', (viewer) => viewer.setEnvIntensity(0.5)],
    ['setBackground', (viewer) => viewer.setBackground('#223344')],
    ['setMaxPixelRatio', (viewer) => viewer.setMaxPixelRatio(1)],
    ['invalidate', (viewer) => viewer.invalidate()],
  ];

  it.each(changes)('%s', (_name, change) => {
    const { viewer } = sleepingViewer();
    change(viewer);
    expect(queued).not.toBeNull();
    frame();
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('when the window is resized, which empties the canvas', () => {
    const { viewer } = sleepingViewer();
    void viewer;
    window.dispatchEvent(new Event('resize'));
    expect(renderer.setSize).toHaveBeenCalled();
    expect(queued).not.toBeNull();
  });

  it('when the context is restored, after the environment map is rebuilt', () => {
    const { canvas } = sleepingViewer();
    environment.fromScene.mockClear();

    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(environment.fromScene).toHaveBeenCalledTimes(1);
    expect(queued).not.toBeNull();
  });

  it('when the user does something (a key, a click, a pointer over the canvas)', () => {
    const { canvas } = sleepingViewer();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(queued).not.toBeNull();
    frame();

    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(queued).not.toBeNull();
  });

  it('but not for a pointer moving over the rest of the page', () => {
    sleepingViewer();
    document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(queued).toBeNull();
  });
});
