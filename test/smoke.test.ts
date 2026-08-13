import { describe, expect, it } from 'vitest';
import { must } from './helpers.ts';
import {
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import { createFallbackScene } from '../src/core/fallbackScene.ts';
import { processScene, defaultPose } from '../src/core/processScene.ts';
import { PaintRegistry, displayNameFor } from '../src/core/PaintRegistry.ts';
import { AppStore } from '../src/state/store.ts';
import { emptyData, migrate } from '../src/state/storage.ts';
import { isMesh, isStandard } from '../src/core/materials.ts';
import { extractHex, hexToHsv, hsvToHex, normalizeHex } from '../src/util/color.ts';

/**
 * Smoke test over the procedural fallback room — the same scene the app shows
 * before you drop a GLB. It exercises the whole non-GPU pipeline: material
 * discovery, the colour write path, schemes, and persistence.
 */

function buildScene() {
  const root = createFallbackScene();
  const processed = processScene(root);
  const registry = new PaintRegistry();
  registry.discover(root);
  return { root, processed, registry };
}

/** The mesh's sole material, checked to be a MeshStandardMaterial. */
function materialOf(mesh: Mesh): MeshStandardMaterial {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || !isStandard(mat)) throw new Error(`Mesh ${mesh.name} has no standard material`);
  return mat;
}

/** The wall mesh wearing `materialName` — discovery is by material, never mesh. */
function findWall(root: Object3D, materialName: string): Mesh {
  const wall = root.children.find(
    (c): c is Mesh => isMesh(c) && !Array.isArray(c.material) && c.material.name === materialName,
  );
  if (!wall) throw new Error(`No mesh uses material ${materialName}`);
  return wall;
}

describe('fallback scene', () => {
  it('builds a room with baked lighting on a second UV set', () => {
    const { root, processed } = buildScene();

    expect(processed.stats.meshes).toBeGreaterThanOrEqual(4);
    expect(processed.stats.triangles).toBeGreaterThan(0);
    expect(processed.bakedMaterials.length).toBeGreaterThan(0);

    const walls = root.children.filter(
      (child): child is Mesh => isMesh(child) && materialOf(child).name.startsWith('PAINT_'),
    );
    expect(walls.length).toBeGreaterThanOrEqual(2);

    for (const wall of walls) {
      const material = materialOf(wall);
      // A lightmap is useless without the UV channel it samples.
      expect(wall.geometry.getAttribute('uv1')).toBeTruthy();
      expect(material.lightMap).toBeTruthy();
      // lightMap drives the bake; aoMap shares the texture but stays at 0 so
      // the occlusion isn't multiplied in twice.
      expect(material.lightMap).toBe(material.aoMap);
      expect(material.aoMapIntensity).toBe(0);
      // Paintable walls must be flat-coloured, or setting `color` does nothing.
      expect(material.map).toBeNull();
    }
  });

  it('produces a pose above the floor and inside the room', () => {
    const { processed } = buildScene();
    const pose = defaultPose(processed.bounds);
    expect(pose.position[1]).toBeGreaterThan(processed.bounds.min.y);
    expect(pose.position[1]).toBeLessThan(processed.bounds.max.y);
  });
});

