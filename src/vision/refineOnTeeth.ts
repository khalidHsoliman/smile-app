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
import { alignProfiles, fallingEdges, rowProfile } from '../domain/enamelProfile.js';
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
 * Minimum correlation between the two edge profiles to trust the vertical.
 *
 * Separate from `ACCEPT_SCORE`, and separately reported: the sideways match and
 * the vertical one are different measurements on different data, and either can
 * succeed while the other has nothing to work with. A low smile line gives a
 * strong sideways lock on the interdental barcode and almost no vertical
 * structure at all, and saying so is better than inventing a number.
 */
const ACCEPT_VERTICAL = 0.4;

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
  if (!hasEnamel(fixed) || !hasEnamel(search)) return { kind: 'no-teeth' };

  const found = matchTemplate(fixed, tw, th, search, sw, sh);
  if (found.score < ACCEPT_SCORE) return { kind: 'weak', score: found.score };

  // Sideways: the interdental gaps are effectively a barcode and the template
  // locks onto them, so this correction is trustworthy on its own.
  const dx = (margin - found.x) / scale;

  /*
   * Vertically: correlate the two photographs' falling edges.
   *
   * Not from the 2-D template match. A smile photo shows tooth from the lip
   * line down to the incisal edge while a retracted view shows it from the gum
   * down to the same edge -- different tops, shared bottom -- so a short
   * template slides inside a tall crown and matches nearly as well at many
   * heights. Measured on synthetic pairs, a confident 55% match sat at a
   * constant 38 px offset.
   *
   * Differentiating each row profile and keeping only the falling edges leaves
   * just what the two shots have in common: incisal edges, where enamel gives
   * way to shadow. The lip line and the gum line are rising edges and drop out
   * -- which is precisely the freedom that let the 2-D match slide.
   *
   * Restricted to the anterior teeth, which are the ones visible in both
   * photographs; the corners bring in the buccal corridor, the retractor and
   * the cheek, none of which correspond.
   */
  const anteriorFrom = tw * (0.5 - ANTERIOR_SHARE / 2);
  const anteriorTo = tw * (0.5 + ANTERIOR_SHARE / 2);

  const templateEdges = fallingEdges(
    rowProfile(fixed, tw, th, anteriorFrom, anteriorTo),
  );
  const searchEdges = fallingEdges(
    rowProfile(search, sw, sh, found.x + anteriorFrom, found.x + anteriorTo),
  );

  /*
   * A perfectly aligned pair puts the template's first row at search row
   * `margin`, so the alignment is measured from there and a shift of zero means
   * the landmark fit already had the vertical right.
   */
  const vertical = alignProfiles(templateEdges, searchEdges, margin, margin);

  let dy = 0;
  let verticalIsManual = true;

  if (vertical && vertical.score >= ACCEPT_VERTICAL) {
    dy = -vertical.shift / scale;
    verticalIsManual = false;
  }

  return {
    kind: 'refined',
    refinement: { dx, dy, score: found.score, verticalIsManual },
  };
}

/**
 * Whether a window holds teeth.
 *
 * Keyed on *contrast* rather than an absolute brightness, because enamel shade
 * varies enormously -- a bleached tooth and a deeply yellowed one are far
 * apart on any fixed scale, and a threshold that admits both also admits skin.
 * What every mouth with teeth has in common is that the teeth are markedly
 * brighter than the gum, lip and cavity around them; a closed mouth is
 * comparatively uniform. Comparing a window's top decile against its own
 * median asks that question directly and is indifferent to shade.
 */
function hasEnamel(map: Float32Array): boolean {
  if (map.length < 16) return false;

  const sorted = Float32Array.from(map).sort();
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p90 = sorted[Math.floor(sorted.length * 0.9)]!;

  /*
   * A ratio, not a difference. The absolute numbers move with the weighting and
   * with the shade; what holds across every mouth is that the bright decile
   * stands well clear of the median. An absolute gap of 25 failed a real case
   * by 0.1 of a unit -- the kind of margin that means the test was measuring
   * the wrong thing.
   */
  return p90 >= 60 && (p50 <= 5 || p90 >= p50 * 1.35);
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
    /*
     * Redness, not saturation, is what separates enamel from everything around
     * it. Skin, gum and lip are red-dominant -- red well above green -- while a
     * tooth is yellow-dominant, with red and green close together and blue
     * lower. Saturation cannot make that distinction: a yellowed tooth and
     * light skin are both bright and moderately saturated, and under a penalty
     * steep enough to reject skin, light skin actually outranked yellowed
     * enamel (130 against 106). That inversion is why a patient with yellow
     * teeth and a low smile line reported "no clear teeth to match on".
     *
     * Measured across shades: white enamel 218, ivory 200, yellowed 156, deep
     * yellow 137 -- against light skin 85, a yellow-toned skin 116, tanned skin
     * 26, and gum, lip and oral cavity at zero. The margin at the difficult end
     * matters most: an earlier weighting put deep-yellow enamel at 87 and light
     * skin at 83, four points apart, and a patient with yellowed teeth and a
     * low smile line was told there were "no clear teeth to match on".
     */
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    // Skin, gum and lip are orange: red well above green. A tooth is yellow:
    // red and green close, both well above blue. Penalising the first and
    // rewarding the second separates them where brightness alone cannot.
    const redness = r - g;
    const yellowness = Math.max(0, g - b);
    out[p] = Math.max(0, luma - 4 * redness + yellowness);
  }

  return out;
}
