import './style.css';
import { Viewer } from './core/Viewer.ts';
import { SceneLoader } from './core/SceneLoader.ts';
import { PaintRegistry } from './core/PaintRegistry.ts';
import { PaintController } from './core/PaintController.ts';
import { Picker } from './core/Picker.ts';
import { defaultPose } from './core/processScene.ts';
import { NavigationController } from './nav/NavigationController.ts';
import { AppStore } from './state/store.ts';
import { Sidebar } from './ui/Sidebar.ts';
import { sidebarViewModel } from './sidebarViewModel.ts';
import { Toolbar } from './ui/Toolbar.ts';
import { DropZone } from './ui/DropZone.ts';
import { DebugPanel } from './ui/DebugPanel.ts';
import { HelpOverlay } from './ui/HelpOverlay.ts';
import { StatusPanel } from './ui/StatusPanel.ts';
import { bootWhenSupported } from './ui/MobileGate.ts';
import {
  downloadBlob,
  downloadText,
  isTypingTarget,
  requireElement,
  pickFile,
} from './util/dom.ts';
import type { LoadedScene, NavMode, SceneSettings } from './types.ts';

class App {
  private viewer: Viewer;
  private loader: SceneLoader;
  private registry = new PaintRegistry();
  private picker: Picker;
  private nav: NavigationController;
  private store = new AppStore();
  private paint = new PaintController(this.registry, this.store);

  private sidebar: Sidebar;
  private toolbar: Toolbar;
  private debug: DebugPanel;
  private help: HelpOverlay;

  private scene: LoadedScene | null = null;
  private selectedKey: string | null = null;
  private hoveredKey: string | null = null;
  private perfChecked = false;
  private loadedAt = 0;

  private panel = new StatusPanel();

