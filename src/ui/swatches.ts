import { el } from '../util/dom.ts';

/**
 * The tiny stacked colour strip shown on scheme slots, shared by the toolbar
 * and the sidebar. An empty scheme renders a single neutral chip so the strip
 * keeps its footprint.
 */
export function miniSwatches(hexes: string[], max: number): HTMLElement {
  const strip = el('div', { class: 'mini-swatches' });
  const shown = hexes.slice(0, max);
  for (const hex of shown) strip.appendChild(el('i', { style: `background:${hex}` }));
  if (shown.length === 0) strip.appendChild(el('i', { style: 'background:#3a3a3a' }));
  return strip;
}
