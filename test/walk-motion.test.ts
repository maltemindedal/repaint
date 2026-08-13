import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { EYE_HEIGHT_RANGE, WalkMotion } from '../src/nav/WalkMotion.ts';
import { AppStore, DEFAULT_SETTINGS } from '../src/state/store.ts';
import { emptyData, migrate } from '../src/state/storage.ts';

/**
 * Eye height has one owner: whoever listens to `onEyeHeightChange`. These tests
 * pin that contract — every way the height can move must come back out through
 * the callback, so a listener that persists it never holds a stale value.
 */

function walk() {
  const motion = new WalkMotion(new PerspectiveCamera());
  const reported: number[] = [];
  motion.onEyeHeightChange = (value) => reported.push(value);
  return { motion, reported };
}

describe('eye-height ownership', () => {
  it('reports a height change to its owner', () => {
    const { motion, reported } = walk();

    motion.setEyeHeight(1.2);

    expect(motion.eyeHeight).toBe(1.2);
    expect(reported).toEqual([1.2]);
  });

  it('reports the clamped height, never the raw request', () => {
    const { motion, reported } = walk();

    // Spinning the wheel past the limit must not leave the listener storing a
    // value the module refused to adopt.
    motion.setEyeHeight(-4);
    expect(motion.eyeHeight).toBe(EYE_HEIGHT_RANGE.min);

    motion.setEyeHeight(99);
    expect(motion.eyeHeight).toBe(EYE_HEIGHT_RANGE.max);

    expect(reported).toEqual([EYE_HEIGHT_RANGE.min, EYE_HEIGHT_RANGE.max]);
  });

  it('stays quiet when the height does not actually move', () => {
    const { motion, reported } = walk();

    motion.setEyeHeight(1.2);
    motion.setEyeHeight(1.2);
    // Keeping the wheel spinning at the floor of the range is not a change.
    motion.setEyeHeight(EYE_HEIGHT_RANGE.min);
    motion.setEyeHeight(EYE_HEIGHT_RANGE.min - 1);

    expect(reported).toEqual([1.2, EYE_HEIGHT_RANGE.min]);
  });

  it('reports the height Q and E walk it to', () => {
    const { motion, reported } = walk();
    const standing = motion.eyeHeight;

    motion.keys.add('KeyQ');
    for (let i = 0; i < 30; i++) motion.update(1 / 60);
    motion.keys.delete('KeyQ');

    expect(motion.eyeHeight).toBeLessThan(standing);
    expect(reported.at(-1)).toBe(motion.eyeHeight);

    const crouched = motion.eyeHeight;
    motion.keys.add('KeyE');
    for (let i = 0; i < 30; i++) motion.update(1 / 60);
    motion.keys.delete('KeyE');

    expect(motion.eyeHeight).toBeGreaterThan(crouched);
    expect(reported.at(-1)).toBe(motion.eyeHeight);
  });

  it('says nothing about height while the user is only walking', () => {
    const { motion, reported } = walk();

    motion.keys.add('KeyW');
    for (let i = 0; i < 30; i++) motion.update(1 / 60);

    expect(reported).toEqual([]);
  });

  it('takes a height from its owner without echoing it back', () => {
    const { motion, reported } = walk();

    motion.adoptEyeHeight(1.2);

    expect(motion.eyeHeight).toBe(1.2);
    // The owner is the one talking. Reporting here would be the store hearing
    // its own value come back as if the user had moved.
    expect(reported).toEqual([]);
  });

  it('tells its owner when the height it was handed is unusable', () => {
    const { motion, reported } = walk();

    // Storage only checks that a setting is a finite number, so a hand-edited
    // or imported file can carry a height no one can stand at.
    motion.adoptEyeHeight(100);

    expect(motion.eyeHeight).toBe(EYE_HEIGHT_RANGE.max);
    // Staying silent here is what leaves the owner holding 100 while walk mode
    // stands at 6 — two truths again, which is the whole thing being fixed.
    expect(reported).toEqual([EYE_HEIGHT_RANGE.max]);
  });
});

describe('standing on the floor', () => {
  // An exported apartment's floor slab is rarely at the origin, so every eye
  // height is measured from `bounds.min.y` rather than from y = 0.
  const FLOOR_Y = 12;

  function bounded() {
    const camera = new PerspectiveCamera();
    const motion = new WalkMotion(camera);
    motion.setBounds(new Box3(new Vector3(-5, FLOOR_Y, -5), new Vector3(5, FLOOR_Y + 3, 5)));
    motion.setEyeHeight(1.2);
    return { camera, motion };
  }

  it('holds the eye above the floor slab, not above the origin', () => {
    const { camera, motion } = bounded();

    motion.update(1 / 60);

    expect(camera.position.y).toBe(13.2);
  });

  it('stands the camera up on the floor when walk mode takes over', () => {
    const { camera, motion } = bounded();
    // Orbit left the camera up near the ceiling.
    camera.position.set(2, FLOOR_Y + 2.8, 3);

    motion.syncFromCamera();

    expect(motion.eye.y).toBe(13.2);
  });
});

describe('eye height and the store', () => {
  it('leaves the store holding the height the user walked to', () => {
    const store = new AppStore(emptyData());
    store.useScene('apartment.glb');

    const camera = new PerspectiveCamera();
    const motion = new WalkMotion(camera);
    motion.onEyeHeightChange = (value) => store.setSetting('eyeHeight', value);

    motion.keys.add('KeyQ');
    for (let i = 0; i < 30; i++) motion.update(1 / 60);
    motion.keys.delete('KeyQ');

    const crouched = motion.eyeHeight;
    expect(crouched).toBeLessThan(DEFAULT_SETTINGS.eyeHeight);
    expect(camera.position.y).toBe(crouched);
    // Nothing that re-applies settings afterwards — a tone-mapping toggle, a
    // debug slider, a scene reload — can stand the user back up, because the
    // value they all read is the one the user just walked to.
    expect(store.settings.eyeHeight).toBe(crouched);
  });

  it('does not stamp a height onto a scene the user never chose one for', () => {
    const store = new AppStore(emptyData());
    store.useScene('other.glb');

    const motion = new WalkMotion(new PerspectiveCamera());
    motion.setEyeHeight(1.2);
    motion.onEyeHeightChange = (value) => store.setSetting('eyeHeight', value);

    // Loading a scene seeds walk mode from that scene's settings — here, from
    // the default, because this scene has none of its own.
    motion.adoptEyeHeight(store.settings.eyeHeight);

    expect(motion.eyeHeight).toBe(DEFAULT_SETTINGS.eyeHeight);
    // Merely opening a scene must not opt it out of the default for good.
    expect(store.scene.settings.eyeHeight).toBeUndefined();
  });

  it('corrects a stored height that walk mode refuses', () => {
    const store = new AppStore(
      migrate({ version: 1, scenes: { 'x.glb': { settings: { eyeHeight: 100 } } } }),
    );
    store.useScene('x.glb');

    const motion = new WalkMotion(new PerspectiveCamera());
    motion.onEyeHeightChange = (value) => store.setSetting('eyeHeight', value);

    motion.adoptEyeHeight(store.settings.eyeHeight);

    expect(motion.eyeHeight).toBe(EYE_HEIGHT_RANGE.max);
    // The store is the single truth, so it must not go on holding a height
    // nothing will ever use.
    expect(store.settings.eyeHeight).toBe(EYE_HEIGHT_RANGE.max);
  });
});
