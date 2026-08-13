import { describe, expect, it } from 'vitest';
import { PointLight, SRGBColorSpace, type Box3, type Object3D } from 'three';
import { createFallbackScene } from '../src/core/fallbackScene.ts';
import { defaultPose, processScene } from '../src/core/processScene.ts';
import { PaintRegistry } from '../src/core/PaintRegistry.ts';
import { SceneSession } from '../src/core/SceneSession.ts';
import { AppStore } from '../src/state/store.ts';
import { emptyData } from '../src/state/storage.ts';
import type { CameraPose, LoadedScene, NavMode, PaintTarget } from '../src/types.ts';

/**
 * The activation sequence used to be five unwritten ordering rules spread over
 * `App.setScene`. It is one implementation now, so the rules are assertable.
 *
 * Each ordering test below names the failure mode it guards; why the order is
 * that way is written beside the step itself, in `SceneSession.load`.
 */

function makeScene(overrides: Partial<LoadedScene> = {}): LoadedScene {
  const root = createFallbackScene();
  const processed = processScene(root);
  return {
    root,
    key: 'apartment.glb',
    label: 'apartment.glb',
    bounds: processed.bounds,
    lights: processed.lights,
    startCam: processed.startCam,
    startCamFov: processed.startCamFov,
    bakedMaterials: processed.bakedMaterials,
    aoOnlyMaterials: processed.aoOnlyMaterials,
    hasBakedTextures: processed.bakedMaterials.length > 0,
    stats: { ...processed.stats, draco: false, meshopt: false, ktx2: false },
    isFallback: false,
    ...overrides,
  };
}

function makeHarness() {
  const log: string[] = [];
  const registry = new PaintRegistry();
  const store = new AppStore(emptyData());

  const camera = {
    fov: 55,
    updateProjectionMatrix(): void {
      log.push('camera.updateProjectionMatrix');
    },
  };

  const picker = {
    root: undefined as Object3D | null | undefined,
    /** What the registry knew at the moment the picker was handed the scene. */
    keysAtSetScene: [] as string[],
    setScene(root: Object3D | null): void {
      this.root = root;
      this.keysAtSetScene = registry.list().map((t) => t.key);
      log.push('picker.setScene');
    },
    refreshTargets(): void {
      log.push('picker.refreshTargets');
    },
  };

  const nav = {
    mode: 'orbit' as NavMode,
    bounds: null as Box3 | null,
    /** The bounds in force when the pose was applied. */
    boundsAtPose: null as Box3 | null,
    poses: [] as CameraPose[],
    setBounds(bounds: Box3): void {
      this.bounds = bounds;
      log.push('nav.setBounds');
    },
    applyPose(pose: CameraPose): void {
      this.boundsAtPose = this.bounds;
      this.poses.push(pose);
      log.push('nav.applyPose');
    },
  };

  const targetLists: string[][] = [];
  let applyCount = 0;
  const session = new SceneSession(
    { camera, registry, picker, nav, store },
    {
      applySettings: () => {
        log.push('applySettings');
        // Stands in for the one thing this direction answers back with: an
        // eye height walk mode had to clamp reports the correction to
        // `setSetting`, which writes whichever scene is current. Counting
        // makes each load's write tellable from the last one's.
        store.setSetting('eyeHeight', ++applyCount);
      },
      targetsChanged: (targets: PaintTarget[]) => {
        targetLists.push(targets.map((t) => t.key));
        log.push('targetsChanged');
      },
    },
  );

  return { camera, log, nav, picker, registry, session, store, targetLists };
}

