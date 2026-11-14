/**
 * Tooth-selection semantics for the chart.
 *
 * Two behaviours clinicians depend on:
 *
 *  - **Range fill.** Clicking two teeth in an arch selects everything between
 *    them. Clinicians pick the corners of the treatment zone (upper 6-11 is the
 *    canonical case), not eight individual teeth.
 *  - **Per-arch independence.** A range never spans the upper/lower boundary;
 *    the two arches are tracked separately.
 */

import { archOf, isUniversal, type Universal } from './teeth.js';

/** Every tooth between `a` and `b` inclusive, ascending. */
export function inclusiveRange(a: Universal, b: Universal): Universal[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const out: Universal[] = [];
  for (let t = lo; t <= hi; t++) out.push(t);
  return out;
}

/**
 * Apply a click on `tooth` to the current selection.
 *
 * `anchor` is the last tooth clicked in the same arch; when it is present and
 * `extend` is set, the click fills the range between them. A plain click always
 * toggles just the one tooth.
 *
 * Returns the new selection *and* the new anchor, so the caller does not have
 * to reproduce the arch rule.
 */
export function applyToothClick(
  selected: readonly Universal[],
  tooth: Universal,
  options: { anchor?: Universal | undefined; extend?: boolean } = {},
): { selected: Universal[]; anchor: Universal } {
  if (!isUniversal(tooth)) throw new RangeError(`Not a universal tooth number: ${tooth}`);

  const { anchor, extend = false } = options;
  const set = new Set(selected);

  // A range only fills within one arch -- never across the midline boundary.
  const sameArch = anchor !== undefined && archOf(anchor) === archOf(tooth);

  if (extend && sameArch && anchor !== tooth) {
    for (const t of inclusiveRange(anchor, tooth)) set.add(t);
  } else if (set.has(tooth)) {
    set.delete(tooth);
  } else {
    set.add(tooth);
  }

  return { selected: [...set].sort((a, b) => a - b), anchor: tooth };
}

/** Drop every tooth of one arch, leaving the other untouched. */
export const clearArch = (
  selected: readonly Universal[],
  arch: 'upper' | 'lower',
): Universal[] => selected.filter((t) => archOf(t) !== arch);
