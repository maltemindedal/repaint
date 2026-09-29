import type { AppData } from '../types.ts';
import { isHexColor } from '../util/color.ts';

// Historical key from before the app was renamed to Repaint. Keep it so
// existing saved schemes and libraries survive the rename.
export const STORAGE_KEY = 'apartment-walkthrough:v1';

/**
 * localStorage, with an in-memory copy for whatever it would not take. That keeps
 * the same code path working under `vitest` (node, no DOM) and where the browser
 * refuses writes (a full quota, or an old Safari private window whose API exists
 * but throws on `setItem`): the session still sees its own changes, they just
 * don't outlive the tab.
 */
const memory = new Map<string, string>();

/** True while saves are failing, so the console hears about it once per episode. */
let failing = false;

/** `localStorage`, or null where it doesn't exist or the browser denies access to it. */
function local(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // With site data blocked, merely reading the property throws a SecurityError.
    return null;
  }
}

export function emptyData(): AppData {
  return { version: 1, library: [], scenes: {} };
}

export function loadData(): AppData {
  try {
    // A copy in memory is newer than storage: it holds a save storage refused.
    const raw = memory.get(STORAGE_KEY) ?? local()?.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('[storage] could not read saved data, starting fresh.', err);
    return emptyData();
  }
}

/**
 * Persists the data. Returns whether it reached `localStorage`; false means it
 * lives in this session only (storage full, blocked, or absent).
 */
export function saveData(data: AppData): boolean {
  try {
    const json = JSON.stringify(data);
    const store = local();
    if (store) {
      try {
        store.setItem(STORAGE_KEY, json);
        memory.delete(STORAGE_KEY);
        failing = false;
        return true;
      } catch (err) {
        if (!failing) console.warn('[storage] save failed (quota?)', err);
        failing = true;
      }
    }
    memory.set(STORAGE_KEY, json);
  } catch (err) {
    console.warn('[storage] could not serialise saved data', err);
  }
  return false;
}

// ------------------------------------------------------------- validation
//
// Saved data comes from localStorage or a user-supplied JSON import, so every
// field is validated on the way in rather than blind-cast. Anything that
// doesn't hold its shape is dropped, never propagated.

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A material name -> colour map. Colours are kept as written, but only if they are `#rgb` or `#rrggbb`. */
function colorRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && isHexColor(v)) out[k] = v;
  }
  return out;
}

function schemeList(value: unknown): AppData['scenes'][string]['schemes'] {
  if (!Array.isArray(value)) return [];
  const out: AppData['scenes'][string]['schemes'] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const id = s['id'];
    const name = s['name'];
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    out.push({ id, name, colors: colorRecord(s['colors']) });
  }
  return out;
}

function vec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (value as [number, number, number])
    : null;
}

function poseMap(value: unknown): AppData['scenes'][string]['poses'] {
  if (!value || typeof value !== 'object') return {};
  const out: AppData['scenes'][string]['poses'] = {};
  for (const mode of ['orbit', 'walk'] as const) {
    const raw = (value as Record<string, unknown>)[mode];
    if (!raw || typeof raw !== 'object') continue;
    const position = vec3((raw as Record<string, unknown>)['position']);
    const target = vec3((raw as Record<string, unknown>)['target']);
    if (position && target) out[mode] = { position, target };
  }
  return out;
}

/** Keeps only known settings keys whose values have the expected type. */
function settingsPatch(value: unknown): AppData['scenes'][string]['settings'] {
  if (!value || typeof value !== 'object') return {};
  const numeric = [
    'exposure',
    'lightMapIntensity',
    'aoMapIntensity',
    'envIntensity',
    'eyeHeight',
    'walkSpeed',
  ] as const;
  const boolean = ['toneMapping', 'punctualLights', 'highlights'] as const;

  const raw = value as Record<string, unknown>;
  const out: Record<string, number | boolean> = {};
  for (const key of numeric) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  for (const key of boolean) {
    const v = raw[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out as AppData['scenes'][string]['settings'];
}

/** Accepts anything shaped roughly like AppData and fills in the gaps. */
export function migrate(input: unknown): AppData {
  const data = emptyData();
  if (!input || typeof input !== 'object') return data;
  const raw = input as Partial<AppData>;

  if (Array.isArray(raw.library)) {
    // The id is the only handle the UI has on an entry (remove, rename), so two
    // entries sharing one would be removed and renamed together. An earlier merge
    // import could write such data; the first holder keeps its id.
    const taken = new Set<string>();
    data.library = raw.library
      .filter((c) => c && typeof c.hex === 'string' && isHexColor(c.hex))
      .map((c, i) => {
        const wanted = typeof c.id === 'string' ? c.id : `lib-${i}-${c.hex}`;
        let id = wanted;
        for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
        taken.add(id);
        return { id, name: typeof c.name === 'string' && c.name ? c.name : c.hex, hex: c.hex };
      });
  }

  if (raw.scenes && typeof raw.scenes === 'object') {
    for (const [key, value] of Object.entries(raw.scenes)) {
      if (!value || typeof value !== 'object') continue;
      const p = value as unknown as Record<string, unknown>;
      const activeSchemeId = p['activeSchemeId'];
      data.scenes[key] = {
        tagged: stringList(p['tagged']),
        untagged: stringList(p['untagged']),
        schemes: schemeList(p['schemes']),
        activeSchemeId: typeof activeSchemeId === 'string' ? activeSchemeId : null,
        poses: poseMap(p['poses']),
        settings: settingsPatch(p['settings']),
        current: colorRecord(p['current']),
      };
    }
  }
  return data;
}

export function serialize(data: AppData): string {
  return JSON.stringify(data, null, 2);
}
