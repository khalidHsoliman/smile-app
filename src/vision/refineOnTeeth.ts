/**
 * Refining a photo alignment on the teeth themselves.
 *
 * The face-landmark fit is a *coarse* stage. It is optimal at the eyes and the
 * nose, which is not where the design lives: any difference in head pitch
 * between the two shots -- and there always is one, because a patient tilts
 * their chin when retractors go in -- swings the mouth relative to the eyes in
 * the projected image while the eyes barely move. The alignment is therefore
 * least accurate exactly where it matters most.
 *
 * So the teeth get the last word. The maxillary teeth are rigid to the skull,
 * unaffected by jaw position or by the retractors, and clearly visible in both
 * photographs -- which makes them both the ideal registration target and the
 * thing we actually care about lining up.
 *
 * Two stages, not one: correlation needs a good starting point to lock onto the
 * right peak, and the landmark fit provides it. This only ever nudges.
 */

import { bestShift } from '../domain/correlate.js';
import type { Matrix2D, Rect, Vec2 } from '../domain/geometry.js';

export interface Refinement {
  /** Additional translation in smile-photo pixels. */
  dx: number;
  dy: number;
  /** Correlation at the chosen shift, -1 to 1. */
  score: number;
}

/**
 * What the refinement did, or why it did nothing.
 *
 * Reported rather than swallowed. A silent `null` is indistinguishable from a
 * refinement that ran and found nothing to correct, and that ambiguity cost a
 * whole round-trip to diagnose: "still shifted" could have meant the search
 * declined, or locked onto the wrong thing, or corrected nothing. The clinician
 * now sees which.
 */
export type RefineOutcome =
  | { kind: 'refined'; refinement: Refinement }
  | { kind: 'no-teeth' }
  | { kind: 'weak'; score: number }
  | { kind: 'unavailable' };

/**
 * Working resolution for the correlation, in pixels across the mouth.
 *
 * Tooth edges survive heavy downsampling -- they are the highest-contrast
 * feature in the region -- and the search cost is quadratic in both the window
 * size and the shift range, so this is the difference between a snappy refine
 * and a visible stall.
 */
const WORK_WIDTH = 180;

/**
 * How far the refinement may move the alignment, as a share of mouth width.
 *
 * Generous, because the residual it corrects is a pitch difference between two
 * separate shots and that can be several millimetres at the mouth.
 */
const MAX_SHIFT_FRACTION = 0.38;

/**
 * Minimum correlation to accept.
 *
 * Lower than it would need to be for a loose window: with the template
 * restricted to the teeth, a spurious peak has far less to latch onto, so the
 * bar can come down without inviting the lip-boundary false positive that a
 * padded window produced.
 */
const ACCEPT_SCORE = 0.38;

/**
 * Refine `coarse` by correlating the two photos' teeth.
 *
 * Returns null when there is nothing reliable to lock onto -- a closed or
 * shadowed mouth, or a correlation peak too weak to trust -- and the caller
 * keeps the landmark fit rather than applying a guess.
 */
