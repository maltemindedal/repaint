/**
 * Narrows away `undefined`/`null` with a runtime check, for indexed accesses
 * under `noUncheckedIndexedAccess`. Prefer this over the `!` operator in
 * tests: a wrong assumption fails with a clear message instead of a
 * `TypeError` several lines later.
 */
export function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

/** One triangle, 36 bytes of positions: the smallest mesh a glTF can carry. */
const TRIANGLE = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);

/** glTF chunks are 4-byte aligned. */
function padTo4(bytes: Uint8Array, fill: number): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
  padded.set(bytes);
  return padded;
}

/**
 * A minimal binary glTF: one node with a one-triangle mesh wearing a material
 * called `materialName`. `json` overrides or removes top-level keys (pass
 * `scenes: undefined` for a file with no scene at all).
 */
export function makeGlb(
  materialName = 'PAINT_Test',
  json: Record<string, unknown> = {},
): ArrayBuffer {
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: materialName, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    ...json,
  };
  const jsonChunk = padTo4(new TextEncoder().encode(JSON.stringify(doc)), 0x20);
  const binChunk = padTo4(new Uint8Array(TRIANGLE.buffer), 0);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  bytes.set(jsonChunk, 20);
  const binAt = 20 + jsonChunk.length;
  view.setUint32(binAt, binChunk.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // 'BIN\0'
  bytes.set(binChunk, binAt + 8);
  return out;
}
