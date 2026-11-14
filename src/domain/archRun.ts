/**
 * Arch-run resolution.
 *
 * Arch fitting cannot lay out a sparse selection: each tooth is positioned
 * relative to its neighbour along the arch, and a central incisor is the anchor
 * the run is laid out from. So the user's picks are widened into a *contiguous
 * run containing a central incisor*.
 *
 * Teeth added by that widening are `auxiliary`: they participate fully in the
 * layout maths but are hidden from the user and excluded from selection.
 */

import { type Arch, type Universal, centralsOf, rangeOf } from './teeth.js';

export interface ArchRun {
  /** Contiguous, ascending, guaranteed to contain a central incisor. */
  run: Universal[];
  /** Teeth in `run` the user did not select -- render these hidden. */
  auxiliary: Universal[];
}

/**
 * Widen a selection into a contiguous, anchored run for one arch.
 *
 * Teeth outside the arch are ignored, so the caller can pass a whole
 * mixed-arch selection. An empty selection yields an empty run: a user who
 * selected no upper teeth wants no upper arch, not a lone injected anchor.
 */
export function resolveArchRun(selected: readonly Universal[], arch: Arch): ArchRun {
  const [min, max] = rangeOf(arch);
  const centrals = centralsOf(arch);

  const picked = [...new Set(selected.filter((t) => t >= min && t <= max))].sort(
    (a, b) => a - b,
  );
  if (picked.length === 0) return { run: [], auxiliary: [] };

  let lo = picked[0]!;
  let hi = picked[picked.length - 1]!;

  // No central in the selection: stretch the run to reach the nearer one, so
  // the layout has an anchor to walk outward from.
  if (!picked.some((t) => centrals.includes(t as (typeof centrals)[number]))) {
    const anchor = hi < centrals[0] ? centrals[0] : centrals[1];
    lo = Math.min(lo, anchor);
    hi = Math.max(hi, anchor);
  }

  const run: Universal[] = [];
  for (let t = lo; t <= hi; t++) run.push(t);

  const pickedSet = new Set(picked);
  return { run, auxiliary: run.filter((t) => !pickedSet.has(t)) };
}

/** Resolve both arches at once from a single mixed selection. */
export function resolveArchRuns(selected: readonly Universal[]): Record<Arch, ArchRun> {
  return {
    upper: resolveArchRun(selected, 'upper'),
    lower: resolveArchRun(selected, 'lower'),
  };
}
