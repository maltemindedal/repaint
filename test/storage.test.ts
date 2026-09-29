import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/types.ts';

/**
 * `storage.ts` keeps a module-level fallback, so each test loads a fresh copy.
 * The fake `localStorage` records every write and can be told to refuse them,
 * which is what a full quota (or an old Safari private window) looks like.
 */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    writes: [] as string[],
    refuseWrites: false,
    getItem(key: string): string | null {
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      this.writes.push(key);
      if (this.refuseWrites)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(key, value);
    },
    removeItem(key: string): void {
      items.delete(key);
    },
  };
}

async function load() {
  vi.resetModules();
  const storage = await import('../src/state/storage.ts');
  const { AppStore } = await import('../src/state/store.ts');
  return { ...storage, AppStore };
}

const saved = (hex: string): AppData => ({
  version: 1,
  library: [{ id: 'lib-1', name: 'Chalk', hex }],
  scenes: {},
});

describe('storage backend', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('reads saved data without writing anything', async () => {
    const ls = fakeStorage();
    const { STORAGE_KEY, loadData } = await load();
    ls.items.set(STORAGE_KEY, JSON.stringify(saved('#f2f0eb')));
    vi.stubGlobal('localStorage', ls);

    expect(loadData().library.map((c) => c.hex)).toEqual(['#f2f0eb']);
    expect(ls.writes).toEqual([]);
  });

  it('still reads saved data when the browser refuses further writes (full quota)', async () => {
    const ls = fakeStorage();
    const { STORAGE_KEY, loadData } = await load();
    ls.items.set(STORAGE_KEY, JSON.stringify(saved('#f2f0eb')));
    ls.refuseWrites = true;
    vi.stubGlobal('localStorage', ls);

    expect(loadData().library.map((c) => c.hex)).toEqual(['#f2f0eb']);
  });

  it('writes only under the storage key', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { STORAGE_KEY, saveData, emptyData } = await load();

    expect(saveData(emptyData())).toBe(true);

    expect(ls.writes).toEqual([STORAGE_KEY]);
    expect(JSON.parse(ls.items.get(STORAGE_KEY) ?? 'null')).toEqual(emptyData());
  });

  it('says so when a save could not be stored, and keeps the data for the session', async () => {
    const ls = fakeStorage();
    ls.refuseWrites = true;
    vi.stubGlobal('localStorage', ls);
    const { saveData, loadData } = await load();

    expect(saveData(saved('#aabbcc'))).toBe(false);

    expect(warn).toHaveBeenCalledWith('[storage] save failed (quota?)', expect.anything());
    expect(loadData().library.map((c) => c.hex)).toEqual(['#aabbcc']);
  });

  it('logs a failing save once, not on every retry', async () => {
    const ls = fakeStorage();
    ls.refuseWrites = true;
    vi.stubGlobal('localStorage', ls);
    const { saveData, emptyData } = await load();

    saveData(emptyData());
    saveData(emptyData());
    saveData(emptyData());

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('prefers storage again once a save gets through', async () => {
    const ls = fakeStorage();
    ls.refuseWrites = true;
    vi.stubGlobal('localStorage', ls);
    const { STORAGE_KEY, saveData, loadData } = await load();
    saveData(saved('#111111'));

    ls.refuseWrites = false;
    expect(saveData(saved('#222222'))).toBe(true);
    // Another tab writes; the stale session copy must not shadow it.
    ls.items.set(STORAGE_KEY, JSON.stringify(saved('#333333')));

    expect(loadData().library.map((c) => c.hex)).toEqual(['#333333']);
  });

  it('works without localStorage, as the session-only fallback', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { saveData, loadData } = await load();

    expect(saveData(saved('#abcdef'))).toBe(false);
    expect(loadData().library.map((c) => c.hex)).toEqual(['#abcdef']);
  });

  it('survives a browser that throws on merely touching localStorage', async () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const { saveData, loadData, emptyData } = await load();

    expect(saveData(emptyData())).toBe(false);
    expect(loadData()).toEqual(emptyData());
  });
});

