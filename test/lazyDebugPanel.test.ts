import { describe, expect, it, vi } from 'vitest';
import { LazyDebugPanel, type DebugPanel } from '../src/ui/DebugPanel.ts';
import { DEFAULT_SETTINGS } from '../src/state/store.ts';

/**
 * The debug panel (lil-gui plus the fps meter) is hidden until the backtick key
 * and costs about 30 ms of main-thread time to build. `LazyDebugPanel` builds it
 * on first use and makes everything the app does to it in the meantime a no-op.
 */
function fakePanel() {
  return {
    toggle: vi.fn(),
    beginFrame: vi.fn(),
    endFrame: vi.fn(),
    syncSettings: vi.fn(),
    isVisible: false,
  };
}

function lazy() {
  const panel = fakePanel();
  const create = vi.fn(() => panel as unknown as DebugPanel);
  return { panel, create, lazy: new LazyDebugPanel(create) };
}

describe('LazyDebugPanel', () => {
  it('builds nothing until it is first toggled', () => {
    const { create, lazy: debug } = lazy();

    debug.beginFrame();
    debug.endFrame();
    debug.syncSettings(DEFAULT_SETTINGS);
    expect(debug.isVisible).toBe(false);

    expect(create).not.toHaveBeenCalled();
  });

  it('builds the panel on the first toggle and toggles it', () => {
    const { create, panel, lazy: debug } = lazy();

    debug.toggle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(panel.toggle).toHaveBeenCalledTimes(1);
  });

  it('builds it once, however often it is toggled', () => {
    const { create, panel, lazy: debug } = lazy();

    debug.toggle();
    debug.toggle();
    debug.toggle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(panel.toggle).toHaveBeenCalledTimes(3);
  });

  it('passes frame ticks and settings changes on once the panel exists', () => {
    const { panel, lazy: debug } = lazy();
    debug.toggle();

    debug.beginFrame();
    debug.endFrame();
    debug.syncSettings({ ...DEFAULT_SETTINGS, exposure: 1.4 });

    expect(panel.beginFrame).toHaveBeenCalledTimes(1);
    expect(panel.endFrame).toHaveBeenCalledTimes(1);
    expect(panel.syncSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, exposure: 1.4 });
  });

  it('reports whether the panel is visible', () => {
    const { panel, lazy: debug } = lazy();
    debug.toggle();

    panel.isVisible = true;

    expect(debug.isVisible).toBe(true);
  });
});
