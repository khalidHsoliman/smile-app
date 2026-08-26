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

import { matchTemplate } from '../domain/correlate.js';
import { firstEnamelBand, rowProfile } from '../domain/enamelProfile.js';
import type { Matrix2D, Rect, Vec2 } from '../domain/geometry.js';

export interface Refinement {
  /** Additional translation in smile-photo pixels. */
  dx: number;
  dy: number;
  /** Correlation at the chosen shift, -1 to 1. */
  score: number;
  /** True when the incisal edge could not be located and `dy` is zero. */
  verticalIsManual: boolean;
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
 * How far the search area extends beyond the template, as a share of the
 * template's *width*.
 *
 * Measured against width rather than height on purpose: a low smile line makes
 * the template only a few pixels tall, and a proportional margin would leave
 * almost nowhere to search -- exactly when the search is needed most, since a
 * narrow mouth opening is also where a small pitch difference hides the teeth.
 */
const SEARCH_MARGIN_FRACTION = 0.30;

/**
 * Minimum correlation to accept.
 *
 * Modest, because the template is teeth-only: a spurious peak has far less to
 * latch onto than it would in a window padded out with lip and skin, so the bar
 * can come down without inviting the lip-boundary false positive.
 */
const ACCEPT_SCORE = 0.35;

/**
 * Share of the mouth width treated as "the anterior teeth".
 *
 * The centrals and laterals: the teeth reliably visible in both a smile and a
 * retracted view. Wider than this and the profile picks up the canines and
 * premolars, which the lip covers in one photograph and the retractor exposes
 * in the other.
 */
const ANTERIOR_SHARE = 0.5;

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

  const template = mouthWindow(aperture);
  if (template.width < 20 || template.height < 8) return { kind: 'unavailable' };

  const scale = WORK_WIDTH / template.width;
  const tw = Math.max(8, Math.round(template.width * scale));
  const th = Math.max(6, Math.round(template.height * scale));

  /*
   * The search area is the template's region grown on every side.
   *
   * Sized from the *mouth width* rather than the template's own height, because
   * the offset being hunted is a whole-mouth displacement and a low smile line
   * gives a template only a few pixels tall -- padding proportionally would
   * leave nowhere to search. This is the bug that produced "no clear teeth to
   * match on" on a real case: the search window was the same narrow slit as the
   * template, so the retracted photo's lower-sitting mouth simply was not
   * inside it.
   */
  const margin = Math.max(10, Math.round(tw * SEARCH_MARGIN_FRACTION));
  const sw = tw + margin * 2;
  const sh = th + margin * 2;

  // The smile photo's visible teeth: the template.
  const fixed = enamelMap(smileImage, tw, th, (ctx) => {
    ctx.scale(scale, scale);
    ctx.translate(-template.x, -template.y);
  });

  /*
   * The retracted photo warped into smile-photo space by the coarse transform,
   * over the larger search area. Rasterising once and sliding the template is
   * far cheaper than re-warping per candidate position, and the residual being
   * corrected is a translation.
   */
  const search = enamelMap(
    retractedImage,
    sw,
    sh,
    (ctx) => {
      ctx.translate(margin, margin);
      ctx.scale(scale, scale);
      ctx.translate(-template.x, -template.y);
      ctx.transform(coarse.a, coarse.b, coarse.c, coarse.d, coarse.e, coarse.f);
    },
    retractedSize,
  );

  if (!fixed || !search) return { kind: 'unavailable' };

  /*
   * Both sides must actually contain teeth. Score alone cannot tell "the teeth
   * matched" from "something matched": a closed mouth still has a strong lip
   * boundary, and one correlated at 0.44 against a tooth edge in testing.
   */
  /*
   * Different bars, because the two windows are different things. The template
   * *is* the mouth opening, so it should be mostly tooth -- a slack bar there
   * let a closed mouth through in testing. The search area is mostly padding by
   * construction, so real enamel is a small share of it and demanding a
   * mouthful would reject good cases.
   */
  if (!hasEnamel(fixed, 0.1) || !hasEnamel(search, 0.01)) {
    return { kind: 'no-teeth' };
  }

  const found = matchTemplate(fixed, tw, th, search, sw, sh);
  if (found.score < ACCEPT_SCORE) return { kind: 'weak', score: found.score };

  // Sideways: the interdental gaps are effectively a barcode and the template
  // locks onto them, so this correction is trustworthy on its own.
  const dx = (margin - found.x) / scale;

  /*
   * Vertically: the incisal edge, found independently in each photo.
   *
   * Not from the template match. A smile photo shows tooth from the lip line
   * down to the incisal edge while a retracted view shows it from the gum down
   * to the same edge -- different tops, shared bottom -- so a short template
   * slides inside a tall crown and matches nearly as well at many heights.
   * Measured on synthetic pairs, a confident 55% match sat at a constant 38 px
   * offset. Locating the shared boundary in each image instead removes the
   * freedom that caused it.
   *
   * Restricted to the anterior teeth, which are the ones visible in both
   * photographs; the corners bring in the buccal corridor, the retractor and
   * the cheek, none of which correspond.
   */
  const anteriorFrom = tw * (0.5 - ANTERIOR_SHARE / 2);
  const anteriorTo = tw * (0.5 + ANTERIOR_SHARE / 2);

  const templateBand = firstEnamelBand(
    rowProfile(fixed, tw, th, anteriorFrom, anteriorTo),
  );
  const searchBand = firstEnamelBand(
    rowProfile(search, sw, sh, found.x + anteriorFrom, found.x + anteriorTo),
  );

  let dy = 0;
  let verticalIsManual = true;

  if (templateBand && searchBand) {
    /*
     * A perfectly aligned pair puts the template's content at search row
     * `margin + its own row`, so the displacement is the difference between
     * where the edge actually sits and where it would sit if aligned.
     */
    const displacement = searchBand.bottom - (margin + templateBand.bottom);
    dy = -displacement / scale;
    verticalIsManual = false;
  }

  return {
    kind: 'refined',
    refinement: { dx, dy, score: found.score, verticalIsManual },
  };
}

/**
 * Whether a window holds enough enamel-bright signal to register on.
 *
 * The caller sets the bar, because the template and the search area are
 * different shapes of problem.
 *
 * A known limitation, stated rather than papered over: this measures "bright
 * and not very saturated", which skin also is, so it cannot reliably tell a
 * closed mouth from an open one. It catches the clear cases -- deep shadow, a
 * mouth filled with lip -- and lets ambiguous ones through. That is tolerable
 * because the consequence shrank: the vertical is no longer auto-corrected, so
 * the worst a spurious match can now do is shift the design sideways by a few
 * pixels, which is visible and correctable. It would not have been tolerable
 * when this gated a vertical guess.
 */
function hasEnamel(map: Float32Array, fraction: number): boolean {
  let bright = 0;
  for (let i = 0; i < map.length; i++) if (map[i]! > 110) bright++;
  return bright / map.length > fraction;
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
    /*
     * The saturation penalty has to be steep enough to put skin well below
     * enamel, not merely below it. Measured on a real-world pair: skin scored
     * 121 against enamel's 220 at a gentler penalty -- close enough that when
     * the retracted mouth sat lower and skin entered the top of the search
     * window, the incisal-edge search picked the skin as its "first enamel
     * band" and returned an offset wrong by 190 px. At this penalty the same
     * skin scores about 95 against enamel's 218, and gum falls to zero.
     */
    out[p] = Math.max(0, luma - 450 * Math.max(0, saturation - 0.12));
  }

  return out;
}
