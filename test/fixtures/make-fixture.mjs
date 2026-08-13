/**
 * Generates `apartment-fixture.glb` — a stand-in for a Blender export that
 * follows the convention the README documents:
 *
 *   · `PAINT_` materials with a flat baseColorFactor and no baseColorTexture
 *   · a baked lighting texture in the **occlusion** slot on **TEXCOORD_1**
 *   · a camera node named `START_CAM`
 *   · one non-paintable material (`Floor_Oak`) to prove discovery is by
 *     material name, not mesh name
 *
 * Written by hand rather than with GLTFExporter, which needs a DOM canvas to
 * encode textures. Geometry maths still comes from three.
 *
 *   node test/fixtures/make-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, Euler, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- PNG writer

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal 8-bit RGB PNG encoder. */
function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------- baked lightmap PNG

const TEX = 128;
const rgb = Buffer.alloc(TEX * TEX * 3);
for (let y = 0; y < TEX; y++) {
  for (let x = 0; x < TEX; x++) {
    const u = x / (TEX - 1);
    const v = 1 - y / (TEX - 1); // PNG rows run top-down, UV runs bottom-up
    const edge = Math.min(u, 1 - u, v, 1 - v);
    // x0.6 so the peak reads as fully lit at lightMapIntensity = PI.
    const lum = (0.55 + 0.45 * v ** 0.7) * (0.45 + 0.55 * Math.min(1, edge / 0.18)) * 0.6;
    const c = Math.round(255 * Math.max(0, Math.min(1, lum)));
    const i = (y * TEX + x) * 3;
    rgb[i] = c;
    rgb[i + 1] = c;
    rgb[i + 2] = Math.round(c * 0.98);
  }
}
const png = encodePNG(TEX, TEX, rgb);

// ------------------------------------------------------------- scene layout

const W = 4.2;
const D = 3.6;
const H = 2.6;

/** Bakes the transform into the vertices so every glTF node stays identity. */
function place(geometry, position, rotation = [0, 0, 0]) {
  const matrix = new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    new Vector3(1, 1, 1),
  );
  geometry.applyMatrix4(matrix);
  // Second UV set for the bake. A real Blender export would carry a distinct
  // lightmap unwrap here; reusing uv0 is enough to prove the plumbing.
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  return geometry;
}

const parts = [
  {
    name: 'North_Wall',
    material: 'PAINT_Living_North',
    color: '#e8e4da',
    geometry: place(new PlaneGeometry(W, H), [0, H / 2, -D / 2]),
  },
  {
    name: 'East_Wall',
    material: 'PAINT_Living_East',
    color: '#d9d3c6',
    geometry: place(new PlaneGeometry(D, H), [W / 2, H / 2, 0], [0, -Math.PI / 2, 0]),
  },
  {
    name: 'West_Wall',
    material: 'PAINT_Living_West',
    color: '#dfd8c9',
    geometry: place(new PlaneGeometry(D, H), [-W / 2, H / 2, 0], [0, Math.PI / 2, 0]),
  },
  {
    name: 'Ceiling_Geo',
    material: 'PAINT_Ceiling',
    color: '#f4f2ee',
    geometry: place(new PlaneGeometry(W, D), [0, H, 0], [Math.PI / 2, 0, 0]),
  },
  // Deliberately named so that *mesh*-name matching would wrongly catch it.
  {
    name: 'PAINT_Floor_Mesh',
    material: 'Floor_Oak',
    color: '#8a6b4a',
    geometry: place(new PlaneGeometry(W, D), [0, 0, 0], [-Math.PI / 2, 0, 0]),
  },
  {
    name: 'Sideboard',
    material: 'Furniture_Walnut',
    color: '#4a3527',
    geometry: place(new BoxGeometry(1.6, 0.55, 0.42), [-0.6, 0.275, -D / 2 + 0.24]),
  },
];

// --------------------------------------------------------------- GLB assembly

