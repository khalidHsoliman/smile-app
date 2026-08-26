/**
 * Automatic alignment of the retracted photo to the smile photo (spec 15).
 *
 * The retracted photo has cheek retractors in it, which distort the lips and
 * lower face badly -- so the correspondences are taken from features the
 * retractors do not move: the eyes and the nose. Using lip landmarks here would
 * be worse than useless, since they are exactly what the retractors displace.
 *
 * Pure: takes derived references, not raw detector output.
 */

import type { Vec2 } from './geometry.js';
import type { FacialReferences } from './faceFrame.js';
import type { PointPair } from './similarity.js';

/**
 * Build correspondences between two sets of facial references.
 *
 * Four pairs -- both pupils and both nasal wings. Enough for a well-conditioned
 * least-squares fit, spread widely enough across the face that a small error in
 * any one of them does not swing the result, and all above the retractors.
 */
export function autoPointPairs(
  retracted: FacialReferences,
  smile: FacialReferences,
): PointPair[] {
  const features: (keyof FacialReferences)[] = [
    'leftPupil',
    'rightPupil',
    'leftAla',
    'rightAla',
  ];

  const pairs: PointPair[] = [];
  for (const feature of features) {
    const source = retracted[feature] as Vec2 | undefined;
    const target = smile[feature] as Vec2 | undefined;
    if (source && target) pairs.push({ source, target });
  }
  return pairs;
}

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