export function refineOnTeeth(
  smileImage: CanvasImageSource,
  retractedImage: CanvasImageSource,
  retractedSize: { width: number; height: number },
  coarse: Matrix2D,
  aperture: readonly Vec2[],
): RefineOutcome {
  if (aperture.length < 3) return { kind: 'unavailable' };

  const box = mouthWindow(aperture);
  if (box.width < 20 || box.height < 10) return { kind: 'unavailable' };

  const scale = WORK_WIDTH / box.width;
  const w = Math.max(8, Math.round(box.width * scale));
  const h = Math.max(8, Math.round(box.height * scale));

  // The smile photo's mouth, in its own pixels.
  const fixed = enamelMap(smileImage, w, h, (ctx) => {
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
  });

  /*
   * The retracted photo warped into smile-photo space by the coarse transform,
   * then cropped to the same window. Rasterising once and searching pure 2D
   * translations is far cheaper than re-warping per candidate shift, and the
   * residual we are hunting -- the pitch-induced offset -- is a translation.
   */
  const moving = enamelMap(retractedImage, w, h, (ctx) => {
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    ctx.transform(coarse.a, coarse.b, coarse.c, coarse.d, coarse.e, coarse.f);
  }, retractedSize);

  if (!fixed || !moving) return { kind: 'unavailable' };

  /*
   * Both windows must actually contain teeth.
   *
   * Score alone cannot tell "the teeth matched" from "something matched": a
   * closed mouth still has a strong lip boundary, and it correlated at 0.44
   * against a tooth edge in testing -- comfortably past a score-only threshold,
   * and it would have shifted a perfectly good alignment. Requiring enamel on
   * both sides asks the question that actually matters.
   */
  if (!hasEnamel(fixed) || !hasEnamel(moving)) return { kind: 'no-teeth' };

  const maxShift = Math.max(6, Math.round(w * MAX_SHIFT_FRACTION));
  const shift = bestShift(fixed, moving, w, h, maxShift);

  // A weak peak means the teeth did not lock -- heavy shadow, a blurred shot.
  // Moving a correct alignment on a guess is worse than leaving it alone.
  if (shift.score < ACCEPT_SCORE) return { kind: 'weak', score: shift.score };

  /*
   * Negated: `bestShift` reports the offset at which the moving image must be
   * *sampled* to match the fixed one, which is the opposite of the translation
   * that brings it into alignment. Returning it unnegated moved the retracted
   * photo exactly twice as far wrong as leaving it alone.
   */
  return {
    kind: 'refined',
    refinement: {
      dx: -shift.dx / scale,
      dy: -shift.dy / scale,
      score: shift.score,
    },
  };
}

/**
 * Whether a window holds enough enamel-bright signal to register on.
 *
 * A few percent is enough -- teeth occupy a modest share of a padded mouth
 * window -- but a region with essentially none is a closed or shadowed mouth,
 * and nothing in it should be allowed to win a correlation search.
 */
function hasEnamel(map: Float32Array): boolean {
  let bright = 0;
  for (let i = 0; i < map.length; i++) if (map[i]! > 120) bright++;
  return bright / map.length > 0.03;
}

/**
 * The template window: the mouth aperture, barely padded.
 *
 * Tight on purpose, and this is the whole difference between a refinement that
 * locks and one that declines. A generously padded window is dominated by lip
 * and skin -- which is exactly what the retractors displace -- so the
 * correlation was being asked to match mostly the thing that moved. The
 * aperture is the *visible teeth* in the smile photo, and those same teeth are
 * present (more fully exposed) in the retracted one, which makes them the only
 * honest template.
 *
 * The retracted view showing more tooth than the template is not a problem:
 * template matching finds a small patch inside a larger scene, and the extra
 * exposed crown simply surrounds the match.
 */
function mouthWindow(aperture: readonly Vec2[]): Rect {
  const xs = aperture.map((p) => p.x);
  const ys = aperture.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const padX = (maxX - minX) * 0.04;
  const padY = (maxY - minY) * 0.10;

  return {
    x: minX - padX,
    y: minY - padY,
    width: maxX - minX + padX * 2,
    height: maxY - minY + padY * 2,
  };
}

/**
 * Rasterise a region and score every pixel for how enamel-like it is.
 *
 * Correlating raw luminance would let the lips -- large, high-contrast, and
 * displaced by the retractors -- dominate the score, which is the failure this
 * whole module exists to avoid. Scoring bright, low-saturation pixels up and
 * saturated ones down leaves the teeth as the dominant structure, so the
 * correlation locks onto the incisal edges and interdental gaps.
 *
 * The same brightness-versus-saturation reasoning as the enamel colour
 * sampler, applied to shape rather than colour.
 */
function enamelMap(
  image: CanvasImageSource,
  w: number,
  h: number,
  setTransform: (ctx: CanvasRenderingContext2D) => void,
  sourceSize?: { width: number; height: number },
): Float32Array | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.save();
  setTransform(ctx);
  if (sourceSize) {
    ctx.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);
  } else {
    ctx.drawImage(image, 0, 0);
  }
  ctx.restore();

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // tainted canvas
  }

  const out = new Float32Array(w * h);
  const data = pixels.data;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 200) {
      out[p] = 0;
      continue;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    out[p] = Math.max(0, luma - 320 * Math.max(0, saturation - 0.12));
  }

  return out;
}
