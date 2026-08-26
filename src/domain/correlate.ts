/**
 * Translation search by normalized cross-correlation.
 *
 * Used to refine a photo alignment on the teeth themselves. Pure numerics: it
 * takes two same-sized grayscale buffers and reports the shift that best lines
 * one up with the other, so it can be reasoned about and tested without a
 * canvas.
 *
 * Zero-mean normalized correlation, not plain sum-of-differences: the two
 * photographs are shot under different lighting and the retracted one is
 * usually brighter, so an absolute-difference score would chase exposure
 * rather than shape. Subtracting each window's own mean and dividing by its
 * standard deviation makes the score depend on the *pattern* of light and dark
 * -- the tooth edges -- and not on the overall brightness.
 */

export interface Shift {
  dx: number;
  dy: number;
  /** Correlation at that shift, -1 to 1. Above ~0.5 is a confident lock. */
  score: number;
}

/**
 * Find the (dx, dy) that best aligns `moving` onto `fixed`.
 *
 * Both buffers are `width * height` grayscale samples. The search is
 * coarse-to-fine: a full sweep at `step`, then a single-sample sweep in a small
 * window around the winner. That is two orders of magnitude cheaper than an
 * exhaustive fine search and, because the correlation surface for teeth has one
 * broad peak rather than many narrow ones, it lands in the same place.
 */
export function bestShift(
  fixed: Float32Array,
  moving: Float32Array,
  width: number,
  height: number,
  maxShift: number,
  step = 2,
): Shift {
  let best: Shift = { dx: 0, dy: 0, score: -Infinity };

  for (let dy = -maxShift; dy <= maxShift; dy += step) {
    for (let dx = -maxShift; dx <= maxShift; dx += step) {
      const score = correlate(fixed, moving, width, height, dx, dy);
      if (score > best.score) best = { dx, dy, score };
    }
  }

  // Refine around the coarse winner, one sample at a time.
  if (step > 1) {
    const coarse = best;
    for (let dy = coarse.dy - step; dy <= coarse.dy + step; dy++) {
      for (let dx = coarse.dx - step; dx <= coarse.dx + step; dx++) {
        const score = correlate(fixed, moving, width, height, dx, dy);
        if (score > best.score) best = { dx, dy, score };
      }
    }
  }

  return best;
}

/**
 * Zero-mean normalized cross-correlation of `moving` shifted by (dx, dy)
 * against `fixed`, over the region where they overlap.
 *
 * Returns -1 when there is nothing to compare or either window is flat: a flat
 * window has no features to align, and reporting a high score for it would let
 * a blank region of lip or shadow win the search.
 */
function correlate(
  fixed: Float32Array,
  moving: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): number {
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(width, width - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(height, height - dy);
  if (x1 <= x0 || y1 <= y0) return -1;

  let n = 0;
  let sumF = 0;
  let sumM = 0;

  for (let y = y0; y < y1; y++) {
    const fRow = y * width;
    const mRow = (y + dy) * width + dx;
    for (let x = x0; x < x1; x++) {
      sumF += fixed[fRow + x]!;
      sumM += moving[mRow + x]!;
      n++;
    }
  }
  if (n === 0) return -1;

  const meanF = sumF / n;
  const meanM = sumM / n;

  let num = 0;
  let varF = 0;
  let varM = 0;

  for (let y = y0; y < y1; y++) {
    const fRow = y * width;
    const mRow = (y + dy) * width + dx;
    for (let x = x0; x < x1; x++) {
      const f = fixed[fRow + x]! - meanF;
      const m = moving[mRow + x]! - meanM;
      num += f * m;
      varF += f * f;
      varM += m * m;
    }
  }

  const denom = Math.sqrt(varF * varM);
  return denom < 1e-6 ? -1 : num / denom;
}
