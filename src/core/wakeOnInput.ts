/**
 * Input that can change what the canvas shows. Each is heard on the window in the
 * capture phase, ahead of whatever handles it, so a frame asked for here runs after
 * the handler has done its work. `pointermove` is not here: it is handled below.
 */
const INPUT_EVENTS = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'wheel',
  'keydown',
  'keyup',
  // Colour pickers and sliders report a change as `input` / `change`, not a click.
  'input',
  'change',
  // A tab coming back to the front may have lost its canvas contents.
  'visibilitychange',
] as const;

/**
 * Calls `wake` whenever the user does something that could need a new frame, for
 * the render loop that otherwise sleeps. Frames that don't change anything are the
 * price of not knowing what a handler will do, and are cheap next to drawing
 * continuously.
 *
 * A moving pointer counts only over the canvas (hover, look) or with a button down
 * (dragging, in the canvas or a slider). Passing over the sidebar changes nothing.
 * Returns a function that stops listening.
 */
export function wakeOnInput(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  canvas: EventTarget,
  wake: () => void,
): () => void {
  const options = { capture: true, passive: true } as const;
  const onPointerMove = (event: Event): void => {
    if ((event as PointerEvent).buttons !== 0 || event.target === canvas) wake();
  };

  for (const type of INPUT_EVENTS) target.addEventListener(type, wake, options);
  target.addEventListener('pointermove', onPointerMove, options);

  return () => {
    for (const type of INPUT_EVENTS) target.removeEventListener(type, wake, options);
    target.removeEventListener('pointermove', onPointerMove, options);
  };
}
