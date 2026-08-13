import { el, clear } from '../util/dom.ts';
import { miniSwatches } from './swatches.ts';
import type { NavMode, SchemeView } from '../types.ts';

export interface ToolbarCallbacks {
  onModeChange: (mode: NavMode) => void;
  onApplyScheme: (id: string) => void;
  onFrame: () => void;
  onScreenshot: () => void;
  onToggleHelp: () => void;
  onToggleToneMapping: () => void;
}

/**
 * Floating controls over the viewport. Kept to one compact block so it never
 * competes with the wall you're actually looking at.
 */
export class Toolbar {
  private orbitBtn: HTMLButtonElement;
  private walkBtn: HTMLButtonElement;
  private slotsRow = el('div', { class: 'scheme-slots' });
  private toneBtn: HTMLButtonElement;
  private renderedSlots: string | null = null;

  constructor(
    private root: HTMLElement,
    private cb: ToolbarCallbacks,
  ) {
    this.orbitBtn = el('button', { text: 'Orbit', onclick: () => this.cb.onModeChange('orbit') });
    this.walkBtn = el('button', { text: 'Walk', onclick: () => this.cb.onModeChange('walk') });

    this.toneBtn = el('button', {
      class: 'btn',
      text: 'ACES',
      title: 'Tone mapping on/off (T). Turn it off to judge an exact hex.',
      onclick: () => this.cb.onToggleToneMapping(),
    });

    const row = el('div', { class: 'toolbar-row' }, [
      el('div', { class: 'seg', title: 'Switch with Tab' }, [this.orbitBtn, this.walkBtn]),
      this.toneBtn,
      el('button', {
        class: 'btn',
        text: 'Frame',
        title: 'Frame the whole scene (F)',
        onclick: () => this.cb.onFrame(),
      }),
      el('button', {
        class: 'btn',
        text: 'PNG',
        title: 'Screenshot at 2× (P)',
        onclick: () => this.cb.onScreenshot(),
      }),
      el('button', {
        class: 'btn ghost',
        text: '?',
        title: 'Keyboard shortcuts (?)',
        onclick: () => this.cb.onToggleHelp(),
      }),
    ]);

    clear(this.root);
    this.root.append(row, this.slotsRow);
    this.setMode('orbit');
  }

  setMode(mode: NavMode): void {
    this.orbitBtn.classList.toggle('active', mode === 'orbit');
    this.walkBtn.classList.toggle('active', mode === 'walk');
  }

  setToneMapping(enabled: boolean): void {
    this.toneBtn.textContent = enabled ? 'ACES' : 'Raw';
    this.toneBtn.classList.toggle('danger', !enabled);
    this.toneBtn.title = enabled
      ? 'ACES filmic tone mapping is ON — colours are film-like, not literal. Press T for raw.'
      : 'Tone mapping OFF — on-screen colour matches the hex you typed. Press T for ACES.';
  }

  /**
   * Rebuilt only when the slots actually differ. The app renders both views
   * after every mutation, including on each pointermove of a colour drag, and
   * a slot rebuild per move would be pure churn.
   */
  renderSchemes({ schemes, activeId }: SchemeView): void {
    const signature = JSON.stringify([activeId, schemes.map((s) => [s.id, s.name, s.colors])]);
    if (signature === this.renderedSlots) return;
    this.renderedSlots = signature;

    clear(this.slotsRow);
    schemes.slice(0, 3).forEach((scheme, index) => {
      const colors = Object.values(scheme.colors);
      const empty = colors.length === 0;
      this.slotsRow.appendChild(
        el(
          'button',
          {
            class: `scheme-slot${scheme.id === activeId ? ' active' : ''}`,
            title: empty
              ? `Slot ${index + 1} is empty — use “Save current” in the sidebar`
              : `Apply “${scheme.name}” (${index + 1})`,
            onclick: () => this.cb.onApplyScheme(scheme.id),
          },
          [
            el('span', { class: 'kbd', text: String(index + 1) }),
            miniSwatches(colors, 4),
            el('span', { class: 'name', text: scheme.name }),
          ],
        ),
      );
    });
  }
}
