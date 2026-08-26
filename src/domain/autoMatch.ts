/**
 * Sanity limits for an automatic alignment (spec 15).
 *
 * The correspondences themselves are built in `vision/matchPairs.ts`; this
 * holds the pure plausibility check the UI applies to the fitted result.
 */


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