describe('scene activation order', () => {
  it('runs one fixed sequence', () => {
    const { log, session } = makeHarness();

    session.load(makeScene());

    expect(log).toEqual([
      'picker.setScene',
      'targetsChanged',
      'nav.setBounds',
      'nav.applyPose',
      'applySettings',
    ]);
  });

  it('discovers against the new scene before the picker is pointed at it', () => {
    const { picker, session } = makeHarness();
    const scene = makeScene();

    session.load(scene);

    // Guards: the picker pinning the previous scene's material instances.
    expect(picker.root).toBe(scene.root);
    expect(picker.keysAtSetScene).toContain('PAINT_Living_North');
    // The real picker refreshes targets from inside `setScene`; an earlier,
    // separate refresh is the bug.
    expect(picker.keysAtSetScene).toHaveLength(3);
  });

  it('has the new bounds in place before the pose is applied', () => {
    const { nav, session } = makeHarness();
    const scene = makeScene();

    session.load(scene);

    // Guards: the walk clamp holding the applied pose to the previous apartment.
    expect(nav.boundsAtPose).toBe(scene.bounds);
  });

  it('pushes the store back out with the incoming scene current', () => {
    const { log, session, store } = makeHarness();

    session.load(makeScene({ key: 'first.glb' }));
    session.load(makeScene({ key: 'second.glb' }));

    // Guards: a correction the world reports back landing in the prefs of the
    // scene we just navigated away from.
    store.useScene('first.glb');
    expect(store.scene.settings.eyeHeight).toBe(1);
    store.useScene('second.glb');
    expect(store.scene.settings.eyeHeight).toBe(2);
    expect(log.indexOf('applySettings')).toBeGreaterThan(log.indexOf('nav.applyPose'));
  });
});

describe('per-scene defaults', () => {
  it('writes heuristic defaults into the incoming scene, never the outgoing one', () => {
    const { session, store } = makeHarness();

    // A scene with lights and no bake clearly wants its exported lights on.
    session.load(
      makeScene({ key: 'lit.glb', lights: [new PointLight()], hasBakedTextures: false }),
    );
    // A baked scene with lights would be double-lit.
    session.load(
      makeScene({ key: 'baked.glb', lights: [new PointLight()], hasBakedTextures: true }),
    );

    // Each guess landed in its own file's slot, and loading the second scene
    // left the first one's alone.
    store.useScene('baked.glb');
    expect(store.scene.settings.punctualLights).toBe(false);
    store.useScene('lit.glb');
    expect(store.scene.settings.punctualLights).toBe(true);
  });

  it('leaves punctual lights alone once the user has made the call', () => {
    const { session, store } = makeHarness();
    store.useScene('apartment.glb');
    store.setSetting('punctualLights', true);

    session.load(makeScene({ lights: [new PointLight()], hasBakedTextures: true }));

    expect(store.settings.punctualLights).toBe(true);
  });

  it('gives ORM-packed occlusion a working AO default', () => {
    const { session, store } = makeHarness();
    const scene = makeScene();
    // ORM-packed occlusion can't drive a lightmap, so the AO slider is the
    // whole effect there — the global default of 0 would silently disable it.
    session.load({ ...scene, aoOnlyMaterials: [...scene.bakedMaterials] });

    expect(store.settings.aoMapIntensity).toBe(1);
  });

  it('leaves the AO intensity alone once the user has chosen one', () => {
    const { session, store } = makeHarness();
    const scene = makeScene();
    store.useScene(scene.key);
    store.setSetting('aoMapIntensity', 0.3);

    session.load({ ...scene, aoOnlyMaterials: [...scene.bakedMaterials] });

    expect(store.settings.aoMapIntensity).toBe(0.3);
  });

  it('has no heuristic to run for a scene with no lights', () => {
    const { session, store } = makeHarness();

    session.load(makeScene());

    expect(store.scene.settings.punctualLights).toBeUndefined();
    expect(store.scene.settings.aoMapIntensity).toBeUndefined();
  });
});

