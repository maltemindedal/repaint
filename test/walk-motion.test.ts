import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { EYE_HEIGHT_RANGE, WalkMotion } from '../src/nav/WalkMotion.ts';
import { AppStore, DEFAULT_SETTINGS } from '../src/state/store.ts';
import { emptyData } from '../src/state/storage.ts';

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
});
