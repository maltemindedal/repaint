import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { WebGLRenderer } from 'three';
import { createGLTFLoader, embeddedOnlyManager } from '../src/core/loaders.ts';

/** A one-triangle glTF whose only buffer is `uri`. */
function triangleGltf(uri: string): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
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
    buffers: [{ byteLength: 36, uri }],
  });
}

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);
const embeddedBuffer = `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}`;

describe('embeddedOnlyManager', () => {
  it('leaves data: and blob: URLs alone and turns everything else into an unfetchable one', () => {
    const manager = embeddedOnlyManager();
    expect(manager.resolveURL('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(manager.resolveURL('blob:http://localhost/1234')).toBe('blob:http://localhost/1234');
    expect(manager.resolveURL('DATA:text/plain,x')).toBe('DATA:text/plain,x');

    expect(manager.resolveURL('https://tracker.example/a.png')).toBe('about:blank');
    expect(manager.resolveURL('http://tracker.example/a.png')).toBe('about:blank');
    expect(manager.resolveURL('//tracker.example/a.png')).toBe('about:blank');
    expect(manager.resolveURL('textures/a.png')).toBe('about:blank');
    expect(manager.resolveURL('file:///etc/passwd')).toBe('about:blank');
  });
});

const fetchedUrls = (spy: ReturnType<typeof vi.fn>): string[] =>
  spy.mock.calls.map((call) => {
    const input = (call as unknown[])[0];
    return input instanceof Request ? input.url : String(input);
  });

describe('glTF resources cannot make the tab fetch third-party URLs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('control: a stock GLTFLoader does fetch an external buffer', async () => {
    const spy = vi.fn(() => Promise.reject(new TypeError('blocked in test')));
    vi.stubGlobal('fetch', spy);
    await expect(
      new GLTFLoader().parseAsync(triangleGltf('https://tracker.example/b.bin'), ''),
    ).rejects.toThrow();
    expect(fetchedUrls(spy).some((url) => url.includes('tracker.example'))).toBe(true);
  });

  it('never fetches the external buffer when the embedded-only manager is used', async () => {
    const spy = vi.fn(() => Promise.reject(new TypeError('blocked in test')));
    vi.stubGlobal('fetch', spy);
    const loader = new GLTFLoader(embeddedOnlyManager());
    await expect(
      loader.parseAsync(triangleGltf('https://tracker.example/b.bin'), ''),
    ).rejects.toThrow();
    expect(fetchedUrls(spy).some((url) => url.includes('tracker.example'))).toBe(false);
  });

  it('still loads a buffer that is embedded as a data: URI', async () => {
    // Node's own fetch decodes data: URLs without touching the network; Node has no
    // ProgressEvent, which FileLoader dispatches while streaming a response.
    vi.stubGlobal('ProgressEvent', Event);
    const realFetch = globalThis.fetch;
    const spy = vi.fn((input: RequestInfo | URL) => realFetch(input));
    vi.stubGlobal('fetch', spy);
    const gltf = await new GLTFLoader(embeddedOnlyManager()).parseAsync(
      triangleGltf(embeddedBuffer),
      '',
    );
    expect(gltf.scene.children).toHaveLength(1);
    expect(fetchedUrls(spy).every((url) => url.startsWith('data:'))).toBe(true);
  });
});

/** Replaces `fetch` with one that refuses everything, and returns the spy. */
function refusingFetch() {
  const spy = vi.fn(() => Promise.reject(new TypeError('blocked in test')));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('createGLTFLoader', () => {
  afterEach(() => vi.unstubAllGlobals());

  const renderer = {
    extensions: { has: () => false, get: () => null },
  } as unknown as WebGLRenderer;
  it('gives the glTF loader the embedded-only manager', () => {
    const loader = createGLTFLoader(renderer);

    expect(loader.manager.resolveURL('https://tracker.example/a.png')).toBe('about:blank');
    expect(loader.manager.resolveURL('blob:http://localhost/1234')).toBe(
      'blob:http://localhost/1234',
    );
  });

  it('control: a stock KTX2Loader fetches the texture URL it is given', () => {
    const spy = refusingFetch();

    const stock = new KTX2Loader();
    stock.detectSupport(renderer);
    stock.load('https://tracker.example/t.ktx2', vi.fn(), undefined, vi.fn());

    expect(fetchedUrls(spy).some((url) => url.includes('tracker.example'))).toBe(true);
  });

  it('never fetches an external KHR_texture_basisu image', () => {
    const spy = refusingFetch();
    const ktx2 = createGLTFLoader(renderer).ktx2Loader;

    ktx2?.load('https://tracker.example/t.ktx2', vi.fn(), undefined, vi.fn());
    ktx2?.load('//tracker.example/t.ktx2', vi.fn(), undefined, vi.fn());
    ktx2?.load('textures/t.ktx2', vi.fn(), undefined, vi.fn());

    expect(fetchedUrls(spy).some((url) => url.includes('tracker.example'))).toBe(false);
  });

  it('still fetches a KTX2 texture that GLTFLoader built as a blob: URL', () => {
    const spy = refusingFetch();

    createGLTFLoader(renderer).ktx2Loader?.load(
      'blob:http://localhost/1234',
      vi.fn(),
      undefined,
      vi.fn(),
    );

    expect(fetchedUrls(spy)).toEqual(['blob:http://localhost/1234']);
  });

  it('leaves the KTX2 own manager alone, so it can still fetch its transcoder', () => {
    const ktx2 = createGLTFLoader(renderer).ktx2Loader;

    expect(ktx2?.manager.resolveURL('https://localhost/assets/basis_transcoder.wasm')).toBe(
      'https://localhost/assets/basis_transcoder.wasm',
    );
  });
});
