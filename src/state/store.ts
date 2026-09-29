import type {
  AppData,
  CameraPose,
  LibraryColor,
  NavMode,
  Scheme,
  ScenePrefs,
  SceneSettings,
} from '../types.ts';
import { loadData, saveData, migrate, serialize } from './storage.ts';
import { normalizeHex } from '../util/color.ts';

export const DEFAULT_SETTINGS: SceneSettings = {
  exposure: 1.0,
  toneMapping: true,
  // π, not 1. three divides irradiance by π via BRDF_Lambert. See
  // LIGHTMAP_INTENSITY in core/processScene.ts.
  lightMapIntensity: Math.PI,
  // 0 by default: the same baked texture drives lightMap, so also feeding it
  // into aoMap would multiply the occlusion in twice. Scenes whose occlusion is
  // ORM-packed (AO-only, no lightmap) get a per-scene default of 1 instead.
  // see SceneSession.applyHeuristicDefaults. See README.
  aoMapIntensity: 0.0,
  envIntensity: 0.25,
  punctualLights: false,
  eyeHeight: 1.65,
  walkSpeed: 2.4,
  highlights: true,
};

const SCHEME_NAMES = ['Scheme 1', 'Scheme 2', 'Scheme 3'];

/** The single source for default keyboard-addressable slots (1/2/3). */
function makeDefaultScheme(index: number): Scheme {
  return {
    id: `slot-${index + 1}`,
    name: SCHEME_NAMES[index] ?? `Scheme ${index + 1}`,
    colors: {},
  };
}

export function emptyScenePrefs(): ScenePrefs {
  return {
    tagged: [],
    untagged: [],
    schemes: [0, 1, 2].map(makeDefaultScheme),
    activeSchemeId: null,
    poses: {},
    settings: {},
    current: {},
  };
}

/**
 * Single owner of everything persisted. Scene-scoped state is keyed by the
 * dropped file's name; the colour library is global so it follows you between
 * apartments. Writes are debounced because dragging a colour picker fires a lot.
 */
export class AppStore {
  private data: AppData;
  private sceneKey = '__fallback__';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Changed since the last save that reached storage. */
  private dirty = false;
  private saveFailing = false;

  /**
   * Called when saving starts failing (storage full or blocked), so the app can
   * say so. Not called again until a save has worked in between.
   */
  onSaveFailed: (() => void) | null = null;

