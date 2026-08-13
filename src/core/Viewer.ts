import {
  ACESFilmicToneMapping,
  Color,
  NoToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type FrameCallback = (dt: number, elapsed: number) => void;

/**
 * Renderer, camera, scene and the frame loop.
 *
 * Colour-management contract:
 *  - `outputColorSpace = SRGBColorSpace` and `ColorManagement` (on by default
 *    in three) mean every `Color.setStyle('#rrggbb')` is treated as sRGB and
 *    converted to the linear working space.
 *  - ACES filmic tone mapping is on by default because it matches a Cycles
 *    render far better than no tone mapping — but it is *not* colour accurate.
 *    Turn it off (Debug panel / `T`) when judging an exact hex.
 */
export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private timer = new Timer();
  private callbacks = new Set<FrameCallback>();
  private rafId = 0;
  private envTexture: Texture | null = null;
  private pmrem: PMREMGenerator | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private maxPixelRatio = 2;

  // Rolling FPS, used by the perf hint and the debug readout.
  private frameTimes: number[] = [];
  private _fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // Screenshots read the drawing buffer synchronously right after a render,
      // which is reliable without paying for a preserved buffer every frame.
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));

    // Neutral grey surround: a tinted background biases how you read a paint
    // sample sitting next to it.
    this.scene.background = new Color(0x1a1a1a);
    this.scene.environmentIntensity = 0.25;

    this.camera = new PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(3, 1.65, 3);

    this.resize();
    window.addEventListener('resize', this.resize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
    }
  }

  // ------------------------------------------------------------ environment

  /**
   * A low-intensity RoomEnvironment so untextured materials keep some
   * directional life. Kept quiet on purpose — with a baked scene the lightmap
   * should stay dominant.
   */
  initEnvironment(): void {
    if (this.envTexture) return;
    this.pmrem = new PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const room = new RoomEnvironment();
    const target = this.pmrem.fromScene(room, 0.04);
    this.envTexture = target.texture;
    this.scene.environment = this.envTexture;
    room.traverse((obj) => {
      const mesh = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
  }

  setEnvIntensity(value: number): void {
    this.scene.environmentIntensity = value;
  }

  setBackground(hex: string): void {
    (this.scene.background as Color).setStyle(hex, SRGBColorSpace);
  }

  // -------------------------------------------------------- tone mapping

  setExposure(value: number): void {
    this.renderer.toneMappingExposure = value;
  }

  setToneMapping(enabled: boolean): void {
    // three notices the change and recompiles affected programs on its own.
    this.renderer.toneMapping = enabled ? ACESFilmicToneMapping : NoToneMapping;
  }

  get toneMappingEnabled(): boolean {
    return this.renderer.toneMapping !== NoToneMapping;
  }

  setMaxPixelRatio(value: number): void {
    this.maxPixelRatio = value;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, value));
    this.resize();
  }

  // --------------------------------------------------------------- loop

  onFrame(fn: FrameCallback): () => void {
    this.callbacks.add(fn);
    return () => this.callbacks.delete(fn);
  }

  start(): void {
    if (this.rafId) return;
    const tick = (timestamp: number) => {
      this.rafId = requestAnimationFrame(tick);
      this.timer.update(timestamp);
      // Clamp: a background tab produces a huge first delta on return.
      const dt = Math.min(this.timer.getDelta(), 0.1);
      const elapsed = this.timer.getElapsed();
      this.trackFps(dt);
      for (const fn of this.callbacks) fn(dt, elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private trackFps(dt: number): void {
    if (dt <= 0) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    this._fps = this.frameTimes.length / sum;
  }

  get fps(): number {
    return this._fps;
  }

  // ------------------------------------------------------------- sizing

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  get size(): { width: number; height: number } {
    const parent = this.canvas.parentElement;
    return {
      width: parent?.clientWidth || window.innerWidth,
      height: parent?.clientHeight || window.innerHeight,
    };
  }

  // --------------------------------------------------------- screenshot

  /**
   * Renders one frame at `scale`x the on-screen resolution and returns a PNG
   * blob. Aspect ratio is unchanged, so the framing matches exactly what you
   * were looking at.
   */
  async screenshot(scale = 2): Promise<Blob | null> {
    const previousRatio = this.renderer.getPixelRatio();
    const { width, height } = this.size;
    const wanted = Math.min(previousRatio * scale, 4);

    this.renderer.setPixelRatio(wanted);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);

    const blob = await new Promise<Blob | null>((resolve) => {
      this.canvas.toBlob((b) => resolve(b), 'image/png');
    });

    this.renderer.setPixelRatio(previousRatio);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
    return blob;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    this.pmrem?.dispose();
    this.renderer.dispose();
  }
}
