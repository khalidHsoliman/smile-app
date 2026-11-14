/**
 * A per-photo starting point for the fit.
 *
 * The fixed defaults assumed an average face, and no face is average: on real
 * photographs the arch started oversized and low, and every case began with
 * the same ritual -- scale down a little, move up, adjust again. But by the
 * time the design step opens we know exactly where the visible mouth is: the
 * detected aperture. So the starting placement is derived from it, and the
 * sliders begin as refinements rather than corrections.
 *
 * **Three of the six parameters are measured; three are not, on purpose.**
 *
 * `scale`, `occlusalGap` and `smileCurve` describe where this mouth is and what
 * shape its opening has. Those are facts about the photograph, and measuring
 * them is strictly better than guessing.
 *
 * `ratio`, `redProportion` and `archWidth` are not facts about the photograph.
 * They are the aesthetic targets the design is *proposing* -- a width:length
 * ratio of 0.80, a recurring proportion of 0.70. Deriving them from the
 * patient's existing teeth would reproduce the proportions they came in with,
 * which is the one thing a smile design must not do: a patient with worn, short
 * centrals would be handed a design with worn, short centrals. They keep their
 * published defaults and the clinician moves them if the case calls for it.
 *
 * **The detected aperture runs generous, and every constant here is calibrated
 * against that rather than against anatomy.** MediaPipe's mouth corners sit at
 * the outer commissure rather than at the edge of the visible opening, and its
 * lower-lip contour sits on the wet line, below the lip's visible upper border.
 * So the ring is wider and deeper than the hole the teeth show through -- which
 * biases the width high and the depth high, and those are exactly the two
 * measurements this module divides by. Textbook ratios applied to it produce an
 * arch that is too big and sits too low, which is precisely the pair of
 * corrections a clinician was making by hand on every case.
 *
 * Pure: no React, no store, no DOM.
 */

import type { FaceFrame, FacialReferences } from './faceFrame.js';
import { worldToFaceMatrix } from './faceFrame.js';
import { applyMatrix, type Vec2 } from './geometry.js';
import {
  CENTRAL_WIDTH_IN_FACE_UNITS,
  CURVE_SCALE,
  DEFAULT_INCISAL_DROP,
  OCCLUSAL_GAP_SCALE,
} from './fitting.js';

/**
 * How much of the aperture width the anterior six should span.
 *
 * Not most of it: the aperture runs corner to corner of the smile, and the
 * canines sit at the *inter-canine* width -- roughly 60-65% of that, with the
 * premolars, molars and buccal corridors filling the outer thirds. An early
 * value of 0.94 came from eyeballing a synthetic face whose mouth was drawn
 * far too wide for its nose; against real anatomy it would have oversized
 * every arch, which is precisely the complaint this module exists to fix.
 *
 * Below the textbook 60-65% because the number it multiplies is not the
 * textbook one. Inter-canine as a share of inter-commissural is measured
 * between real anatomical landmarks; this is measured between detected ones,
 * and the detector's corners sit outside the visible opening. Calibrated to the
 * ratio that lands the arch on the teeth, not to the ratio in the literature.
 */
const SPAN_OF_APERTURE = 0.58;

/*
 * There is no anatomical prior blended in here, and there was.
 *
 * Scale 1.0 is a prediction by construction -- the frame's unit is the
 * inter-alar width and `CENTRAL_WIDTH_IN_FACE_UNITS` encodes 8.5 mm of central
 * against 34 mm of nose -- so blending the measurement halfway toward it looked
 * like variance reduction and was reasoned out at length. On real photographs
 * it made the arch visibly too big, every time, and the reason is that the
 * prior is not merely noisy but biased: nose width and tooth width correlate
 * only loosely, and a population average pulls every patient toward the same
 * answer whether or not it is theirs.
 *
 * The aperture is at least measuring this mouth. Averaging a measurement with a
 * guess is only worth doing when the guess is unbiased, and a clinician
 * correcting the same slider in the same direction on every case is the
 * evidence that it is not.
 */