describe('material discovery', () => {
  it('finds paintable surfaces by material prefix, not mesh name', () => {
    const { registry } = buildScene();
    const keys = registry.list().map((t) => t.key);

    expect(keys).toContain('PAINT_Living_North');
    expect(keys).toContain('PAINT_Living_East');
    expect(keys).toContain('PAINT_Ceiling');
    expect(keys).not.toContain('Floor_Oak');

    // The floor mesh is named `Floor_Oak_Mesh`; nothing may key off that.
    expect(registry.allMaterials().map((m) => m.name)).toContain('Floor_Oak');
    expect(registry.allMaterials().find((m) => m.name === 'Floor_Oak')?.isPaintable).toBe(false);
  });

  it('cleans up display names', () => {
    expect(displayNameFor('PAINT_Living_North')).toBe('Living North');
    expect(displayNameFor('PAINT_Bedroom')).toBe('Bedroom');
    expect(displayNameFor('PAINT_Living_North.001')).toBe('Living North');
    expect(displayNameFor('PAINT_hall-ceiling')).toBe('Hall Ceiling');
    // Not a PAINT_ material, but manual tagging still needs a readable label.
    expect(displayNameFor('Wall_02')).toBe('Wall 02');
  });

  it('supports manual tagging when the convention is absent', () => {
    const { root } = buildScene();
    const registry = new PaintRegistry();

    registry.discover(root, { tagged: ['Floor_Oak'], untagged: ['PAINT_Ceiling'] });
    const keys = registry.list().map((t) => t.key);

    expect(keys).toContain('Floor_Oak');
    expect(keys).not.toContain('PAINT_Ceiling');
    expect(registry.get('Floor_Oak')?.auto).toBe(false);
  });

  it('refreshes its sorted views after a re-discovery', () => {
    const { root, registry } = buildScene();
    // Read both first: they are cached per discovery, so this is what a stale
    // cache would go on serving.
    expect(registry.list().map((t) => t.key)).not.toContain('Floor_Oak');
    expect(registry.allMaterials().find((m) => m.name === 'Floor_Oak')?.isPaintable).toBe(false);

    registry.discover(root, { tagged: ['Floor_Oak'] });

    expect(registry.list().map((t) => t.key)).toContain('Floor_Oak');
    expect(registry.allMaterials().find((m) => m.name === 'Floor_Oak')?.isPaintable).toBe(true);
  });

  it('resolves a raycast hit back to its target', () => {
    const { root, registry } = buildScene();
    const wall = findWall(root, 'PAINT_Living_North');

    expect(registry.targetForMaterial(wall.material)?.key).toBe('PAINT_Living_North');
  });
});

describe('colour pipeline', () => {
  it('round-trips a pasted hex through the material', () => {
    const { registry } = buildScene();
    const target = registry.get('PAINT_Living_North')!;

    registry.setColor(target.key, '#e8e4da');

    expect(target.currentHex).toBe('#e8e4da');
    // The value that actually reaches the GPU must read back as the same sRGB hex.
    expect(must(target.materials[0]).color.getHexString(SRGBColorSpace)).toBe('e8e4da');
  });

  it('never invalidates the shader program on a colour change', () => {
    const { registry } = buildScene();
    const material = must(registry.get('PAINT_Living_North')!.materials[0]);
    const before = material.version;

    registry.setColor('PAINT_Living_North', '#123456');
    registry.setColor('PAINT_Living_North', '#654321');

    // `Material.version` bumps only via `needsUpdate`, which forces a recompile.
    expect(material.version).toBe(before);
  });

  it('resets a wall to its exported colour', () => {
    const { registry } = buildScene();
    const target = registry.get('PAINT_Living_East')!;
    const original = target.originalHex;

    registry.setColor(target.key, '#ff0000');
    expect(target.currentHex).toBe('#ff0000');

    registry.resetColor(target.key);
    expect(target.currentHex).toBe(original);
    expect(must(target.materials[0]).color.getHexString(SRGBColorSpace)).toBe(original.slice(1));
  });

  it('captures and re-applies a scheme', () => {
    const { registry } = buildScene();

    registry.setColor('PAINT_Living_North', '#aabbcc');
    registry.setColor('PAINT_Living_East', '#ddeeff');
    const schemeA = registry.capture();

    registry.resetAll();
    expect(registry.get('PAINT_Living_North')!.currentHex).not.toBe('#aabbcc');

    const applied = registry.applyScheme(schemeA);
    expect(applied).toBe(Object.keys(schemeA).length);
    expect(registry.get('PAINT_Living_North')!.currentHex).toBe('#aabbcc');
    expect(registry.get('PAINT_Living_East')!.currentHex).toBe('#ddeeff');
  });

  it('ignores scheme entries for materials this scene does not have', () => {
    const { registry } = buildScene();
    expect(registry.applyScheme({ PAINT_Nonexistent: '#000000' })).toBe(0);
  });

  it('re-reads the graph on discovery rather than re-applying what it last wrote', () => {
    const { root, registry } = buildScene();
    registry.setColor('PAINT_Living_North', '#abcdef');
    // Move the material on behind the registry's back. The registry used to
    // keep its own map of applied colours and push it back over the top here;
    // restoring what was on screen belongs to the store instead, one level up
    // — see test/sceneSession.test.ts.
    must(registry.get('PAINT_Living_North')!.materials[0]).color.setStyle(
      '#123456',
      SRGBColorSpace,
    );

    registry.discover(root, { tagged: ['Floor_Oak'] });

    const target = registry.get('PAINT_Living_North')!;
    expect(target.currentHex).toBe('#123456');
    expect(must(target.materials[0]).color.getHexString(SRGBColorSpace)).toBe('123456');
  });

  it('still knows the exported colour after a re-discovery of a painted scene', () => {
    const { root, registry } = buildScene();
    const exported = registry.get('PAINT_Living_North')!.originalHex;
    expect(exported).not.toBe('#abcdef');

    registry.setColor('PAINT_Living_North', '#abcdef');
    // What a manual tag toggle does: re-run discovery over the same materials,
    // which by now carry paint rather than the colours the GLB shipped with.
    registry.discover(root, { tagged: ['Floor_Oak'] });

    const target = registry.get('PAINT_Living_North')!;
    expect(target.originalHex).toBe(exported);

    registry.resetColor(target.key);
    expect(target.currentHex).toBe(exported);
    expect(must(target.materials[0]).color.getHexString(SRGBColorSpace)).toBe(exported.slice(1));
  });

  it('re-reads exported colours when a different scene is loaded', () => {
    const { registry } = buildScene();
    registry.setColor('PAINT_Living_North', '#abcdef');

    // A fresh load brings its own materials — the previous scene's exported
    // colours must not leak into it.
    const other = createFallbackScene();
    const wall = findWall(other, 'PAINT_Living_North');
    materialOf(wall).color.setStyle('#102030', SRGBColorSpace);
    registry.discover(other);

    expect(registry.get('PAINT_Living_North')!.originalHex).toBe('#102030');
  });
});

