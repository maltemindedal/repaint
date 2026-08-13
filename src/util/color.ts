/**
 * Colour helpers. Everything here speaks sRGB hex (`#rrggbb`) because that is
 * what paint manufacturers publish and what you paste into the hex field.
 * Conversion into three's linear working space happens once, at the boundary,
 * via `Color.setStyle()`.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalises `e8e4da`, `#E8E4DA`, `#eda` -> `#e8e4da`. Returns null if invalid. */
export function normalizeHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  let body = m[1].toLowerCase();
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  return `#${body}`;
}

/**
 * Pulls a hex out of free-form text, e.g. `"Alcro Lammull #E8E4DA"`.
 * Used so you can paste a whole product line into the hex field.
 */
export function extractHex(input: string): string | null {
  const m = /#?\b([0-9a-f]{6})\b/i.exec(input) ?? /#([0-9a-f]{3})\b/i.exec(input);
  return m ? normalizeHex(m[1]) : normalizeHex(input);
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#000000';
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

const toChannelHex = (v: number): string =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toChannelHex(r)}${toChannelHex(g)}${toChannelHex(b)}`;
}

export function hexToHsv(hex: string): HSV {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor((((h % 360) + 360) % 360) / 60);
  const rgb: [number, number, number] =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}