describe('AppStore save failures', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('reports a failing save once, and again only after a save has worked in between', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());
    const onSaveFailed = vi.fn();
    store.onSaveFailed = onSaveFailed;

    store.addLibraryColor('Chalk', '#f2f0eb');
    ls.refuseWrites = true;
    store.flush();
    store.flush(); // the failed save is still pending, so this retries it
    expect(onSaveFailed).toHaveBeenCalledTimes(1);

    ls.refuseWrites = false;
    store.flush();
    expect(onSaveFailed).toHaveBeenCalledTimes(1);

    store.addLibraryColor('Sage', '#a3b18a');
    ls.refuseWrites = true;
    store.flush();
    expect(onSaveFailed).toHaveBeenCalledTimes(2);
  });

  it('does not report anything while saves work', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());
    const onSaveFailed = vi.fn();
    store.onSaveFailed = onSaveFailed;

    store.addLibraryColor('Chalk', '#f2f0eb');
    store.flush();

    expect(onSaveFailed).not.toHaveBeenCalled();
  });
});

describe('AppStore flush', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('writes nothing when there is nothing to save', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();

    new AppStore(emptyData()).flush();

    expect(ls.writes).toEqual([]);
  });

  it('writes a pending change straight away, and only once', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());

    store.addLibraryColor('Chalk', '#f2f0eb');
    store.flush();
    vi.advanceTimersByTime(5000);

    expect(ls.writes).toHaveLength(1);
  });

  it('does not write again on a second flush', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());

    store.addLibraryColor('Chalk', '#f2f0eb');
    store.flush();
    store.flush();

    expect(ls.writes).toHaveLength(1);
  });

  it('keeps a change pending when the write failed, and retries it on the next flush', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());

    store.addLibraryColor('Chalk', '#f2f0eb');
    ls.refuseWrites = true;
    store.flush();
    ls.refuseWrites = false;
    store.flush();

    expect(ls.writes).toHaveLength(2);
    expect(ls.items.size).toBe(1);
  });

  it('writes an import immediately', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, emptyData } = await load();
    const store = new AppStore(emptyData());
    // The scene entry exists and is saved, so the import queues nothing on its own
    // (useScene only queues a save for a scene it has to create) and the write can
    // only come from the import marking the store as changed.
    store.useScene('__fallback__');
    store.flush();
    ls.writes.length = 0;
    const other = new AppStore(emptyData());
    other.addLibraryColor('Chalk', '#f2f0eb');

    store.importJSON(other.exportJSON(), 'merge');

    expect(ls.writes).toHaveLength(1);
    expect(store.library.map((c) => c.name)).toEqual(['Chalk']);
  });

  it('lets an idle tab close without wiping what another tab saved', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    const { AppStore, loadData, STORAGE_KEY } = await load();
    const tabA = new AppStore(loadData());
    const tabB = new AppStore(loadData()); // opened earlier, never touched

    tabA.addLibraryColor('saved in A', '#123456');
    tabA.flush();
    tabB.flush(); // tab B's pagehide

    const stored = JSON.parse(ls.items.get(STORAGE_KEY) ?? '{}') as { library: { name: string }[] };
    expect(stored.library.map((c) => c.name)).toEqual(['saved in A']);
  });
});

/** Two tabs on one localStorage, both opened before either has saved anything. */
async function twoTabs() {
  const ls = fakeStorage();
  vi.stubGlobal('localStorage', ls);
  const mod = await load();
  const tabA = new mod.AppStore(mod.loadData());
  const tabB = new mod.AppStore(mod.loadData());
  const stored = () => JSON.parse(ls.items.get(mod.STORAGE_KEY) ?? '{}') as AppData;
  return { ...mod, ls, tabA, tabB, stored };
}