  constructor() {
    const canvas = requireElement<HTMLCanvasElement>('canvas');
    this.viewer = new Viewer(canvas);
    this.viewer.initEnvironment();
    this.loader = new SceneLoader(this.viewer);
    this.picker = new Picker(this.viewer, this.registry);
    this.nav = new NavigationController(this.viewer);

    this.sidebar = new Sidebar(requireElement('sidebar'), {
      onSelect: (key) => this.select(key),
      onColorChange: (key, hex) => this.paint.apply(key, hex),
      onResetTarget: (key) => this.resetTarget(key),
      onResetAll: () => this.resetAll(),
      onTagChange: (name, tagged) => this.setTag(name, tagged),
      onOpenFile: () => void this.openFilePicker(),
      onSaveToLibrary: (hex) => this.saveToLibrary(hex),
      onRemoveLibraryColor: (id) => {
        this.store.removeLibraryColor(id);
        this.render();
      },
      onRenameLibraryColor: (id, name) => this.store.renameLibraryColor(id, name),
      onApplyLibraryColor: (id) => this.applyLibraryColor(id),
      onApplyScheme: (id) => this.applyScheme(id),
      onCaptureScheme: (id) => this.captureScheme(id),
      onRenameScheme: (id, name) => {
        this.store.renameScheme(id, name);
        this.render();
      },
      onExportData: () => this.exportData(),
      onImportData: () => void this.importData(),
      onScreenshot: () => void this.screenshot(),
    });

    this.toolbar = new Toolbar(requireElement('toolbar'), {
      onModeChange: (mode) => this.setMode(mode),
      onApplyScheme: (id) => this.applyScheme(id),
      onFrame: () => this.nav.frameScene(),
      onScreenshot: () => void this.screenshot(),
      onToggleHelp: () => this.help.toggle(),
      onToggleToneMapping: () => this.toggleToneMapping(),
    });

    this.help = new HelpOverlay(requireElement('help'));
    this.debug = new DebugPanel(this.debugHooks());
    this.debug.mount(requireElement('viewport'));

    new DropZone(requireElement('dropzone'), (file) => void this.handleFile(file));

    // PaintController owns the writes and only emits when something actually
    // moved; both views work out what that means for the DOM themselves, so
    // there is nothing here to unpack.
    this.paint.onPaintChanged = () => this.render();

    this.picker.onHover = (target) => {
      this.hoveredKey = target?.key ?? null;
      this.render();
    };
    this.picker.onSelect = (target) => this.select(target?.key ?? null);
    this.picker.onDoubleClick = (point) => this.nav.focusPoint(point);

    this.nav.onModeChange = (mode) => this.toolbar.setMode(mode);
    this.nav.onPoseChange = (mode, pose) => this.store.setPose(mode, pose);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pagehide', () => this.store.flush());

    this.viewer.onFrame((dt) => {
      this.debug.beginFrame();
      this.nav.update(dt);
      this.picker.update(dt);
      this.checkPerformance();
      this.debug.endFrame();
    });

    this.setScene(this.loader.loadFallback());
    this.viewer.start();
    this.panel.status('Drop a .glb anywhere to load your apartment. Press ? for shortcuts.', 6000);

    // Console handle for poking at a scene that doesn't behave — see README.
    // Dev-only so the production bundle keeps nothing alive that the UI doesn't.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).apt = this;
    }
  }

  // ------------------------------------------------------------- loading

  private async handleFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();

    if (name.endsWith('.json')) {
      try {
        this.store.importJSON(await file.text(), 'merge');
        this.refreshAll();
        this.panel.status(`Imported settings from ${file.name}`);
      } catch (err) {
        console.error(err);
        this.panel.status(`Could not read ${file.name} as settings JSON`, 5000);
      }
      return;
    }

    if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
      this.panel.status('Only .glb / .gltf (or a settings .json) can be dropped here.', 4000);
      return;
    }

    this.panel.showLoading(0, 'Reading file…');
    try {
      const scene = await this.loader.loadFile(file, (fraction, label) =>
        this.panel.showLoading(fraction, label),
      );
      this.setScene(scene);
      this.panel.status(
        `${file.name} — ${this.registry.size} paintable ${this.registry.size === 1 ? 'material' : 'materials'}`,
        5000,
      );
    } catch (err) {
      console.error('[load] failed', err);
      if (location.protocol === 'file:') {
        console.warn(
          '[load] Running from file:// — browsers block the DRACO/KTX2 decoder fetches there. ' +
            'If this file is compressed, use the served build (npm run serve:dist).',
        );
      }
      this.panel.status(`Could not load ${file.name}. See the console for details.`, 6000);
    } finally {
      this.panel.hideLoading();
    }
  }

  private async openFilePicker(): Promise<void> {
    const file = await pickFile('.glb,.gltf,model/gltf-binary,model/gltf+json');
    if (file) await this.handleFile(file);
  }

  private setScene(scene: LoadedScene): void {
    this.scene = scene;
    this.perfChecked = false;
    this.loadedAt = performance.now();

    this.store.useScene(scene.key);

    // Baked scenes shouldn't be double-lit, but a scene *without* a bake
    // clearly wants its exported lights on. Only guess when the user hasn't
    // already made a call for this file.
    if (this.store.scene.settings.punctualLights === undefined && scene.lights.length > 0) {
      this.store.setSetting('punctualLights', !scene.hasBakedTextures);
    }

    // ORM-packed occlusion can't drive a lightmap, so for those materials the
    // AO slider is the whole effect. The global default of 0 (right for
    // lightmapped scenes, where the bake already contains its occlusion) would
    // silently disable it — give this file a default of 1 unless the user has
    // already chosen a value.
    if (
      this.store.scene.settings.aoMapIntensity === undefined &&
      scene.aoOnlyMaterials.length > 0
    ) {
      this.store.setSetting('aoMapIntensity', 1);
    }

    this.rediscover();
    this.picker.setScene(scene.root);

    this.nav.setBounds(scene.bounds);
    if (scene.startCamFov) {
      this.viewer.camera.fov = scene.startCamFov;
      this.viewer.camera.updateProjectionMatrix();
    }

    const savedPose = this.store.getPose(this.nav.mode);
    this.nav.applyPose(savedPose ?? scene.startCam ?? defaultPose(scene.bounds));

    this.applySettings();
    this.render();

    if (!scene.isFallback && this.registry.size === 0) {
      this.panel.status('No PAINT_ materials found — tag them under “All materials”.', 8000);
    }
  }

  /** Re-runs discovery (after load, or after a manual tag change). */
  private rediscover(): void {
    if (!this.scene) return;
    const prefs = this.store.scene;
    this.registry.discover(this.scene.root, { tagged: prefs.tagged, untagged: prefs.untagged });

    // Restore whatever colours were on screen last time. Straight to the
    // registry, not through PaintController: this reads *from* the store, so
    // writing back would only re-save it and drop the active scheme.
    for (const [key, hex] of Object.entries(this.store.currentColors)) {
      this.registry.setColor(key, hex);
    }

    this.picker.refreshTargets();
    if (this.selectedKey && !this.registry.get(this.selectedKey)) this.selectedKey = null;
  }

  // -------------------------------------------------------------- colour

  private resetTarget(key: string): void {
    const target = this.paint.reset(key);
    if (!target) return;
    this.panel.status(
      `${target.displayName} → exported colour ${target.originalHex.toUpperCase()}`,
    );
  }

  private resetAll(): void {
    this.paint.resetAll();
    this.panel.status('All walls back to their exported colours');
  }

  private select(key: string | null): void {
    this.selectedKey = key;
    this.render();
    const target = key ? this.registry.get(key) : null;
    if (target) this.picker.selectPulse(target);
  }

  private saveToLibrary(hex: string): void {
    const target = this.selectedKey ? this.registry.get(this.selectedKey) : null;
    const suggested = target ? `${target.displayName} ${hex.toUpperCase()}` : hex.toUpperCase();
    const entry = this.store.addLibraryColor(suggested, hex);
    if (!entry) return;
    this.render();
    this.sidebar.focusLibraryEntry(entry.id);
    this.panel.status('Saved to library — type a name in the sidebar');
  }

  private applyLibraryColor(id: string): void {
    const entry = this.store.library.find((c) => c.id === id);
    if (!entry) return;
    if (!this.selectedKey) {
      this.panel.status('Select a wall first, then click a library colour.', 3500);
      return;
    }
    if (!this.paint.apply(this.selectedKey, entry.hex)) return;
    this.panel.status(`${entry.name} applied`);
  }

  // ------------------------------------------------------------- schemes

  private applyScheme(id: string): void {
    const result = this.paint.applyScheme(id);
    if (result.outcome === 'missing') return;
    if (result.outcome === 'empty') {
      this.panel.status(`“${result.scheme.name}” is empty — use “Save current” to fill it.`, 4000);
      return;
    }
    this.panel.status(
      `${result.scheme.name} — ${result.applied}/${result.requested} colours applied`,
    );
  }

  private captureScheme(id: string): void {
    const scheme = this.paint.capture(id);
    if (!scheme) return;
    this.panel.status(`Saved current colours into “${scheme.name}”`);
  }

  // -------------------------------------------------------------- views

  /**
   * Push current state into both views. Every mutation ends with this one
   * call rather than a per-call-site list of which panels to refresh — both
   * views diff against what they already drew, so it stays cheap enough for
   * a picker drag and a 3D hover.
   *
   * The scheme slots are built once and handed to both, so the two panels
   * can't disagree about which scheme is live.
   */
  private render(): void {
    const vm = sidebarViewModel({
      scene: this.scene,
      registry: this.registry,
      store: this.store,
      selectedKey: this.selectedKey,
      hoveredKey: this.hoveredKey,
    });
    this.toolbar.renderSchemes(vm.schemes);
    this.sidebar.render(vm);
  }

  private refreshAll(): void {
    this.rediscover();
    this.applySettings();
    this.render();
  }

  // ------------------------------------------------------------- tagging

  private setTag(materialName: string, tagged: boolean): void {
    const info = this.registry.allMaterials().find((m) => m.name === materialName);
    this.store.setTagged(materialName, tagged, info?.auto ?? false);
    this.rediscover();
    this.render();
    this.panel.status(
      `${materialName} ${tagged ? 'is now paintable' : 'removed from the paint list'}`,
    );
  }

  // ------------------------------------------------------------ settings

  private applySettings(): void {
    const s = this.store.settings;
    this.viewer.setExposure(s.exposure);
    this.viewer.setToneMapping(s.toneMapping);
    this.viewer.setEnvIntensity(s.envIntensity);

    for (const mat of this.scene?.bakedMaterials ?? []) {
      mat.lightMapIntensity = s.lightMapIntensity;
      mat.aoMapIntensity = s.aoMapIntensity;
    }
    for (const mat of this.scene?.aoOnlyMaterials ?? []) {
      mat.aoMapIntensity = s.aoMapIntensity;
    }
    for (const light of this.scene?.lights ?? []) light.visible = s.punctualLights;

    this.nav.walk.setEyeHeight(s.eyeHeight);
    this.nav.walk.setSpeed(s.walkSpeed);
    this.picker.highlightsEnabled = s.highlights;
    if (!s.highlights) this.picker.clearHighlights();

    this.toolbar.setToneMapping(s.toneMapping);
    this.debug.syncSettings(s);
  }

  private setSetting<K extends keyof SceneSettings>(key: K, value: SceneSettings[K]): void {
    this.store.setSetting(key, value);
    this.applySettings();
  }

  private toggleToneMapping(): void {
    const next = !this.store.settings.toneMapping;
    this.setSetting('toneMapping', next);
    this.panel.status(
      next
        ? 'ACES filmic tone mapping ON — looks like your Cycles render'
        : 'Tone mapping OFF — on-screen colour now matches the hex literally',
      4000,
    );
  }

  private debugHooks() {
    return {
      settings: this.store.settings,
      setSetting: <K extends keyof SceneSettings>(key: K, value: SceneSettings[K]) =>
        this.setSetting(key, value),
      setBackground: (hex: string) => this.viewer.setBackground(hex),
      setMaxPixelRatio: (value: number) => this.viewer.setMaxPixelRatio(value),
      frameScene: () => this.nav.frameScene(),
      resetColors: () => this.resetAll(),
      logMaterialReport: () => this.logMaterialReport(),
      hasPunctualLights: () => (this.scene?.lights.length ?? 0) > 0,
      hasBakedTextures: () => this.scene?.hasBakedTextures ?? false,
      stats: () => this.scene?.stats ?? null,
    };
  }

  private logMaterialReport(): void {
    console.table(
      this.registry.allMaterials().map((m) => ({
        material: m.name,
        paintable: m.isPaintable,
        'PAINT_ prefix': m.auto,
        'base colour texture': m.hasColorMap,
        meshes: m.meshCount,
      })),
    );
  }

  // ------------------------------------------------------------ nav mode

  private setMode(mode: NavMode): void {
    if (mode === this.nav.mode) return;
    // Read the saved pose *before* switching: setMode emits the carried-over
    // camera pose for the new mode, which would overwrite the stored one.
    const saved = this.store.getPose(mode);
    this.nav.setMode(mode);
    if (saved) this.nav.applyPose(saved);
    this.toolbar.setMode(mode);
    this.panel.status(
      mode === 'walk'
        ? 'Walk mode — WASD to move, drag to look, L for pointer lock'
        : 'Orbit mode — drag to orbit, double-click to set the pivot',
    );
  }

  // ----------------------------------------------------------- shortcuts

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    switch (event.code) {
      case 'Tab':
        event.preventDefault();
        this.setMode(this.nav.mode === 'orbit' ? 'walk' : 'orbit');
        return;
      case 'Backquote':
        event.preventDefault();
        this.debug.toggle();
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3': {
        const index = Number(event.code.slice(-1)) - 1;
        const scheme = this.store.schemes[index];
        if (scheme) this.applyScheme(scheme.id);
        return;
      }
      case 'KeyR':
        if (this.selectedKey) this.resetTarget(this.selectedKey);
        else this.panel.status('Select a wall first (click it, or pick it in the sidebar).', 3000);
        return;
      case 'KeyT':
        this.toggleToneMapping();
        return;
      case 'KeyP':
        void this.screenshot();
        return;
      case 'KeyF':
        this.nav.frameScene();
        return;
      case 'KeyL':
        if (this.nav.mode === 'walk') this.nav.walk.requestPointerLock();
        return;
      case 'Escape':
        if (this.help.isVisible) this.help.hide();
        else if (this.nav.walk.isPointerLocked) this.nav.walk.exitPointerLock();
        else this.select(null);
        return;
      default:
        break;
    }

    if (event.key === '?') {
      event.preventDefault();
      this.help.toggle();
    }
  };

  // ---------------------------------------------------------- screenshot

  private async screenshot(): Promise<void> {
    const scheme = this.store.schemes.find((s) => s.id === this.store.activeSchemeId);
    const slug =
      (scheme?.name ?? 'custom')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'custom';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    this.panel.status('Rendering 2× screenshot…');
    const blob = await this.viewer.screenshot(2);
    if (!blob) {
      this.panel.status('Screenshot failed — the drawing buffer came back empty.', 4000);
      return;
    }
    const filename = `repaint_${slug}_${stamp}.png`;
    downloadBlob(blob, filename);
    this.panel.status(`Saved ${filename}`, 4000);
  }

  // -------------------------------------------------------- import/export

  private exportData(): void {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(this.store.exportJSON(), `repaint-${stamp}.json`);
    this.panel.status('Exported schemes, library and settings');
  }

  private async importData(): Promise<void> {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      this.store.importJSON(await file.text(), 'merge');
      this.refreshAll();
      this.panel.status(`Imported ${file.name}`);
    } catch (err) {
      console.error(err);
      this.panel.status('That file is not a valid Repaint export.', 5000);
    }
  }

  // -------------------------------------------------------- perf & status

  /**
   * One-shot check a few seconds after load. If the scene can't hold a
   * reasonable frame rate, point at the two things that actually fix it.
   */
  private checkPerformance(): void {
    if (this.perfChecked || !this.scene || this.scene.isFallback) return;
    if (performance.now() - this.loadedAt < 5000) return;
    this.perfChecked = true;

    const fps = this.viewer.fps;
    if (fps >= 45) return;

    const { stats } = this.scene;
    const lines = [
      `[perf] ~${fps.toFixed(0)} fps with ${stats.triangles.toLocaleString()} triangles and ~${(
        stats.textureBytes /
        (1024 * 1024)
      ).toFixed(0)} MB of textures.`,
    ];
    if (!stats.draco && !stats.meshopt) {
      lines.push(
        '  · Geometry is uncompressed. Re-export with Compression (Draco) enabled, or run the file through `gltf-transform meshopt`.',
      );
    }
    if (!stats.ktx2 && stats.textureBytes > 128 * 1024 * 1024) {
      lines.push(
        '  · Textures are uncompressed RGBA. `gltf-transform uastc`/`etc1s` (KTX2) typically cuts VRAM by 4–8×; this app already has the transcoder wired up.',
      );
    }
    if (stats.textureBytes > 256 * 1024 * 1024) {
      lines.push('  · Consider halving lightmap resolution — 2K per room is usually plenty.');
    }
    if (stats.meshes > 1500) {
      lines.push(`  · ${stats.meshes} draw calls. Join meshes that share a material in Blender.`);
    }
    console.warn(lines.join('\n'));
    this.panel.status(`~${fps.toFixed(0)} fps — see the console for compression hints.`, 6000);
  }
}

// Phones and tablets get the gate in index.html instead — no WebGL context is
// created there, so nothing spins up that the device can't drive.
bootWhenSupported(() => new App());