  constructor(data: AppData = loadData()) {
    this.data = data;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Debounced persist. Most writes use the short delay; camera poses pass a
   * longer one because they change on every camera move. A pending short-delay
   * save is never postponed by a lazy one.
   */
  private queueSave(delay = 250): void {
    this.dirty = true;
    if (this.saveTimer) {
      if (delay > 250) return; // don't let a lazy save delay an eager one
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, delay);
  }

  /**
   * Writes any unsaved change now (page hide, import). A tab that changed
   * nothing writes nothing: its in-memory data is a snapshot from when it
   * opened, and saving that would overwrite what another tab has stored since.
   */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.dirty) this.persist();
  }

  private persist(): void {
    const saved = saveData(this.data);
    // A save that didn't reach storage stays pending for the next flush.
    this.dirty = !saved;
    if (!saved && !this.saveFailing) this.onSaveFailed?.();
    this.saveFailing = !saved;
  }

  // ----------------------------------------------------------------- scene

  useScene(key: string): void {
    this.sceneKey = key;
    if (!this.data.scenes[key]) {
      this.data.scenes[key] = emptyScenePrefs();
      this.queueSave();
    } else {
      // Older saves may predate the 3-slot default.
      const prefs = this.data.scenes[key];
      while (prefs.schemes.length < 3) {
        prefs.schemes.push(makeDefaultScheme(prefs.schemes.length));
      }
    }
  }

  get scene(): ScenePrefs {
    let prefs = this.data.scenes[this.sceneKey];
    if (!prefs) {
      prefs = emptyScenePrefs();
      this.data.scenes[this.sceneKey] = prefs;
    }
    return prefs;
  }

  // -------------------------------------------------------------- tagging

  setTagged(materialName: string, tagged: boolean, autoDiscovered: boolean): void {
    const prefs = this.scene;
    dropFrom(prefs.tagged, materialName);
    dropFrom(prefs.untagged, materialName);

    // Only record the deviation from what discovery would do on its own, so a
    // re-export that adds the PAINT_ prefix doesn't leave stale overrides.
    if (tagged && !autoDiscovered) prefs.tagged.push(materialName);
    if (!tagged && autoDiscovered) prefs.untagged.push(materialName);
    this.queueSave();
  }

  // --------------------------------------------------------- live colours

  get currentColors(): Record<string, string> {
    return this.scene.current;
  }

  setCurrentColor(key: string, hex: string): void {
    this.scene.current[key] = hex;
    this.queueSave();
  }

  clearCurrentColor(key: string): void {
    delete this.scene.current[key];
    this.queueSave();
  }

  // -------------------------------------------------------------- schemes

  get schemes(): Scheme[] {
    return this.scene.schemes;
  }

  get activeSchemeId(): string | null {
    return this.scene.activeSchemeId;
  }

  setActiveScheme(id: string | null): void {
    this.scene.activeSchemeId = id;
    this.queueSave();
  }

  saveScheme(id: string, colors: Record<string, string>): void {
    const scheme = this.schemes.find((s) => s.id === id);
    if (!scheme) return;
    scheme.colors = { ...colors };
    this.queueSave();
  }

  renameScheme(id: string, name: string): void {
    const scheme = this.schemes.find((s) => s.id === id);
    if (!scheme) return;
    scheme.name = name.trim() || scheme.name;
    this.queueSave();
  }

  // -------------------------------------------------------------- library

  get library(): LibraryColor[] {
    return this.data.library;
  }

  addLibraryColor(name: string, hex: string): LibraryColor | null {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const entry: LibraryColor = {
      id: newLibraryId(),
      name: name.trim() || normalized.toUpperCase(),
      hex: normalized,
    };
    this.data.library.unshift(entry);
    this.queueSave();
    return entry;
  }

  removeLibraryColor(id: string): void {
    this.data.library = this.data.library.filter((c) => c.id !== id);
    this.queueSave();
  }

  renameLibraryColor(id: string, name: string): void {
    const entry = this.data.library.find((c) => c.id === id);
    if (!entry) return;
    entry.name = name.trim() || entry.name;
    this.queueSave();
  }

  // ------------------------------------------------------- poses/settings

  getPose(mode: NavMode): CameraPose | null {
    return this.scene.poses[mode] ?? null;
  }

  setPose(mode: NavMode, pose: CameraPose): void {
    this.scene.poses[mode] = pose;
    this.queueSave(800);
  }

  get settings(): SceneSettings {
    return { ...DEFAULT_SETTINGS, ...this.scene.settings };
  }

  setSetting<K extends keyof SceneSettings>(key: K, value: SceneSettings[K]): void {
    this.scene.settings[key] = value;
    this.queueSave();
  }

  /**
   * Records a guess: writes only when this scene has no choice of its own.
   *
   * `settings` merges the global defaults in, so it can't answer "has the user
   * decided this?" Only the raw per-scene block can, and that stays in here.
   */
  setDefaultSetting<K extends keyof SceneSettings>(key: K, value: SceneSettings[K]): void {
    if (this.scene.settings[key] !== undefined) return;
    this.setSetting(key, value);
  }

  // ------------------------------------------------------- import/export

  exportJSON(): string {
    return serialize(this.data);
  }

  importJSON(json: string, mode: 'merge' | 'replace' = 'merge'): void {
    const incoming = migrate(JSON.parse(json));
    if (mode === 'replace') {
      this.data = incoming;
    } else {
      const byHex = new Map(this.data.library.map((c) => [`${c.name}|${c.hex}`, c]));
      const ids = new Set(this.data.library.map((c) => c.id));
      for (const c of incoming.library) {
        if (byHex.has(`${c.name}|${c.hex}`)) continue;
        // A colour renamed since the export arrives as new but with its old id.
        let id = c.id;
        while (ids.has(id)) id = newLibraryId();
        ids.add(id);
        this.data.library.push(id === c.id ? c : { ...c, id });
      }
      Object.assign(this.data.scenes, incoming.scenes);
    }
    this.useScene(this.sceneKey);
    this.dirty = true;
    this.flush();
  }
}

function newLibraryId(): string {
  return `lib-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

function dropFrom(list: string[], name: string): void {
  const i = list.indexOf(name);
  if (i >= 0) list.splice(i, 1);
}
