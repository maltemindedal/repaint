/**
 * Builds `dist/repaint.html` — a single self-contained file you can double-click
 * and open straight from Finder, no server needed.
 *
 * Browsers block ES-module imports of *separate files* on the file:// protocol,
 * but an *inline* module script is fine. So this script takes the normal Vite
 * build and folds the JS bundle and stylesheet into index.html.
 *
 * One caveat, printed at the end: the DRACO and KTX2 decoders are WASM files
 * fetched on demand, and fetch() is blocked on file:// — so compressed GLBs
 * need the served build (`npm run serve:dist`). Uncompressed GLBs (Blender's
 * default export) and meshopt (bundled JS, no fetch) work fully.
 *
 * Run via `npm run build:portable` (which builds first).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');

// The entry bundle and stylesheet as Vite wrote them into index.html.
const scriptMatch = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/);
if (!scriptMatch || !styleMatch) {
  throw new Error('Could not find the entry script/stylesheet in dist/index.html — did the build run?');
}

let js = await readFile(resolve(dist, scriptMatch[1]), 'utf8');
const css = await readFile(resolve(dist, styleMatch[1]), 'utf8');

// Sourcemap pointer would 404 from an inline script; drop it.
js = js.replace(/\/\/# sourceMappingURL=.*$/m, '');
// `</script>` anywhere in the bundle would close the inline tag early. Inside
// JS string/regex context `<\/script` is equivalent, so this is safe.
js = js.replaceAll('</script', '<\\/script');

// Replacer *functions*, not strings: minified JS is full of `$'`/`$&`-style
// sequences that String.replace would interpret as replacement patterns and
// silently corrupt the output.
const out = html
  .replace(styleMatch[0], () => `<style>\n${css}\n</style>`)
  .replace(scriptMatch[0], () => `<script type="module">\n${js}\n</script>`);

const target = resolve(dist, 'repaint.html');
await writeFile(target, out);

const mb = (Buffer.byteLength(out) / (1024 * 1024)).toFixed(1);
console.log(`wrote ${target} (${mb} MB) — open it directly, no server needed.`);
console.log(
  'note: DRACO/KTX2-compressed GLBs cannot decode from file:// (WASM fetch is blocked); use `npm run serve:dist` for those.',
);