describe('AppStore with several tabs', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('keeps the scenes of two tabs that each edited a different file', async () => {
    const { tabA, tabB, stored } = await twoTabs();

    tabA.useScene('a.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    tabA.flush();
    tabB.useScene('b.glb');
    tabB.setCurrentColor('PAINT_B', '#222222');
    tabB.flush();

    expect(Object.keys(stored().scenes).toSorted()).toEqual(['a.glb', 'b.glb']);
    expect(stored().scenes['a.glb']?.current).toEqual({ PAINT_A: '#111111' });
    expect(stored().scenes['b.glb']?.current).toEqual({ PAINT_B: '#222222' });
  });

  it('keeps the library another tab saved when this tab only changed a scene', async () => {
    const { tabA, tabB, stored } = await twoTabs();

    tabA.addLibraryColor('saved in A', '#123456');
    tabA.flush();
    tabB.useScene('b.glb');
    tabB.setCurrentColor('PAINT_B', '#222222');
    tabB.flush();

    expect(stored().library.map((c) => c.name)).toEqual(['saved in A']);
    expect(stored().scenes['b.glb']?.current).toEqual({ PAINT_B: '#222222' });
  });

  it('keeps the scenes another tab saved when this tab only changed the library', async () => {
    const { tabA, tabB, stored } = await twoTabs();

    tabA.useScene('a.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    tabA.flush();
    tabB.addLibraryColor('from B', '#654321');
    tabB.flush();

    expect(stored().scenes['a.glb']?.current).toEqual({ PAINT_A: '#111111' });
    expect(stored().library.map((c) => c.name)).toEqual(['from B']);
  });

  it('lets the later save win when both tabs changed the library', async () => {
    const { tabA, tabB, stored } = await twoTabs();

    tabA.addLibraryColor('from A', '#111111');
    tabA.flush();
    tabB.addLibraryColor('from B', '#222222');
    tabB.flush();

    expect(stored().library.map((c) => c.name)).toEqual(['from B']);
  });

  it('lets the later save win for the same file', async () => {
    const { tabA, tabB, stored } = await twoTabs();

    tabA.useScene('x.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    tabA.flush();
    tabB.useScene('x.glb');
    tabB.setCurrentColor('PAINT_A', '#222222');
    tabB.flush();

    expect(stored().scenes['x.glb']?.current).toEqual({ PAINT_A: '#222222' });
  });

  it('does not rewrite a scene it has already saved when it flushes again', async () => {
    const { ls, tabA, tabB, stored } = await twoTabs();
    tabA.useScene('x.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    tabA.flush();
    tabB.useScene('x.glb');
    tabB.setCurrentColor('PAINT_A', '#222222');
    tabB.flush();
    ls.writes.length = 0;

    tabA.flush(); // tab A's pagehide: it has nothing new to save

    expect(ls.writes).toEqual([]);
    expect(stored().scenes['x.glb']?.current).toEqual({ PAINT_A: '#222222' });
  });

  it('writes nothing just because a file was opened', async () => {
    const { ls, tabA } = await twoTabs();

    tabA.useScene('x.glb');
    tabA.flush();
    vi.advanceTimersByTime(5000);

    expect(ls.writes).toEqual([]);
  });

  it('writes a scene once something in it has changed, not before', async () => {
    const { ls, tabA, stored } = await twoTabs();

    tabA.useScene('x.glb');
    tabA.setSetting('exposure', 1.4);
    tabA.flush();

    expect(ls.writes).toHaveLength(1);
    expect(stored().scenes['x.glb']?.settings).toEqual({ exposure: 1.4 });
  });

  it('lets a replacing import overwrite everything, as it always did', async () => {
    const { tabA, tabB, stored } = await twoTabs();
    tabA.addLibraryColor('saved in A', '#123456');
    tabA.flush();
    const file = JSON.stringify({
      version: 1,
      library: [{ id: 'lib-x', name: 'Imported', hex: '#abcdef' }],
      scenes: {},
    });

    tabB.importJSON(file, 'replace');

    expect(stored().library.map((c) => c.name)).toEqual(['Imported']);
  });

  it('merges an import into what other tabs saved: imported scenes and library are written', async () => {
    const { tabA, tabB, stored } = await twoTabs();
    tabA.useScene('a.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    tabA.flush();
    const file = JSON.stringify({
      version: 1,
      library: [{ id: 'lib-i', name: 'Imported', hex: '#abcdef' }],
      scenes: { 'i.glb': { current: { PAINT_I: '#333333' } } },
    });

    tabB.importJSON(file, 'merge');

    expect(Object.keys(stored().scenes).toSorted()).toContain('a.glb');
    expect(stored().scenes['i.glb']?.current).toEqual({ PAINT_I: '#333333' });
    expect(stored().library.map((c) => c.name)).toEqual(['Imported']);
  });

  it('keeps a failed save pending and merges it once storage accepts writes again', async () => {
    const { ls, tabA, tabB, stored } = await twoTabs();
    tabA.useScene('a.glb');
    tabA.setCurrentColor('PAINT_A', '#111111');
    ls.refuseWrites = true;
    tabA.flush();
    ls.refuseWrites = false;
    tabB.useScene('b.glb');
    tabB.setCurrentColor('PAINT_B', '#222222');
    tabB.flush();

    tabA.flush();

    expect(Object.keys(stored().scenes).toSorted()).toEqual(['a.glb', 'b.glb']);
  });
});
