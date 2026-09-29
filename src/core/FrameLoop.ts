/** Longest step a frame may report: a background tab produces a huge first delta on return. */
const MAX_DT = 0.1;
/** What the first frame after a sleep reports: one 60 Hz frame, not the time spent asleep. */
const RESUMED_DT = 1 / 60;

export interface FrameLoopOptions {
  /**
   * Advances the world by `dt` seconds. Returns true while anything is still
   * moving, which is what keeps the loop going. `resumed` is true for the first
   * frame after the loop slept (and for the very first frame).
   */
  update: (dt: number, elapsed: number, resumed: boolean) => boolean;
  draw: () => void;
  /** True to draw every frame regardless, e.g. while an FPS meter is on screen. */
  keepAlive?: () => boolean;
  /** `requestAnimationFrame` unless a test supplies its own clock. */
  request?: (callback: (timestamp: number) => void) => unknown;
}

/**
 * Runs frames only while something needs one.
 *
 * A frame is an `update` followed by a `draw`. After a frame the loop asks for
 * another if `update` reported motion, if `invalidate` was called since, or if
 * `keepAlive` says so; otherwise it stops asking, and the page costs nothing
 * until the next `invalidate`. The frame that finds nothing moving is still drawn,
 * so what stays on screen is always the world as the last `update` left it.
 *
 * Anything that changes what the canvas shows without going through `update`
 * has to call `invalidate`. That is the one rule this design adds.
 */
export class FrameLoop {
  private readonly options: FrameLoopOptions;
  private readonly request: (callback: (timestamp: number) => void) => unknown;

  private started = false;
  private scheduled = false;
  private inFrame = false;
  /** `invalidate` was called during this frame, after its `update`. */
  private pending = false;
  /** When the previous frame began; null while asleep, so the next frame is `resumed`. */
  private last: number | null = null;
  private origin: number | null = null;

  constructor(options: FrameLoopOptions) {
    this.options = options;
    this.request = options.request ?? ((callback) => requestAnimationFrame(callback));
  }

  /** Begins the loop. Until then `invalidate` does nothing. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.invalidate();
  }

  /** Something visible changed, or is about to: make sure a frame follows. */
  invalidate(): void {
    if (!this.started) return;
    // Mid-frame there is a frame in progress to draw it, unless `update` has
    // already run; then only another one will.
    if (this.inFrame) this.pending = true;
    else this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.request(this.frame);
  }

  private frame = (timestamp: number): void => {
    this.scheduled = false;
    const previous = this.last;
    const resumed = previous === null;
    this.origin ??= timestamp;
    const dt = resumed ? RESUMED_DT : Math.min(Math.max((timestamp - previous) / 1000, 0), MAX_DT);
    this.last = timestamp;

    // A frame that throws keeps the loop alive, as a bare rAF loop would: the
    // error is reported, and the next frame gets its chance.
    let more = true;
    this.inFrame = true;
    try {
      const moving = this.options.update(dt, (timestamp - this.origin) / 1000, resumed);
      // What `update` invalidated is drawn just below.
      this.pending = false;
      this.options.draw();
      more = moving || this.pending || (this.options.keepAlive?.() ?? false);
    } finally {
      this.inFrame = false;
      this.pending = false;
      if (more) this.schedule();
      else this.last = null;
    }
  };
}
