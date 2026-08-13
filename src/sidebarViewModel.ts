import type { PaintRegistry } from './core/PaintRegistry.ts';
import type { AppStore } from './state/store.ts';
import type { SidebarViewModel } from './ui/Sidebar.ts';
import type { LoadedScene } from './types.ts';

/** Where each part of the panel's state actually lives. */
export interface SidebarSources {
  scene: LoadedScene | null;
  registry: PaintRegistry;
  store: AppStore;
  selectedKey: string | null;
  hoveredKey: string | null;
}

/**
 * Collects everything the sidebar draws into one plain object.
 *
 * Its own module, and free of any DOM, so the question "what should the panel
 * be showing right now?" can be answered — and asserted — without building
 * one. That is the whole point of the sidebar taking a view model.
 *
 * Paint rows are **snapshots**, not the registry's live `PaintTarget`s. The
 * registry mutates those in place, so handing them over would give the sidebar
 * a value that changes underneath its own diff, and a colour change would
 * never be visible as one.
 */
export function sidebarViewModel(sources: SidebarSources): SidebarViewModel {
  const { scene, registry, store, selectedKey, hoveredKey } = sources;
  return {
    fileLabel: scene?.label ?? '—',
    targets: registry.list().map((target) => ({
      key: target.key,
      displayName: target.displayName,
      originalHex: target.originalHex,
      currentHex: target.currentHex,
    })),
    materials: registry.allMaterials(),
    library: store.library,
    schemes: { schemes: store.schemes, activeId: store.activeSchemeId },
    selectedKey,
    hoveredKey,
  };
}
