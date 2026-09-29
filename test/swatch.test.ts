// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { colorEl } from '../src/util/dom.ts';
import { miniSwatches } from '../src/ui/swatches.ts';

/**
 * Colours reach the DOM from `localStorage` and from imported JSON, where they
 * are only known to be strings. They must paint a background and do nothing else.
 */
const hostile = 'red;background-image:url(https://tracker.example/p.png)';

describe('colorEl', () => {
  it('paints the colour it is given', () => {
    const node = colorEl('div', '#e8e4da', { class: 'swatch' });
    expect(node.className).toBe('swatch');
    expect(node.style.backgroundColor).toBe('#e8e4da');
  });

  it('accepts a named colour', () => {
    expect(colorEl('i', 'red').style.backgroundColor).toBe('red');
  });

  it('ignores a value that only the background shorthand would accept', () => {
    // Valid in `background: ...` but not a <color>: setting the shorthand instead of
    // background-color would let these through.
    for (const value of ['url(https://tracker.example/p.png)', 'linear-gradient(red, blue)']) {
      const node = colorEl('div', value);
      expect(node.getAttribute('style') ?? '').not.toMatch(/url\(|gradient/);
      expect(node.style.backgroundImage).toBe('');
    }
  });

  it('ignores a value that tries to add further declarations', () => {
    const node = colorEl('div', hostile);
    expect(node.style.backgroundImage).toBe('');
    expect(node.getAttribute('style') ?? '').not.toContain('url(');
  });
});

describe('miniSwatches', () => {
  it('draws one chip per colour, up to the limit', () => {
    const strip = miniSwatches(['#111111', '#222222', '#333333'], 2);
    const chips = [...strip.querySelectorAll('i')];
    expect(chips.map((chip) => chip.style.backgroundColor)).toEqual(['#111111', '#222222']);
  });

  it('draws one neutral chip for an empty scheme', () => {
    const chips = [...miniSwatches([], 4).querySelectorAll('i')];
    expect(chips).toHaveLength(1);
    expect(chips[0]?.style.background).toBe('#3a3a3a');
  });

  it('never lets a colour string carry extra CSS', () => {
    const strip = miniSwatches([hostile], 4);
    expect(strip.innerHTML).not.toContain('url(');
  });
});
