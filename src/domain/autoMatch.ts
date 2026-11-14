/**
 * Sanity limits for an automatic alignment.
 *
 * The correspondences themselves are built in `vision/matchPairs.ts`; this
 * holds the pure quality judgments applied to the fitted result.
 */

import type { Matrix2D } from './geometry.js';
import { scaleOf, type PointPair } from './similarity.js';


/**
 * How far apart the two alignments' scales are, as a ratio.
 *
 * A retracted photo is usually shot closer than the smile photo, so a scale
 * around 0.6-1.6 is ordinary. Far outside that and the detector has almost
 * certainly found the wrong face or the wrong features, and the clinician
 * should place the points by hand rather than trust it.
 */
export const PLAUSIBLE_SCALE = { min: 0.5, max: 2.0 } as const;

export const isPlausibleScale = (scale: number): boolean =>
  scale >= PLAUSIBLE_SCALE.min && scale <= PLAUSIBLE_SCALE.max;

/**
 * Whether an automatic alignment has earned auto-acceptance.
 *
 * Every other step unlocks its successor the moment its exit condition is met;
 * demanding a confirmation click here would make matching the one step with a
 * ritual, and the first live run showed exactly that confusion -- an
 * already-filled button the user still had to press. So a trustworthy
 * alignment confirms itself, and the explicit button remains for the cases
 * where trust is not earned.
 *
 * Three conditions, each with a reason:
 *  - **At least six pairs.** Two hand-placed pairs fit *exactly*, so a tiny
 *    residual proves nothing about a sparse alignment; only the dense
 *    automatic path produces enough redundancy for the residual to mean
 *    something. Manual alignments stay explicit -- placing points by hand is
 *    a deliberate act that ends with a deliberate accept.
 *  - **Plausible scale**, or the detector found the wrong face.
 *  - **Residual under 2.5% of the point spread.** Relative, not absolute:
 *    2.5% of the face span reads as aligned at any photo resolution, where a
 *    fixed pixel threshold would be strict on phone photos and lax on crops.
 */
export function isTrustworthyAlignment(
  pairs: readonly PointPair[],
  transform: Matrix2D,
  error: number,
): boolean {
  if (pairs.length < 6) return false;
  if (!isPlausibleScale(scaleOf(transform))) return false;

  const xs = pairs.map((p) => p.target.x);
  const ys = pairs.map((p) => p.target.y);
  const spread = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  return spread > 0 && error / spread < 0.025;
}
