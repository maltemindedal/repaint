import GUI from 'lil-gui';
import Stats from 'stats.js';
import { EYE_HEIGHT_RANGE } from '../nav/WalkMotion.ts';
import type { AppliedSettingKey, SceneSettings, SceneStats } from '../types.ts';

export interface DebugHooks {
  settings: SceneSettings;
  setSetting: <K extends AppliedSettingKey>(key: K, value: SceneSettings[K]) => void;
  /** Eye height has its own hook: walk mode owns it, and reports it back. */
  setEyeHeight: (value: number) => void;
  setBackground: (hex: string) => void;
  setMaxPixelRatio: (value: number) => void;
  frameScene: () => void;
  resetColors: () => void;
  logMaterialReport: () => void;
  hasPunctualLights: () => boolean;
  hasBakedTextures: () => boolean;
  stats: () => SceneStats | null;
}

const MB = 1024 * 1024;

/**
 * lil-gui panel + stats.js meter, hidden behind the backtick key.
 *
 * Every control here changes how the scene *looks*, so it stays out of the way
 * by default — the point of the app is judging colour, not fiddling with
 * exposure.
 */
export class DebugPanel {
  private gui: GUI;
  private stats: Stats;
  private visible = false;
  private proxy: Record<string, unknown>;
  private infoControllers: { name: string; get: () => string }[] = [];
  private infoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private hooks: DebugHooks) {
    this.gui = new GUI({ title: 'Debug  ·  ` to hide', width: 300 });
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '12px';
    this.gui.domElement.style.right = '12px';

    this.stats = new Stats();
    this.stats.showPanel(0);
    const dom = this.stats.dom;
    dom.style.position = 'absolute';
    dom.style.top = '12px';
    dom.style.left = '';
    dom.style.right = '312px';
    dom.style.zIndex = '40';

    const s = hooks.settings;
    this.proxy = {
      exposure: s.exposure,
      toneMapping: s.toneMapping,
      background: '#1a1a1a',
      maxPixelRatio: 2,
      lightMapIntensity: s.lightMapIntensity,
      aoMapIntensity: s.aoMapIntensity,
      envIntensity: s.envIntensity,
      punctualLights: s.punctualLights,
      eyeHeight: s.eyeHeight,
      walkSpeed: s.walkSpeed,
      highlights: s.highlights,
    };

    this.buildRendering();
    this.buildBakedLighting();
    this.buildNavigation();
    this.buildScene();

    this.setVisible(false);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.gui.domElement);
    parent.appendChild(this.stats.dom);
  }

  private buildRendering(): void {
    const folder = this.gui.addFolder('Rendering');
    folder
      .add(this.proxy, 'exposure', 0.1, 3, 0.01)
      .name('Exposure')
      .onChange((v: number) => this.hooks.setSetting('exposure', v));
    folder
      .add(this.proxy, 'toneMapping')
      .name('ACES tone mapping (T)')
      .onChange((v: boolean) => this.hooks.setSetting('toneMapping', v));
    folder
      .addColor(this.proxy, 'background')
      .name('Background')
      .onChange((v: string) => this.hooks.setBackground(v));
    folder
      .add(this.proxy, 'maxPixelRatio', 1, 3, 0.5)
      .name('Max pixel ratio')
      .onChange((v: number) => this.hooks.setMaxPixelRatio(v));
  }

  private buildBakedLighting(): void {
    const folder = this.gui.addFolder('Baked lighting');
    folder
      .add(this.proxy, 'lightMapIntensity', 0, 6, 0.01)
      .name('Lightmap intensity')
      .onChange((v: number) => this.hooks.setSetting('lightMapIntensity', v));
    folder
      .add(this.proxy, 'aoMapIntensity', 0, 2, 0.01)
      .name('AO intensity')
      .onChange((v: number) => this.hooks.setSetting('aoMapIntensity', v));
    folder
      .add(this.proxy, 'envIntensity', 0, 2, 0.01)
      .name('Environment')
      .onChange((v: number) => this.hooks.setSetting('envIntensity', v));
    folder
      .add(this.proxy, 'punctualLights')
      .name('GLB lights')
      .onChange((v: boolean) => this.hooks.setSetting('punctualLights', v));
  }

  private buildNavigation(): void {
    const folder = this.gui.addFolder('Navigation');
    folder
      // The module's own range, so a scroll to a crouch can't show a value the
      // slider is unable to represent.
      .add(this.proxy, 'eyeHeight', EYE_HEIGHT_RANGE.min, EYE_HEIGHT_RANGE.max, 0.01)
      .name('Eye height (m)')
      .onChange((v: number) => this.hooks.setEyeHeight(v));
    folder
      .add(this.proxy, 'walkSpeed', 0.3, 8, 0.1)
      .name('Walk speed (m/s)')
      .onChange((v: number) => this.hooks.setSetting('walkSpeed', v));
    folder
      .add(this.proxy, 'highlights')
      .name('Hover highlight')
      .onChange((v: boolean) => this.hooks.setSetting('highlights', v));
    folder.close();
  }

  private buildScene(): void {
    const folder = this.gui.addFolder('Scene');
    const info = {
      geometry: '—',
      textures: '—',
      compression: '—',
      baked: '—',
      lights: '—',
    };
    for (const key of Object.keys(info) as (keyof typeof info)[]) {
      folder.add(info, key).name(key).disable().listen();
    }
    this.infoControllers = [
      { name: 'geometry', get: () => this.geometryLine() },
      { name: 'textures', get: () => this.textureLine() },
      { name: 'compression', get: () => this.compressionLine() },
      { name: 'baked', get: () => (this.hooks.hasBakedTextures() ? 'yes' : 'no') },
      { name: 'lights', get: () => (this.hooks.hasPunctualLights() ? 'in file' : 'none') },
    ];
    // lil-gui `.listen()` polls the object, so refresh it on a slow timer.
    this.infoTimer = setInterval(() => {
      for (const item of this.infoControllers) {
        (info as Record<string, string>)[item.name] = item.get();
      }
    }, 500);

    folder.add({ frame: () => this.hooks.frameScene() }, 'frame').name('Frame scene (F)');
    folder.add({ reset: () => this.hooks.resetColors() }, 'reset').name('Reset all colours');
    folder.add({ log: () => this.hooks.logMaterialReport() }, 'log').name('Log material report');
    folder.close();
  }

  private geometryLine(): string {
    const s = this.hooks.stats();
    return s ? `${s.meshes} meshes · ${s.triangles.toLocaleString()} tris` : '—';
  }

  private textureLine(): string {
    const s = this.hooks.stats();
    return s ? `${s.textures} · ~${(s.textureBytes / MB).toFixed(0)} MB` : '—';
  }

  private compressionLine(): string {
    const s = this.hooks.stats();
    if (!s) return '—';
    const used = [s.draco && 'draco', s.meshopt && 'meshopt', s.ktx2 && 'ktx2'].filter(Boolean);
    return used.length ? used.join(' + ') : 'none';
  }

  /** Keeps the panel honest when settings change from elsewhere (keys, load). */
  syncSettings(settings: SceneSettings): void {
    Object.assign(this.proxy, {
      exposure: settings.exposure,
      toneMapping: settings.toneMapping,
      lightMapIntensity: settings.lightMapIntensity,
      aoMapIntensity: settings.aoMapIntensity,
      envIntensity: settings.envIntensity,
      punctualLights: settings.punctualLights,
      eyeHeight: settings.eyeHeight,
      walkSpeed: settings.walkSpeed,
      highlights: settings.highlights,
    });
    // Scrolling or holding Q/E in walk mode lands here every frame. Repainting
    // a hidden panel is wasted work — it catches up when it's shown.
    if (this.visible) this.refreshDisplays();
  }

  private refreshDisplays(): void {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  beginFrame(): void {
    if (this.visible) this.stats.begin();
  }

  endFrame(): void {
    if (this.visible) this.stats.end();
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.refreshDisplays();
    this.gui.domElement.style.display = visible ? '' : 'none';
    this.stats.dom.style.display = visible ? '' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    if (this.infoTimer) clearInterval(this.infoTimer);
    this.infoTimer = null;
    this.gui.destroy();
    this.stats.dom.remove();
  }
}
