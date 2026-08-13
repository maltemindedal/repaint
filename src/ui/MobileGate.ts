import { requireElement } from '../util/dom.ts';

/**
 * Repaint is a mouse-and-keyboard app: picking a wall needs hover, walk mode
 * needs WASD, and the sidebar wants 340px of its own. A touch-only device has
 * none of that, so it gets a "come back on a desktop" page instead of a WebGL
 * context nobody can drive.
 *
 * The page itself lives in index.html and is switched on by a media query in
 * style.css, so it is up on first paint — before this bundle parses, and even
 * if it never does. This module only decides whether the app boots, and offers
 * a way past the gate for whatever the media query gets wrong (a touchscreen
 * laptop, a desktop browser in device-emulation mode).
 */

const TOUCH_ONLY = '(pointer: coarse) and (hover: none)';
const UNLOCK_CLASS = 'app-unlocked';
const UNLOCK_KEY = 'repaint:allow-mobile';

/** Runs `boot` unless this looks like a phone or a tablet. */
export function bootWhenSupported(boot: () => void): void {
  let booted = false;
  const start = (): void => {
    if (booted) return;
    booted = true;
    boot();
  };

  if (!isTouchOnly() || wasUnlocked()) {
    unlock();
    start();
    return;
  }

  setUpGate(start);
}

function isTouchOnly(): boolean {
  return typeof matchMedia === 'function' && matchMedia(TOUCH_ONLY).matches;
}

function setUpGate(start: () => void): void {
  const url = requireElement('gate-url');
  // Handy on a phone: the address to type on the machine you're moving to.
  url.textContent = location.protocol.startsWith('http')
    ? location.host + (location.pathname === '/' ? '' : location.pathname)
    : '';

  requireElement('gate-continue').addEventListener('click', () => {
    rememberUnlock();
    unlock();
    start();
  });

  // Plugging in a mouse — or closing Chrome's device toolbar — flips the query.
  // Boot then rather than leaving a dead page behind.
  matchMedia(TOUCH_ONLY).addEventListener('change', (event) => {
    if (event.matches) return;
    unlock();
    start();
  });
}

/** Reveals #app and hides the gate, whatever the media query says. */
function unlock(): void {
  document.documentElement.classList.add(UNLOCK_CLASS);
}

// Session-scoped: a deliberate "continue anyway" shouldn't have to be repeated
// on every reload, but it shouldn't outlive the visit either.

function wasUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberUnlock(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* private mode — the unlock just won't survive a reload */
  }
}
