import { describe, expect, it, vi } from 'vitest';
import { FrameLoop, type FrameLoopOptions } from '../src/core/FrameLoop.ts';

/** A frame clock the test advances by hand, standing in for requestAnimationFrame. */
function makeLoop(overrides: Partial<FrameLoopOptions> = {}) {
  let queued: ((timestamp: number) => void) | null = null;
  let now = 1000;
  const log: string[] = [];
  const seen = { dts: [] as number[], resumed: [] as boolean[], elapsed: [] as number[] };
  const state = { moving: false, keepAlive: false };

  const loop = new FrameLoop({
    update: (dt, elapsed, resumed) => {
      log.push('update');
      seen.dts.push(dt);
      seen.elapsed.push(elapsed);
      seen.resumed.push(resumed);
      return state.moving;
    },
    draw: () => void log.push('draw'),
    keepAlive: () => state.keepAlive,
    request: (callback) => {
      expect(queued, 'a second frame was requested while one was already waiting').toBeNull();
      queued = callback;
    },
    ...overrides,
  });

  return {
    loop,
    log,
    seen,
    state,
    get waiting() {
      return queued !== null;
    },
    /** Runs the requested frame `ms` after the previous one. */
    frame(ms = 1000 / 60) {
      const callback = queued;
      if (!callback) throw new Error('no frame was requested');
      queued = null;
      now += ms;
      callback(now);
    },
  };
}

describe('FrameLoop', () => {
  it('asks for nothing until it is started, and invalidate before that does nothing', () => {
    const t = makeLoop();
    t.loop.invalidate();
    expect(t.waiting).toBe(false);

    t.loop.start();
    expect(t.waiting).toBe(true);
  });

  it('updates then draws each frame', () => {
    const t = makeLoop();
    t.loop.start();
    t.frame();
    expect(t.log).toEqual(['update', 'draw']);
  });

  it('goes to sleep after a frame in which nothing is moving, and stays asleep', () => {
    const t = makeLoop();
    t.loop.start();
    t.frame();
    expect(t.waiting).toBe(false);
    // The frame that found nothing moving was still drawn.
    expect(t.log).toEqual(['update', 'draw']);
  });

  it('keeps asking for frames while update reports motion', () => {
    const t = makeLoop();
    t.state.moving = true;
    t.loop.start();
    for (let i = 0; i < 5; i++) {
      expect(t.waiting).toBe(true);
      t.frame();
    }
    t.state.moving = false;
    expect(t.waiting).toBe(true);
    t.frame();
    expect(t.waiting).toBe(false);
    expect(t.log.filter((entry) => entry === 'draw')).toHaveLength(6);
  });

  it('wakes on invalidate, draws once, and sleeps again', () => {
    const t = makeLoop();
    t.loop.start();
    t.frame();
    expect(t.waiting).toBe(false);

    t.loop.invalidate();
    expect(t.waiting).toBe(true);
    t.frame();
    expect(t.waiting).toBe(false);
    expect(t.log).toEqual(['update', 'draw', 'update', 'draw']);
  });

  it('asks for one frame however many times it is invalidated first', () => {
    const t = makeLoop(); // the fake clock fails the test if a second one is requested
    t.loop.start();
    t.frame();
    t.loop.invalidate();
    t.loop.invalidate();
    t.loop.invalidate();
    t.frame();
    expect(t.log.filter((entry) => entry === 'draw')).toHaveLength(2);
  });

  it('draws what update invalidated in the same frame, without asking for another', () => {
    let loop!: FrameLoop;
    const t = makeLoop({
      update: () => {
        loop.invalidate(); // e.g. a hover change found while stepping
        return false;
      },
    });
    loop = t.loop;
    loop.start();
    t.frame();
    expect(t.waiting).toBe(false);
  });

  it('asks for another frame when the draw itself invalidates', () => {
    let loop!: FrameLoop;
    let times = 0;
    const t = makeLoop({
      draw: () => {
        if (times++ === 0) loop.invalidate();
      },
    });
    loop = t.loop;
    loop.start();
    t.frame();
    expect(t.waiting).toBe(true);
    t.frame();
    expect(t.waiting).toBe(false);
  });

  it('draws every frame while keepAlive says so, and sleeps once it stops', () => {
    const t = makeLoop();
    t.state.keepAlive = true;
    t.loop.start();
    for (let i = 0; i < 10; i++) t.frame();
    expect(t.waiting).toBe(true);

    t.state.keepAlive = false;
    t.frame();
    expect(t.waiting).toBe(false);
  });

  it('reports the frame step, clamped, and elapsed time from the first frame', () => {
    const t = makeLoop();
    t.state.moving = true;
    t.loop.start();
    t.frame(); // resumed: a nominal step
    t.frame(20);
    t.frame(500); // a stalled or backgrounded tab
    expect(t.seen.dts[0]).toBeCloseTo(1 / 60, 6);
    expect(t.seen.dts[1]).toBeCloseTo(0.02, 6);
    expect(t.seen.dts[2]).toBe(0.1);
    expect(t.seen.elapsed[0]).toBe(0);
    expect(t.seen.elapsed[1]).toBeCloseTo(0.02, 6);
    expect(t.seen.elapsed[2]).toBeCloseTo(0.52, 6);
  });

  it('never reports a negative step', () => {
    const t = makeLoop();
    t.state.moving = true;
    t.loop.start();
    t.frame();
    t.frame(-5);
    expect(t.seen.dts[1]).toBe(0);
  });

  it('flags the first frame after a sleep as resumed, with a nominal step, not the time asleep', () => {
    const t = makeLoop();
    t.loop.start();
    t.frame();
    expect(t.seen.resumed).toEqual([true]);

    t.loop.invalidate();
    t.frame(60_000); // a minute later
    expect(t.seen.resumed).toEqual([true, true]);
    expect(t.seen.dts[1]).toBeCloseTo(1 / 60, 6);
  });

  it('does not flag continuous frames as resumed', () => {
    const t = makeLoop();
    t.state.moving = true;
    t.loop.start();
    t.frame();
    t.frame();
    t.frame();
    expect(t.seen.resumed).toEqual([true, false, false]);
  });

  it('keeps going after a frame throws', () => {
    let fail = true;
    const t = makeLoop({
      update: () => {
        if (fail) throw new Error('boom');
        return false;
      },
    });
    t.loop.start();
    expect(() => t.frame()).toThrow('boom');
    expect(t.waiting).toBe(true);

    fail = false;
    t.frame();
    expect(t.waiting).toBe(false);
  });

  it('keeps going after a draw throws', () => {
    const draw = vi.fn(() => {
      throw new Error('context lost');
    });
    const t = makeLoop({ draw });
    t.loop.start();
    expect(() => t.frame()).toThrow('context lost');
    expect(t.waiting).toBe(true);
  });

  it('can be started twice without a second frame being requested', () => {
    const t = makeLoop();
    t.loop.start();
    t.loop.start();
    expect(t.waiting).toBe(true);
  });
});
