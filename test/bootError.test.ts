// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootWhenSupported } from '../src/ui/MobileGate.ts';

/**
 * When the app cannot start (usually because the browser will not hand out a
 * WebGL 2 context) the constructor throws before any UI exists. Without a
 * message that is a blank page. The message itself lives in index.html so it can
 * be shown even though nothing else was built.
 */
function mountShell() {
  document.body.innerHTML = `
    <div id="app"></div>
    <div id="mobile-gate"><button id="gate-continue"></button><div id="gate-url"></div></div>
    <div id="boot-error" role="alert"><div id="boot-error-detail"></div></div>`;
  document.documentElement.className = '';
}

describe('bootWhenSupported', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mountShell();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
    document.documentElement.className = '';
  });

  it('boots the app and shows nothing else when boot succeeds', () => {
    const boot = vi.fn();

    bootWhenSupported(boot);

    expect(boot).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('boot-failed')).toBe(false);
  });

  it('shows the error page, with the reason, when boot throws', () => {
    bootWhenSupported(() => {
      throw new Error('Error creating WebGL context.');
    });

    expect(document.documentElement.classList.contains('boot-failed')).toBe(true);
    expect(document.getElementById('boot-error-detail')?.textContent).toBe(
      'Error creating WebGL context.',
    );
  });

  it('logs the cause for the console', () => {
    const cause = new Error('no webgl');

    bootWhenSupported(() => {
      throw cause;
    });

    expect(error).toHaveBeenCalledWith('[boot] failed', cause);
  });

  it('shows something for a thrown value that is not an Error', () => {
    bootWhenSupported(() => {
      throw 'plain string';
    });

    expect(document.documentElement.classList.contains('boot-failed')).toBe(true);
    expect(document.getElementById('boot-error-detail')?.textContent).toBe('plain string');
  });

  it('does not put markup from the message into the page', () => {
    bootWhenSupported(() => {
      throw new Error('<img src=x onerror=alert(1)>');
    });

    const detail = document.getElementById('boot-error-detail');
    expect(detail?.querySelector('img')).toBeNull();
    expect(detail?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('still shows the page when the error template is missing from the HTML', () => {
    document.getElementById('boot-error')?.remove();

    expect(() =>
      bootWhenSupported(() => {
        throw new Error('boom');
      }),
    ).not.toThrow();
    expect(document.documentElement.classList.contains('boot-failed')).toBe(true);
  });
});