describe('camera pose', () => {
  it('prefers the pose saved for this scene and nav mode', () => {
    const { nav, session, store } = makeHarness();
    const saved: CameraPose = { position: [1, 2, 3], target: [0, 1, 0] };
    const scene = makeScene({ startCam: { position: [9, 9, 9], target: [0, 0, 0] } });
    store.useScene(scene.key);
    store.setPose('orbit', saved);
    store.setPose('walk', { position: [7, 7, 7], target: [0, 0, 0] });

    session.load(scene);

    // `nav.mode` is orbit — the walk pose belongs to the other mode.
    expect(nav.poses).toEqual([saved]);
  });

  it('falls back to START_CAM, then to a pose derived from the bounds', () => {
    const withStartCam = makeHarness();
    const startCam: CameraPose = { position: [9, 2, 9], target: [0, 1, 0] };
    withStartCam.session.load(makeScene({ startCam, startCamFov: 40 }));
    expect(withStartCam.nav.poses).toEqual([startCam]);
    expect(withStartCam.camera.fov).toBe(40);
    expect(withStartCam.log).toContain('camera.updateProjectionMatrix');

    const bare = makeHarness();
    const scene = makeScene();
    bare.session.load(scene);
    expect(bare.nav.poses).toEqual([defaultPose(scene.bounds)]);
    expect(bare.camera.fov).toBe(55);
  });
});

describe('colour restore', () => {
  it('repaints from the store, so a reload picks up where you left off', () => {
    const { registry, session, store } = makeHarness();
    const scene = makeScene();
    store.useScene(scene.key);
    store.setCurrentColor('PAINT_Living_North', '#abcdef');

    session.load(scene);

    const target = registry.get('PAINT_Living_North')!;
    expect(target.currentHex).toBe('#abcdef');
    expect(target.materials[0].color.getHexString(SRGBColorSpace)).toBe('abcdef');
  });

  it('keeps live colours across a re-tag', () => {
    const { log, picker, registry, session, store, targetLists } = makeHarness();
    const scene = makeScene();
    session.load(scene);
    registry.setColor('PAINT_Living_North', '#abcdef');
    store.setCurrentColor('PAINT_Living_North', '#abcdef');
    log.length = 0;

    store.setTagged('Floor_Oak', true, false);
    session.rediscover();

    expect(registry.get('Floor_Oak')).toBeDefined();
    expect(registry.get('PAINT_Living_North')!.currentHex).toBe('#abcdef');
    expect(
      registry.get('PAINT_Living_North')!.materials[0].color.getHexString(SRGBColorSpace),
    ).toBe('abcdef');
    // Same scene graph: the picker refreshes in place rather than resetting.
    expect(log).toEqual(['picker.refreshTargets', 'targetsChanged']);
    expect(picker.root).toBe(scene.root);
    expect(targetLists.at(-1)).toContain('Floor_Oak');
  });

  it('keeps the exported colour across a re-tag', () => {
    const { registry, session, store } = makeHarness();
    const scene = makeScene();
    session.load(scene);
    const exported = registry.get('PAINT_Living_North')!.exportedHex;

    registry.setColor('PAINT_Living_North', '#abcdef');
    store.setCurrentColor('PAINT_Living_North', '#abcdef');
    store.setTagged('Floor_Oak', true, false);
    session.rediscover();

    // Guards the reported bug: re-discovery reading the exported colour off
    // materials that by now wear the user's paint, so R "resets" to the paint.
    expect(registry.get('PAINT_Living_North')!.exportedHex).toBe(exported);
    registry.resetColor('PAINT_Living_North');
    expect(registry.get('PAINT_Living_North')!.currentHex).toBe(exported);
  });

  it('ignores stored colours for materials this scene does not have', () => {
    const { registry, session, store } = makeHarness();
    const scene = makeScene();
    store.useScene(scene.key);
    store.setCurrentColor('PAINT_Nonexistent', '#abcdef');

    expect(() => session.load(scene)).not.toThrow();
    expect(registry.get('PAINT_Nonexistent')).toBeUndefined();
  });
});

describe('the loaded scene', () => {
  it('is exposed for the things that outlive activation', () => {
    const { session } = makeHarness();
    const scene = makeScene();

    expect(session.scene).toBeNull();
    session.load(scene);
    expect(session.scene).toBe(scene);
  });

  it('rediscovers nothing before a scene is loaded', () => {
    const { log, session } = makeHarness();

    session.rediscover();

    expect(log).toEqual([]);
  });
});
