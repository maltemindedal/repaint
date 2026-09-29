/**
 * The page shown when the app cannot start: most often the browser would not
 * hand out a WebGL 2 context (hardware acceleration off, a blocklisted GPU, a
 * remote-desktop or VM session, enterprise policy). The constructor then throws
 * before any UI exists, and without this the page is simply blank.
 *
 * The markup lives in index.html (`#boot-error`) and is switched on by a class on
 * <html>, like the mobile gate, so nothing has to be built here.
 */

const FAILED_CLASS = 'boot-failed';

export function showBootError(cause: unknown): void {
  console.error('[boot] failed', cause);
  const detail = document.getElementById('boot-error-detail');
  // textContent, never markup: the message can carry anything an exception does.
  if (detail) detail.textContent = cause instanceof Error ? cause.message : String(cause);
  document.documentElement.classList.add(FAILED_CLASS);
}
