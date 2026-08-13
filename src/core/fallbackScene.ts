import {
  BoxGeometry,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { LIGHTMAP_INTENSITY } from './processScene.ts';

/**
 * A tiny procedural apartment corner used before you drop a GLB — and as the
 * fixture for the smoke test. It deliberately mirrors the export convention it
 * documents: `PAINT_` materials with flat base colours, plus a baked-looking
 * lightmap on a second UV channel.
 *
 * Everything here is renderer-free (DataTexture rather than a canvas) so the
 * same builder runs headless under vitest.
 */

const ROOM = { w: 4.2, d: 3.6, h: 2.6 };

/** Soft vertical gradient with corner falloff — reads like a Cycles bake. */
export function makeBakedGradient(size = 128): Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);

      // Light falls from the upper area of the wall downwards.
      const vertical = 0.55 + 0.45 * Math.pow(v, 0.7);
      // Darken toward every edge, more strongly in the corners.
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const occlusion = 0.45 + 0.55 * Math.min(1, edge / 0.18);
      // A faint warm-cool sweep so flat colours don't look like paper.
      const sweep = 0.97 + 0.06 * Math.sin(u * Math.PI);

      // Scaled so the brightest point lands near sRGB 0.6 -> linear ~0.32,
      // which x lightMapIntensity (π) reads as "fully lit" — matching what a
      // real Cycles diffuse bake stores.
      const lum = Math.max(0, Math.min(1, vertical * occlusion * sweep)) * 0.6;
      const i = (y * size + x) * 4;
      data[i] = Math.round(255 * lum * 1.0);
      data[i + 1] = Math.round(255 * lum * 0.99);
      data[i + 2] = Math.round(255 * lum * 0.96);
      data[i + 3] = 255;
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = 'FallbackBake';
  return tex;
}

/** three needs a `uv1` attribute to sample lightMap/aoMap. Reuse `uv`. */
function withUv1<T extends BufferGeometry>(geometry: T): T {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv);
  return geometry;
}

function surface(
  name: string,
  color: string,
  geometry: BufferGeometry,
  bake: Texture | null,
  roughness = 0.92,
): Mesh {
  const material = new MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness: 0,
  });
  if (bake) {
    // Same slot arrangement processScene() builds for a real GLB, so the demo
    // room exercises the identical lighting path.
    material.lightMap = bake;
    material.lightMapIntensity = LIGHTMAP_INTENSITY;
    material.aoMap = bake;
    material.aoMapIntensity = 0;
  }
  const mesh = new Mesh(withUv1(geometry), material);
  mesh.name = `${name}_Mesh`;
  return mesh;
}

export function createFallbackScene(): Group {
  const root = new Group();
  root.name = 'FallbackRoom';
  const bake = makeBakedGradient();

  // Two walls meeting in a corner, plus floor and ceiling. Wall colours are
  // deliberately different so the sidebar has something to tell apart.
  const north = surface(
    'PAINT_Living_North',
    '#e8e4da',
    new PlaneGeometry(ROOM.w, ROOM.h),
    bake,
  );
  north.position.set(0, ROOM.h / 2, -ROOM.d / 2);
  root.add(north);

  const east = surface('PAINT_Living_East', '#d9d3c6', new PlaneGeometry(ROOM.d, ROOM.h), bake);
  east.position.set(ROOM.w / 2, ROOM.h / 2, 0);
  east.rotation.y = -Math.PI / 2;
  root.add(east);

  const ceiling = surface('PAINT_Ceiling', '#f4f2ee', new PlaneGeometry(ROOM.w, ROOM.d), bake, 0.96);
  ceiling.position.set(0, ROOM.h, 0);
  ceiling.rotation.x = Math.PI / 2;
  root.add(ceiling);

  // Non-paintable surfaces: they must show up in the "all materials" list but
  // never in the paint list.
  const floor = surface('Floor_Oak', '#8a6b4a', new PlaneGeometry(ROOM.w, ROOM.d), bake, 0.6);
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const skirtingMat = new MeshStandardMaterial({ name: 'Trim_White', color: '#f6f5f2', roughness: 0.5 });
  const skirtingN = new Mesh(withUv1(new BoxGeometry(ROOM.w, 0.09, 0.02)), skirtingMat);
  skirtingN.position.set(0, 0.045, -ROOM.d / 2 + 0.01);
  skirtingN.name = 'Skirting_North';
  root.add(skirtingN);

  const skirtingE = new Mesh(withUv1(new BoxGeometry(0.02, 0.09, ROOM.d)), skirtingMat);
  skirtingE.position.set(ROOM.w / 2 - 0.01, 0.045, 0);
  skirtingE.name = 'Skirting_East';
  root.add(skirtingE);

  // A low sideboard for scale and a shadowed reference against the wall.
  const woodMat = new MeshStandardMaterial({ name: 'Furniture_Walnut', color: '#4a3527', roughness: 0.45 });
  const sideboard = new Mesh(withUv1(new BoxGeometry(1.6, 0.55, 0.42)), woodMat);
  sideboard.position.set(-0.6, 0.275, -ROOM.d / 2 + 0.24);
  sideboard.name = 'Sideboard';
  root.add(sideboard);

  const potMat = new MeshStandardMaterial({ name: 'Ceramic_Grey', color: '#b9b4ad', roughness: 0.35 });
  const pot = new Mesh(withUv1(new BoxGeometry(0.18, 0.22, 0.18)), potMat);
  pot.position.set(-0.15, 0.66, -ROOM.d / 2 + 0.24);
  pot.name = 'Pot';
  root.add(pot);

  return root;
}

export const FALLBACK_KEY = '__fallback__';
export const FALLBACK_LABEL = 'Demo room (procedural)';
