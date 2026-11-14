/**
 * Similarity transform fitting.
 *
 * Aligns the retracted photograph to the smile photograph so the two can be
 * compared and the design overlaid on both.
 *
 * A **similarity** transform -- translation, rotation and one uniform scale --
 * deliberately, not a homography or a full affine. The reasoning: both
 * photographs are frontal portraits of
 * the same face taken minutes apart, so the genuine difference between them is
 * camera distance and a little head rotation. A homography has eight degrees of
 * freedom and will happily fit perspective and shear that is not there, turning
 * small clicking errors into a visibly skewed face. Four degrees of freedom
 * cannot misbehave that way.
 *
 * Fitted by least squares (the Umeyama/Procrustes solution), which uses every
 * point pair rather than just two -- so extra pairs improve the fit instead of
 * being ignored, and no single misplaced click dominates.
 *
 * Pure: no React, no DOM.
 */

import {
  type Matrix2D,
  type Vec2,
  IDENTITY,
  vec,
} from './geometry.js';

/** One corresponding point: the same feature seen in both photographs. */
export interface PointPair {
  /** Position in the retracted photo, image pixels. */
  source: Vec2;
  /** Position in the smile photo, image pixels. */
  target: Vec2;
}

export class SimilarityError extends Error {}

/**
 * Fit the similarity transform mapping `source` points onto `target` points.
 *
 * Needs at least two pairs: one fixes translation only, leaving rotation and
 * scale undetermined. Throws rather than returning a plausible-looking identity,
 * so a caller cannot silently render a misaligned overlay.
 */
export function fitSimilarity(pairs: readonly PointPair[]): Matrix2D {
  if (pairs.length < 2) {
    throw new SimilarityError('Place at least two matching points on each photo');
  }

  const sourceMean = meanOf(pairs.map((p) => p.source));
  const targetMean = meanOf(pairs.map((p) => p.target));

  // Work in centred coordinates: translation then falls out at the end, and
  // rotation and scale can be solved independently of it.
  let sourceVariance = 0;
  let dot = 0; // sum of source . target
  let cross = 0; // sum of source x target

  for (const { source, target } of pairs) {
    const sx = source.x - sourceMean.x;
    const sy = source.y - sourceMean.y;
    const tx = target.x - targetMean.x;
    const ty = target.y - targetMean.y;

    sourceVariance += sx * sx + sy * sy;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
  }

  if (sourceVariance < 1e-9) {
    throw new SimilarityError('The points on one photo are all in the same place');
  }

  // The complex-number form of the Procrustes solution: (dot + i*cross) over
  // the source variance gives scale and rotation together, as a * cos and
  // a * sin. Deriving them jointly is what keeps the scale uniform.
  const a = dot / sourceVariance;
  const b = cross / sourceVariance;

  return {
    a,
    b,
    c: -b,
    d: a,
    e: targetMean.x - (a * sourceMean.x - b * sourceMean.y),
    f: targetMean.y - (b * sourceMean.x + a * sourceMean.y),
  };
}

/** The uniform scale factor a fitted transform applies. */
export const scaleOf = (m: Matrix2D): number => Math.hypot(m.a, m.b);

/** The rotation a fitted transform applies, in radians. */
export const rotationOf = (m: Matrix2D): number => Math.atan2(m.b, m.a);

/**
 * Root-mean-square residual after applying `transform`, in pixels.
 *
 * Surfaced in the UI: a large residual means the point pairs disagree with each
 * other, which is the one failure a preview cannot show clearly -- the overlay
 * looks plausible while being wrong everywhere by a little.
 */
export function alignmentError(
  pairs: readonly PointPair[],
  transform: Matrix2D,
): number {
  if (pairs.length === 0) return 0;

  let total = 0;
  for (const { source, target } of pairs) {
    const x = transform.a * source.x + transform.c * source.y + transform.e;
    const y = transform.b * source.x + transform.d * source.y + transform.f;
    total += (x - target.x) ** 2 + (y - target.y) ** 2;
  }
  return Math.sqrt(total / pairs.length);
}

/**
 * Fit, then drop the pairs that disagree with the consensus and fit again.
 *
 * With many automatic correspondences, one or two are usually wrong -- the
 * detector slid on a feature the retractors pulled, or found the wrong vertex
 * entirely. Least squares lets a single bad pair bend the whole alignment, so
 * pairs whose residual is far outside the median are discarded and the fit
 * re-run on the rest.
 *
 * Trimming only engages with six or more pairs: below that, "the outlier" and
 * "the fit" are not statistically separable and dropping anything is guessing.
 */
export function robustPairs(pairs: readonly PointPair[]): {
  kept: PointPair[];
  dropped: number;
} {
  if (pairs.length < 6) return { kept: [...pairs], dropped: 0 };

  /*
   * Iterated, because one pass is not enough: a gross outlier bends the first
   * fit so badly that every residual inflates, the median with them, and a
   * second, milder outlier hides inside the loosened threshold. Each round
   * refits on the survivors, so the fit sharpens and previously masked
   * outliers surface. Three rounds settles any realistic case.
   */
  let kept: PointPair[] = [...pairs];
  for (let round = 0; round < 3; round++) {
    const fit = fitSimilarity(kept);
    const residuals = kept.map(({ source, target }) => {
      const x = fit.a * source.x + fit.c * source.y + fit.e;
      const y = fit.b * source.x + fit.d * source.y + fit.f;
      return Math.hypot(x - target.x, y - target.y);
    });

    const median = [...residuals].sort((a, b) => a - b)[
      Math.floor(residuals.length / 2)
    ]!;

    // The absolute floor stops trimming on already-clean data, where every
    // residual is sub-pixel and 3x the median would discard half the points.
    const threshold = Math.max(3 * median, 3);
    const next = kept.filter((_, i) => residuals[i]! <= threshold);

    // Never trim below a safe fit: if most points disagree, the data is bad
    // and hiding that behind aggressive trimming would be lying about it.
    if (next.length < 4 || next.length === kept.length) break;
    kept = next;
  }

  return { kept, dropped: pairs.length - kept.length };
}

/**
 * Seed an alignment from the two images' sizes alone.
 *
 * Used before any points are placed: centres the retracted photo on the smile
 * photo and scales it to fit. Wrong in detail but never absurd, so the operator
 * starts from something recognisable rather than a corner-anchored overlay.
 */
export function seedAlignment(
  source: { width: number; height: number },
  target: { width: number; height: number },
): Matrix2D {
  if (source.width <= 0 || source.height <= 0) return IDENTITY;

  const scale = Math.min(
    target.width / source.width,
    target.height / source.height,
  );

  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: (target.width - source.width * scale) / 2,
    f: (target.height - source.height * scale) / 2,
  };
}

function meanOf(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return vec(x / points.length, y / points.length);
}
