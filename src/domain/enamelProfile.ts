/**
 * Aligning two photographs vertically on the teeth themselves.
 *
 * The vertical half of photo alignment has one honest anchor: the biting edge
 * of the upper front teeth. It is the same anatomical line in both photographs,
 * and it is the line the design is placed against anyway.
 *
 * Everything else about the tooth region differs between the two shots. A smile
 * photo shows tooth from the lip line down to the incisal edge; a retracted
 * view shows it from the gum down to the same edge. Different tops, shared
 * bottom -- which is why matching whole bands slid (a short template fits a
 * tall crown at many heights) and why matching the bottom does not.
 *
 * Row profiles rather than per-column tracing. An earlier attempt walked each
 * column looking for where enamel ended and was unstable wherever the arches
 * met without a clear gap: one noisy column produced a wild answer. Averaging
 * across the anterior teeth first turns a thin inter-arch boundary into a
 * shallow but reliable feature in a single curve.
 *
 * **Falling edges, correlated -- not a band found in each image separately.**
 * That is the important part, and it replaced a version that looked for where
 * the first run of enamel-bright rows ended. Two reasons it had to go.
 *
 * It assumed the profile drops decisively between the arches. On an open bite
 * it does; on a bite closed to near edge-to-edge it barely dips at all, and the
 * "first band" then ran straight through the bite and returned the *lower*
 * arch's incisal edge -- a whole crown's worth of error, reported with full
 * confidence because a band had been found.
 *
 * And finding a landmark separately in each image throws away the fact that the
 * two images are the same mouth. Differentiating the profile and keeping only
 * the *falling* edges leaves exactly the features the photographs share: the
 * incisal edges, where enamel gives way to shadow. The features they do not
 * share -- the lip line in one, the gum line in the other -- are rising edges,
 * and drop out. Correlating what is left matches the whole pattern rather than
 * one landmark, and a shallow inter-arch dip still contributes a bump in both
 * images at the same place, whatever its depth.
 *
 * Pure numerics.
 */

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
 * The downward-facing edges in a profile: enamel giving way to shadow.
 *
 * A central difference, rectified. Rows run down the image, so a *falling*
 * profile means the value at the row below is lower -- an incisal edge, the
 * bottom of a crown. Rising edges are discarded rather than taken as absolute
 * values, and that asymmetry is the whole point: the rising edges are the lip
 * line and the gum line, the two features the photographs do *not* share.
 *
 * Smoothed first, because the derivative of a noisy curve is noise.
 */
export function fallingEdges(profile: Float32Array, smoothing = 2): Float32Array {
  const smoothed = boxSmooth(profile, smoothing);
  const edges = new Float32Array(profile.length);

  for (let y = 1; y < profile.length - 1; y++) {
    const slope = smoothed[y - 1]! - smoothed[y + 1]!;
    edges[y] = slope > 0 ? slope : 0;
  }

  return edges;
}

export interface ProfileAlignment {
  /** Rows the search content sits below where `offset` predicted. Fractional. */
  shift: number;
  /** Correlation at that shift, -1 to 1. */
  score: number;
}

/**
 * The vertical shift that best lines `template` up inside `search`.
 *
 * `offset` is where the template's first row would sit if the coarse alignment
 * were already perfect, and the result is measured from there -- so a shift of
 * zero means the landmark fit needed no vertical correction. Bounded by
 * `maxShift`, because this stage only ever nudges: an unbounded search can and
 * did jump a whole arch.
 *
 * Zero-mean normalised correlation, so it compares the *shape* of the two edge
 * patterns rather than their strength. The two photographs are differently
 * exposed and the retracted one shows more crown, so the absolute size of the
 * gradients carries no information worth keeping.
 */
export function alignProfiles(
  template: Float32Array,
  search: Float32Array,
  offset: number,
  maxShift: number,
): ProfileAlignment | null {
  let best: ProfileAlignment | null = null;
  const scores = new Map<number, number>();

  for (let shift = -maxShift; shift <= maxShift; shift++) {
    const score = correlateAt(template, search, offset + shift);
    if (score === null) continue;
    scores.set(shift, score);
    if (best === null || score > best.score) best = { shift, score };
  }

  if (best === null) return null;

  /*
   * Sub-row precision, from the shape of the peak rather than its position.
   *
   * The true alignment almost never falls on a whole row, and rounding it to
   * one is a systematic error of up to half a row -- which at working
   * resolution is a real fraction of a millimetre on the face, for nothing. A
   * correlation peak is locally parabolic, so the three scores either side of
   * the best give the fractional position of its apex in closed form.
   */
  const before = scores.get(best.shift - 1);
  const after = scores.get(best.shift + 1);
  if (before === undefined || after === undefined) return best;

  const curvature = before - 2 * best.score + after;
  // A flat or upward-curving neighbourhood is not a peak; leave it alone.
  if (curvature >= 0) return best;

  const adjustment = (0.5 * (before - after)) / curvature;
  // Beyond half a row the parabola is not describing this peak any more.
  if (Math.abs(adjustment) > 0.5) return best;

  return { shift: best.shift + adjustment, score: best.score };
}

/**
 * Correlation of `template` against `search` with the template's row 0 laid at
 * `at`. Null when too little of the template lands inside the search window to
 * mean anything.
 */
function correlateAt(
  template: Float32Array,
  search: Float32Array,
  at: number,
): number | null {
  const from = Math.max(0, -at);
  const to = Math.min(template.length, search.length - at);
  const n = to - from;

  // Enough overlap to be a comparison rather than a coincidence. A sliver of
  // two curves can be made to correlate at almost anything.
  if (n < 8 || n < template.length * MIN_OVERLAP) return null;

  let sumA = 0;
  let sumB = 0;
  for (let i = from; i < to; i++) {
    sumA += template[i]!;
    sumB += search[i + at]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = from; i < to; i++) {
    const a = template[i]! - meanA;
    const b = search[i + at]! - meanB;
    covariance += a * b;
    varianceA += a * a;
    varianceB += b * b;
  }

  const denominator = Math.sqrt(varianceA * varianceB);
  // A flat profile has no shape to match, so no shift is better than any other.
  return denominator < 1e-9 ? null : covariance / denominator;
}

/** How much of the template must land inside the search window. */
const MIN_OVERLAP = 0.6;

/** Moving average over `2 * radius + 1` rows, clamped at the ends. */
function boxSmooth(profile: Float32Array, radius: number): Float32Array {
  if (radius < 1) return profile;

  const out = new Float32Array(profile.length);
  for (let y = 0; y < profile.length; y++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = y + k;
      if (j < 0 || j >= profile.length) continue;
      sum += profile[j]!;
      count++;
    }
    out[y] = sum / Math.max(1, count);
  }
  return out;
}
