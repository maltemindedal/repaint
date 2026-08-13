/**
 * Narrows away `undefined`/`null` with a runtime check, for indexed accesses
 * under `noUncheckedIndexedAccess`. Prefer this over the `!` operator in
 * tests: a wrong assumption fails with a clear message instead of a
 * `TypeError` several lines later.
 */
export function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}