describe('colour utilities', () => {
  it('normalises the hex forms people actually paste', () => {
    expect(normalizeHex('E8E4DA')).toBe('#e8e4da');
    expect(normalizeHex('#E8E4DA')).toBe('#e8e4da');
    expect(normalizeHex('#eda')).toBe('#eeddaa');
    expect(normalizeHex('not a colour')).toBeNull();
  });

  it('pulls a hex out of a product name', () => {
    expect(extractHex('Alcro Lammull #E8E4DA')).toBe('#e8e4da');
    expect(extractHex('NCS S 0502-Y')).toBeNull();
  });

  it('round-trips hex -> hsv -> hex', () => {
    for (const hex of ['#e8e4da', '#000000', '#ffffff', '#3a7fd5', '#8a6b4a']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});

describe('persistence', () => {
  it('keeps schemes and tagging per scene, and the library globally', () => {
    const store = new AppStore(emptyData());

    store.useScene('apartment.glb');
    store.setTagged('Wall_02', true, false);
    store.saveScheme('slot-1', { PAINT_Living_North: '#e8e4da' });
    store.renameScheme('slot-1', 'Warm white');
    const entry = store.addLibraryColor('Alcro Lammull', '#E8E4DA')!;

    store.useScene('other.glb');
    expect(store.scene.tagged).toEqual([]);
    expect(must(store.schemes[0]).colors).toEqual({});
    expect(store.library).toContainEqual(expect.objectContaining({ id: entry.id }));

    store.useScene('apartment.glb');
    expect(store.scene.tagged).toEqual(['Wall_02']);
    expect(must(store.schemes[0]).name).toBe('Warm white');
    expect(must(store.schemes[0]).colors).toEqual({ PAINT_Living_North: '#e8e4da' });
    // Library hexes are normalised on the way in.
    expect(must(store.library[0]).hex).toBe('#e8e4da');
  });

  it('survives a JSON export/import round trip', () => {
    const store = new AppStore(emptyData());
    store.useScene('apartment.glb');
    store.saveScheme('slot-2', { PAINT_Bedroom: '#c9c2b6' });
    store.addLibraryColor('Chalk', '#f2f0eb');
    store.setSetting('exposure', 1.4);

    const json = store.exportJSON();
    const restored = new AppStore(emptyData());
    restored.importJSON(json, 'replace');
    restored.useScene('apartment.glb');

    expect(must(restored.schemes[1]).colors).toEqual({ PAINT_Bedroom: '#c9c2b6' });
    expect(must(restored.library[0]).name).toBe('Chalk');
    expect(restored.settings.exposure).toBe(1.4);
  });

  it('lets a guess fill a setting the user has not decided, and only that', () => {
    const store = new AppStore(emptyData());
    store.useScene('apartment.glb');

    store.setDefaultSetting('punctualLights', true);
    expect(store.settings.punctualLights).toBe(true);

    // A guess never overrules a choice — including a choice that happens to
    // equal the global default, which `settings` alone could not tell apart.
    store.setSetting('aoMapIntensity', 0);
    store.setDefaultSetting('aoMapIntensity', 1);
    expect(store.settings.aoMapIntensity).toBe(0);
  });

  it('always hands back three keyboard-addressable scheme slots', () => {
    const store = new AppStore(migrate({ version: 1, scenes: { 'x.glb': { schemes: [] } } }));
    store.useScene('x.glb');
    expect(store.schemes.length).toBe(3);
  });

  it('does not crash on corrupt saved data', () => {
    expect(() => migrate('nonsense')).not.toThrow();
    expect(migrate(null).scenes).toEqual({});
  });

  it('drops malformed entries instead of propagating them', () => {
    const data = migrate({
      version: 1,
      scenes: {
        'x.glb': {
          tagged: ['ok', 42, null],
          schemes: [
            { id: 'slot-1', name: 'Good', colors: { PAINT_A: '#fff', PAINT_B: 7 } },
            { id: 9, name: 'bad id' },
            'not a scheme',
          ],
          poses: {
            orbit: { position: [1, 2, 3], target: [0, 0, 0] },
            walk: { position: [1, 'nope', 3], target: [0, 0, 0] },
          },
          settings: { exposure: 1.4, toneMapping: 'yes', walkSpeed: NaN, bogus: 1 },
          current: { PAINT_A: '#abc', PAINT_B: { hex: '#def' } },
        },
      },
    });

    const scene = must(data.scenes['x.glb']);
    expect(scene.tagged).toEqual(['ok']);
    expect(scene.schemes).toEqual([{ id: 'slot-1', name: 'Good', colors: { PAINT_A: '#fff' } }]);
    expect(scene.poses.orbit).toBeDefined();
    expect(scene.poses.walk).toBeUndefined();
    expect(scene.settings).toEqual({ exposure: 1.4 });
    expect(scene.current).toEqual({ PAINT_A: '#abc' });
  });
});

describe('baked-texture wiring', () => {
  it('uses a standalone occlusion texture as an sRGB lightmap', () => {
    const { processed } = buildScene();
    expect(processed.bakedMaterials.length).toBeGreaterThan(0);
    expect(processed.aoOnlyMaterials).toEqual([]);
  });

  it('treats ORM-packed occlusion as AO-only, never a lightmap', () => {
    // A material whose occlusion texture is shared with roughness — the shape
    // glTF produces when the exporter packs O/R/M into one image.
    const packed = new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, RGBAFormat);
    packed.needsUpdate = true;

    const material = new MeshStandardMaterial({ name: 'PAINT_Packed', color: '#ffffff' });
    material.aoMap = packed;
    material.roughnessMap = packed;

    const geometry = new PlaneGeometry(1, 1);
    geometry.setAttribute('uv1', geometry.getAttribute('uv'));
    const root = new Group();
    root.add(new Mesh(geometry, material));

    const processed = processScene(root);

    expect(processed.aoOnlyMaterials).toContain(material);
    expect(processed.bakedMaterials).not.toContain(material);
    expect(material.lightMap).toBeNull();
    expect(material.aoMapIntensity).toBe(1);
  });
});
