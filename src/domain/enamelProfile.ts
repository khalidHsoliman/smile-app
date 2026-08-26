/**
 * Locating the upper incisal edge from a row profile.
 *
 * The vertical half of photo alignment has one honest anchor: the biting edge
 * of the upper front teeth. It is the same anatomical line in both photographs,
 * and it is the line the design is placed against anyway.
 *
 * Everything else about the tooth region differs between the two shots. A smile
 * photo shows tooth from the lip line down to the incisal edge; a retracted view
 * shows it from the gum down to the same edge. Different tops, shared bottom --
 * which is why matching whole bands slid (a short template fits a tall crown at
 * many heights) and why matching the bottom does not.
 *
 * Row profiles rather than per-column tracing. An earlier attempt walked each
 * column looking for where enamel ended and was unstable wherever the arches
 * met without a clear gap: one noisy column produced a wild answer. Averaging
 * across the anterior teeth first turns a thin inter-arch boundary into a
 * shallow but reliable dip in a single curve.
 *
 * Pure numerics.
 */

export interface Band {
  /** First row of the band. */
  top: number;
  /** Last row of the band -- the incisal edge for the first band found. */
  bottom: number;
  /** Mean enamel value across the band, for confidence. */
  strength: number;
}

/**
 * Average enamel value per row, over a horizontal slice of the map.
 *
 * `fromX`/`toX` restrict to the anterior teeth: they are the teeth visible in
 * both photographs, and including the corners drags in the buccal corridor,
 * the retractor and the cheek, none of which correspond between the shots.
 */
export function rowProfile(
  map: Float32Array,
  width: number,
  height: number,
  fromX: number,
  toX: number,
): Float32Array {
  const x0 = Math.max(0, Math.floor(fromX));
  const x1 = Math.min(width, Math.ceil(toX));
  const n = Math.max(1, x1 - x0);
  const profile = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += map[y * width + x]!;
    profile[y] = sum / n;
  }

  return profile;
}

/**
 * The first (topmost) run of enamel-bright rows.
 *
 * "First" is what separates the upper arch from the lower one in a retracted
 * view, where the profile runs gum, upper teeth, a dip at the bite, lower
 * teeth, lip. Taking the strongest or the last band would find the lower arch;
 * taking the first finds the teeth the design replaces.
 *
 * The threshold is relative to the profile's own peak, so it holds across
 * exposures without a tuned absolute value. Set high enough that skin cannot
 * qualify: skin is bright and only moderately saturated, and at a gentler
 * threshold it was selected as the first band whenever it entered the top of
 * the search window -- which is exactly when the retracted mouth sits lower,
 * the case the vertical correction exists for.
 */
export function firstEnamelBand(
  profile: Float32Array,
  relativeThreshold = 0.65,
  minRows = 3,
): Band | null {
  let peak = 0;
  for (let i = 0; i < profile.length; i++) peak = Math.max(peak, profile[i]!);
  if (peak <= 0) return null;

  const threshold = peak * relativeThreshold;

  let top = -1;
  for (let y = 0; y < profile.length; y++) {
    const lit = profile[y]! >= threshold;

    if (lit && top < 0) {
      top = y;
      continue;
    }
    if (!lit && top >= 0) {
      const bottom = y - 1;
      if (bottom - top + 1 >= minRows) {
        return { top, bottom, strength: mean(profile, top, bottom) / peak };
      }
      // Too thin to be a tooth band -- a highlight or noise. Keep looking.
      top = -1;
    }
  }

  // A band running to the bottom of the window has no lower boundary inside
  // what was sampled, so its edge cannot be located.
  return null;
}

function mean(profile: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let y = from; y <= to; y++) sum += profile[y]!;
  return sum / Math.max(1, to - from + 1);
}