const bin = [];
let binLength = 0;
const bufferViews = [];
const accessors = [];

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function addBufferView(buffer, target) {
  const padding = pad4(binLength);
  if (padding) {
    bin.push(Buffer.alloc(padding));
    binLength += padding;
  }
  const view = { buffer: 0, byteOffset: binLength, byteLength: buffer.length };
  if (target) view.target = target;
  bin.push(buffer);
  binLength += buffer.length;
  bufferViews.push(view);
  return bufferViews.length - 1;
}

const FLOAT = 5126;
const USHORT = 5123;

function addAccessor(array, type, componentType, target) {
  const buffer = Buffer.from(
    componentType === FLOAT ? Float32Array.from(array).buffer : Uint16Array.from(array).buffer,
  );
  const view = addBufferView(buffer, target);
  const stride = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const count = array.length / stride;

  const accessor = { bufferView: view, componentType, count, type };
  if (type === 'VEC3' && componentType === FLOAT) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = array[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    accessor.min = min;
    accessor.max = max;
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

// glTF baseColorFactor is linear; the exporter does this conversion too.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const hexToFactor = (hex) => {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return [...srgb.map(toLinear), 1];
};

const imageView = addBufferView(png);
const materials = [];
const meshes = [];
const nodes = [];

for (const part of parts) {
  const g = part.geometry;
  const primitive = {
    attributes: {
      POSITION: addAccessor([...g.getAttribute('position').array], 'VEC3', FLOAT, 34962),
      NORMAL: addAccessor([...g.getAttribute('normal').array], 'VEC3', FLOAT, 34962),
      TEXCOORD_0: addAccessor([...g.getAttribute('uv').array], 'VEC2', FLOAT, 34962),
      TEXCOORD_1: addAccessor([...g.getAttribute('uv1').array], 'VEC2', FLOAT, 34962),
    },
    indices: addAccessor([...g.getIndex().array], 'SCALAR', USHORT, 34963),
    material: materials.length,
    mode: 4,
  };

  materials.push({
    name: part.material,
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: hexToFactor(part.color),
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
    // The lightmap. Blender has no lightmap slot, so the bake rides in on the
    // occlusion input — exactly what the README tells you to do.
    occlusionTexture: { index: 0, texCoord: 1, strength: 1 },
  });

  meshes.push({ name: `${part.name}_Mesh`, primitives: [primitive] });
  nodes.push({ name: part.name, mesh: meshes.length - 1 });
}

// START_CAM, looking at the corner between the north and west walls.
const eye = new Vector3(1.2, 1.62, 1.1);
const look = new Vector3(-0.5, 1.45, -D / 2);
const quaternion = new Quaternion().setFromRotationMatrix(
  new Matrix4().lookAt(eye, look, new Vector3(0, 1, 0)),
);
nodes.push({
  name: 'START_CAM',
  camera: 0,
  translation: eye.toArray(),
  rotation: quaternion.toArray(),
});

const json = {
  asset: { version: '2.0', generator: 'repaint fixture' },
  scene: 0,
  scenes: [{ name: 'Apartment', nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  materials,
  cameras: [
    { type: 'perspective', perspective: { yfov: 0.86, znear: 0.1, zfar: 200, aspectRatio: 1.6 } },
  ],
  textures: [{ source: 0, sampler: 0 }],
  images: [{ bufferView: imageView, mimeType: 'image/png', name: 'Bake' }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLength + pad4(binLength) }],
};

const binChunk = Buffer.concat([...bin, Buffer.alloc(pad4(binLength))]);
const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(pad4(jsonBuffer.length), 0x20)]);

const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.write('JSON', 4, 'ascii');

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

const glb = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
const out = resolve(here, 'apartment-fixture.glb');
writeFileSync(out, glb);
console.log(
  `wrote ${out} (${(glb.length / 1024).toFixed(1)} kB) — ` +
    `${meshes.length} meshes, ${materials.length} materials, ` +
    `${materials.filter((m) => m.name.startsWith('PAINT_')).length} paintable`,
);