/**
 * Where the central incisal edge should sit, as a fraction of the aperture's
 * depth below the lip line. Upper teeth dominate a natural smile: they show
 * for roughly the upper two thirds of the opening, with the lower teeth and
 * the dark of the mouth below.
 *
 * Two thirds is what a photograph shows; this sits under it because the depth
 * it scales is measured to the detector's lower-lip contour, which follows the
 * wet line rather than the visible top of the lip. Every millimetre of that
 * overshoot becomes a millimetre of arch hung too low.
 *
 * Bracketed rather than reasoned. At 0.72 the arch sat too low on real
 * photographs and was moved up on every case; at 0.62 it sat too high and was
 * moved down. Two observations either side is worth more than any amount of
 * argument about where the detector's contour really falls, so this is the
 * midpoint of them.
 */
const DROP_OF_APERTURE = 0.67;

/**
 * How much of the lower lip's curvature `smileCurve` is asked to supply.
 *
 * Nearly all of it. A *consonant* smile runs the incisal curve parallel to the
 * lower lip, and that is the aesthetic target; a tenth is held back only so the
 * design does not literally meet the lip at the commissures.
 *
 * It was half, on the reasoning that the template's gull-wing already lifts the
 * corners and matching the lip outright would count that twice. Checking the
 * template rather than assuming: the gull-wing raises the *lateral* by 0.09 of
 * a crown width and returns the canine to 0.01 -- which is to say, to the
 * central's own level. It lifts the canine by nothing at all.
 *
 * So the argument was sound everywhere except at the one tooth it mattered
 * for. The canine sits furthest out, where the lower lip has risen most, and it
 * had only half the lift it needed: measured on a synthetic smile it ends up
 * the tightest tooth in the arch, 1.87mm from the lip against the central's
 * 2.50mm, and on a real photograph it crossed the lip and was clipped. At 0.9
 * it clears by 2.47mm while the central barely moves -- which is the shape of
 * correction wanted, since the midline was never the problem.
 */
const LIP_CONSONANCE = 0.9;

/**
 * Bounds on the *derived* smile curve, tighter than the slider's own -5..+5.
 *
 * The slider's full range is there for deliberate clinical choices, including
 * the reverse curve. A measurement is not a choice: a bad lip detection that
 * produced -5 would open the design step on the reverse smile curve, the
 * most common aesthetic error, with nothing on screen to say it was guessed.
 * Inside these bounds a poor measurement is merely unremarkable.
 *
 * The ceiling was 3, chosen as the value that lifts a canine tip about 0.8mm
 * above the central edge -- the middle of the usual clinical range. It was
 * measured at scale 1.0, and at the smaller scales the aperture actually
 * produces the same setting lifts the canine less, because the lift goes as the
 * square of the distance from the midline. A real lip wanted 3.46 and got 3.
 */
const CURVE_BOUNDS = { min: 0, max: 4.5 } as const;

export interface SuggestedParams {
  scale: number;
  occlusalGap: number;
  smileCurve: number;
}

/**
 * Derive the placement parameters from the mouth aperture.
 *
 * Returns null when there is no usable aperture -- hand-placed references have
 * none -- and the caller keeps the fixed defaults.
 */
export function suggestFitParams(
  refs: FacialReferences,
  frame: FaceFrame,
): SuggestedParams | null {
  const aperture = refs.mouthAperture;
  if (!aperture || aperture.length < 3) return null;

  // The aperture in face units, where the fit itself operates: x spans the
  // smile, y grows downward from the lip line at the origin.
  const toFace = worldToFaceMatrix(frame);
  const points = aperture.map((p) => applyMatrix(toFace, p));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...ys);

  // A degenerate aperture -- closed mouth, detector failure -- must not
  // produce a microscopic arch. Below these bounds the data is not a smile.
  if (width < 0.3 || depth < 0.04) return null;

  // Anterior span in face units is ANTERIOR_SIX_WIDTH * centralWidth * scale;
  // solve for the scale that makes it SPAN_OF_APERTURE of the measured width.
  const scale =
    (width * SPAN_OF_APERTURE) /
    (ANTERIOR_SIX_WIDTH * CENTRAL_WIDTH_IN_FACE_UNITS);

  // The fitter already drops the edge DEFAULT_INCISAL_DROP below the lip line;
  // occlusalGap covers the difference to the aperture-derived target.
  const targetDrop = depth * DROP_OF_APERTURE;
  const occlusalGap = (targetDrop - DEFAULT_INCISAL_DROP) / OCCLUSAL_GAP_SCALE;

  return {
    scale: clamp(round2(scale), 0.1, 4),
    occlusalGap: clamp(Math.round(occlusalGap), -100, 100),
    smileCurve: suggestSmileCurve(points, width),
  };
}

