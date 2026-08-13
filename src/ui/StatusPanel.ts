import { el, requireElement, requireQuery } from '../util/dom.ts';

/**
 * The transient status toast and the loading overlay — all the ephemeral
 * feedback DOM, out of App's way.
 *
 * Both the display timer and the fade timer are tracked: a toast arriving
 * during the previous toast's 400 ms fade-out must cancel that fade, or the
 * old cleanup wipes the new message off the screen early.
 */
export class StatusPanel {
  private statusEl = requireElement('status');
  private loadingEl = requireElement('loading');
  private loadingFill = requireQuery<HTMLElement>(this.loadingEl, '.loading-bar-fill');
  private loadingLabel = requireQuery<HTMLElement>(this.loadingEl, '.loading-label');

  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  status(message: string, duration = 2600): void {
    if (this.displayTimer) clearTimeout(this.displayTimer);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;

    this.statusEl.replaceChildren(el('div', { class: 'toast', text: message }));
    this.displayTimer = setTimeout(() => {
      this.displayTimer = null;
      this.statusEl.firstElementChild?.classList.add('fading');
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = null;
        this.statusEl.replaceChildren();
      }, 400);
    }, duration);
  }

  showLoading(fraction: number, label: string): void {
    this.loadingEl.hidden = false;
    this.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
    this.loadingLabel.textContent = label;
  }

  hideLoading(): void {
    this.loadingEl.hidden = true;
    this.loadingFill.style.width = '0%';
  }
}
