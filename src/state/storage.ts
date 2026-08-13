import type { AppData } from '../types.ts';

// Historical key from before the app was renamed to Repaint — kept so
// existing saved schemes and libraries survive the rename.
export const STORAGE_KEY = 'apartment-walkthrough:v1';

/**
 * localStorage with an in-memory fallback so the same code path works under
 * `vitest` (node, no DOM) and in private-browsing modes where localStorage
 * throws on write.
 */
const memory = new Map<string, string>();

function backend(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe: Safari private mode has the API but throws on setItem.
      localStorage.setItem(`${STORAGE_KEY}:probe`, '1');
      localStorage.removeItem(`${STORAGE_KEY}:probe`);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
  };
}

export function emptyData(): AppData {
  return { version: 1, library: [], scenes: {} };
}

export function loadData(): AppData {
  try {
    const raw = backend().getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('[storage] could not read saved data, starting fresh.', err);
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  try {
    backend().setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[storage] save failed (quota?)', err);
  }
}

// ------------------------------------------------------------- validation
//
// Saved data comes from localStorage or a user-supplied JSON import, so every
// field is validated on the way in rather than blind-cast. Anything that
// doesn't hold its shape is dropped, never propagated.

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
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
    out.push({ id, name, colors: stringRecord(s['colors']) });
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
    data.library = raw.library
      .filter((c) => c && typeof c.hex === 'string')
      .map((c, i) => ({
        id: typeof c.id === 'string' ? c.id : `lib-${i}-${c.hex}`,
        name: typeof c.name === 'string' && c.name ? c.name : c.hex,
        hex: c.hex,
      }));
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
        current: stringRecord(p['current']),
      };
    }
  }
  return data;
}

export function serialize(data: AppData): string {
  return JSON.stringify(data, null, 2);
}