/**
 * The smile arc, read off the lower lip.
 *
 * The one rule of the incisal curve is that it should follow the upper border
 * of the lower lip, and that border is the bottom half of the aperture ring --
 * already detected, already in the right coordinate system. Fitting a parabola
 * to it and matching curvature turns the most-adjusted slider into one the
 * clinician usually does not have to touch.
 *
 * Falls back to the published default rather than to zero when the lip cannot
 * be read: a flat incisal edge is a specific aesthetic failure, not a neutral
 * starting point.
 */
function suggestSmileCurve(points: readonly Vec2[], width: number): number {
  const lip = lowerBoundary(points);

  // Only the anterior stretch. Beyond the canines the lip turns up sharply into
  // the commissures, and a parabola fitted through the corners is dominated by
  // them -- it would report a far deeper curve than the teeth should follow.
  const half = (width * SPAN_OF_APERTURE) / 2;
  const anterior = lip.filter((p) => Math.abs(p.x) <= half);
  if (anterior.length < 3) return DEFAULT_SMILE_CURVE;

  const b = fitQuadratic(anterior);
  if (b === null) return DEFAULT_SMILE_CURVE;

  /*
   * The upper arch's incisal edge is y = rest - smileCurve * CURVE_SCALE * x^2,
   * so matching its curvature to the lip's y = a + b*x^2 gives
   * smileCurve = -b / CURVE_SCALE. The lip rises toward the corners, so b is
   * negative on a normal smile and the result is positive -- which is the sign
   * convention the fitter uses for "corners ride higher".
   */
  const curve = (-b / CURVE_SCALE) * LIP_CONSONANCE;
  return clamp(round2(curve), CURVE_BOUNDS.min, CURVE_BOUNDS.max);
}

/**
 * The lower half of a closed ring.
 *
 * Split at the leftmost and rightmost points -- the commissures on a mouth --
 * which cuts the ring into an upper chain and a lower one; the chain with the
 * greater mean y is the lower. Done from the geometry rather than from the
 * order the detector happens to emit points in, because the references are
 * editable and a hand-adjusted ring carries no such guarantee.
 */
function lowerBoundary(points: readonly Vec2[]): Vec2[] {
  let leftmost = 0;
  let rightmost = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.x < points[leftmost]!.x) leftmost = i;
    if (points[i]!.x > points[rightmost]!.x) rightmost = i;
  }
  if (leftmost === rightmost) return [];

  const from = Math.min(leftmost, rightmost);
  const to = Math.max(leftmost, rightmost);
  const between = points.slice(from, to + 1);
  const around = [...points.slice(to), ...points.slice(0, from + 1)];

  return meanY(between) > meanY(around) ? between : around;
}

const meanY = (points: readonly Vec2[]): number =>
  points.length === 0
    ? -Infinity
    : points.reduce((sum, p) => sum + p.y, 0) / points.length;

/**
 * Least squares fit of `y = a + b*x^2`, returning `b`.
 *
 * Only the quadratic term is wanted -- `a` is the lip's height, which the
 * occlusal gap already handles -- but it has to be fitted alongside rather than
 * assumed, or the curvature absorbs the offset and comes out wildly wrong.
 *
 * Null when the points are too bunched in x to determine a curve.
 */
function fitQuadratic(points: readonly Vec2[]): number | null {
  const n = points.length;
  let sumU = 0;
  let sumUU = 0;
  let sumY = 0;
  let sumUY = 0;

  // Substituting u = x^2 makes this an ordinary linear regression of y on u.
  for (const p of points) {
    const u = p.x * p.x;
    sumU += u;
    sumUU += u * u;
    sumY += p.y;
    sumUY += u * p.y;
  }

  const denominator = n * sumUU - sumU * sumU;
  if (Math.abs(denominator) < 1e-9) return null;

  return (n * sumUY - sumU * sumY) / denominator;
}

/**
 * The anterior six's combined width in central-incisor units at the default
 * RED proportion of 0.70: two of each of central (1.0), lateral (0.70) and
 * canine (0.49).
 */
const ANTERIOR_SIX_WIDTH = 2 * (1 + 0.7 + 0.49);

/** Matches `DEFAULT_PARAMS.smileCurve`; duplicated to keep this layer pure. */
const DEFAULT_SMILE_CURVE = 1.0;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;
