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
 * right peak, and the landmark fit provides it.
 *
 * **Scale as well as position.** For a long time this stage returned a
 * translation and nothing else, on the assumption that the landmark fit already
 * had the size right. It does not, and cannot: a retracted photograph is
 * normally taken closer than a smile photograph, and moving the camera in is
 * not a similarity -- the face's periphery expands relative to its centre. A
 * similarity fitted on the eyes and the nose then absorbs that into a scale
 * that is right for the upper face and wrong at the mouth, and no translation
 * whatever can repair it. The symptom is unmistakable once you know it: the
 * overlay cannot be made to line up by dragging, at any position, because the
 * teeth are simply the wrong size.
 *
 * **And on how they are tilted.** The landmarks the coarse similarity is fitted
 * on are all in the upper face -- eye corners, the nose midline chain, the alae
 * -- and most of them lie almost on the midline itself, so the roll comes from
 * only a handful of off-axis points. Their centroid sits between the eyes,
 * well over a hundred pixels above the mouth, and that distance is a lever: a
 * roll error too small to see at the eyes arrives at the teeth multiplied by
 * it. Half a degree tilts the anterior incisal edge by 2.6 px across a 300 px
 * mouth and leaves 0.92 px that no scale or shift can take out; two degrees
 * leaves 3.59 px.
 *
 * Worth contrasting with the one that was *not* worth correcting. A chin tilt
 * between the shots foreshortens the mouth vertically, which looks like the
 * same kind of problem and is not: the anterior incisal edges are nearly
 * collinear, so a vertical scale barely moves them and a uniform scale with a
 * vertical shift absorbs almost all of it. Even a 12% vertical error leaves
 * 0.62 px. Rotation earns its axis; anisotropy does not.
 *
 * So the teeth get the last word on size and tilt, not just on position.
 */

import { matchTemplate } from '../domain/correlate.js';
import { alignProfiles, fallingEdges, rowProfile } from '../domain/enamelProfile.js';
import {
  compose,
  translation,
  vec,
  type Matrix2D,
  type Rect,
  type Vec2,
} from '../domain/geometry.js';

export interface Refinement {
  /**
   * The correction, in smile-photo space, to apply *after* the coarse fit.
   *
   * A matrix rather than a pair of offsets, because the correction now carries
   * a scale about the mouth as well as a translation. Returned already composed
   * so the one place that knows how the images were rasterised is also the one
   * place that turns that into geometry -- this is where the sign errors live.
   */
  correction: Matrix2D;
  /** The scale it applied to the mouth region. 1 means the coarse fit had it. */
  zoom: number;
  /** The roll it corrected, in degrees. 0 means the coarse fit had it. */
  rotation: number;
  /** How far the mouth moved, in smile-photo pixels. */
  moved: number;
  /** Correlation at the chosen shift, -1 to 1. */
  score: number;
  /** True when the biting edge could not be located and the height is unchanged. */
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
 * Working width for the scale search, in pixels across the mouth.
 *
 * Half the resolution of the final pass, because the search is run once per
 * candidate scale and correlation cost is quadratic in the window. Finding
 * *which* scale fits does not need the detail that measuring the final offset
 * does -- at this width the whole sweep costs less than one full-resolution
 * pass, which is the difference between a scale search and a stall.
 */
const SCAN_WIDTH = 90;

/** Shift stride during the scale sweep. Same reasoning as `SCAN_WIDTH`. */
const SCAN_STEP = 3;

/**
 * How far the mouth's scale may be corrected, and how finely.
 *
 * Twenty percent is generous for the effect being corrected -- the difference
 * between a portrait distance and a close retracted shot -- and it is bounded
 * because an unbounded scale search will happily shrink the template until it
 * matches a patch of uniform enamel at a great score and no meaning.
 *
 * The sweep is coarse then fine: a pass at 5% steps to find the neighbourhood,
 * then 1.25% steps around the winner. A step of 1.25% is about a tenth of a
 * millimetre on a central incisor, which is past the point where the rest of
 * the pipeline can tell the difference.
 */
const ZOOM_RANGE = 0.2;
const ZOOM_COARSE_STEP = 0.05;
const ZOOM_FINE_STEP = 0.0125;

/**
 * How far the mouth's roll may be corrected, and how finely, in degrees.
 *
 * Five degrees is far more than the error being corrected -- this is the
 * residual left after a landmark fit, not the head tilt itself -- but the sweep
 * is cheap and a bound that cannot be reached is not a bound. The fine step of
 * a third of a degree leaves under 2 px of tilt across a wide mouth, which is
 * past what the rest of the pipeline resolves.
 */
const ANGLE_RANGE = 5;
const ANGLE_COARSE_STEP = 1.25;
const ANGLE_FINE_STEP = 0.3125;

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

  /*
   * The mouth's centre, and the point the scale correction turns about.
   *
   * Correcting scale about the mouth rather than about the image origin is what
   * keeps this a refinement. Zooming about the centre of the region being
   * matched leaves that centre where the landmark fit put it and changes only
   * the size of what surrounds it, so the scale and the translation stay
   * independent and each measures one thing.
   */
  const centre = vec(
    template.x + template.width / 2,
    template.y + template.height / 2,
  );

  /** The smile photo's visible teeth, at a given working width: the template. */
  const templateMap = (plan: Plan) =>
    enamelMap(smileImage, plan.tw, plan.th, (ctx) => {
      ctx.scale(plan.workScale, plan.workScale);
      ctx.translate(-template.x, -template.y);
    });

  /*
   * The retracted photo warped into smile-photo space by the coarse transform
   * and then scaled by `zoom` about the mouth, over the larger search area.
   * Rasterising once per candidate and sliding the template is far cheaper than
   * re-warping per position, and the residual left after the zoom is a
   * translation.
   */
  const searchMap = (plan: Plan, zoom: number, degrees: number) =>
    enamelMap(
      retractedImage,
      plan.sw,
      plan.sh,
      (ctx) => {
        ctx.translate(plan.margin, plan.margin);
        ctx.scale(plan.workScale, plan.workScale);
        ctx.translate(-template.x, -template.y);
        ctx.translate(centre.x, centre.y);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.scale(zoom, zoom);
        ctx.translate(-centre.x, -centre.y);
        ctx.transform(coarse.a, coarse.b, coarse.c, coarse.d, coarse.e, coarse.f);
      },
      retractedSize,
    );

  // ---------------------------------------------------------------- the scale
  const scan = planFor(SCAN_WIDTH, template);
  const scanFixed = templateMap(scan);
  if (!scanFixed) return { kind: 'unavailable' };

  /*
   * Both sides must actually contain teeth. Score alone cannot tell "the teeth
   * matched" from "something matched": a closed mouth still has a strong lip
   * boundary, and one correlated at 0.44 against a tooth edge in testing.
   *
   * Different bars, because the two windows are different things. The template
   * *is* the mouth opening, so it should be mostly tooth -- a slack bar there
   * let a closed mouth through in testing. The search area is mostly padding by
   * construction, so real enamel is a small share of it and demanding a
   * mouthful would reject good cases.
   */
  if (!hasEnamel(scanFixed)) return { kind: 'no-teeth' };

  const scoreAt = (zoom: number, degrees: number): number => {
    const map = searchMap(scan, zoom, degrees);
    if (!map || !hasEnamel(map)) return -Infinity;
    return matchTemplate(
      scanFixed,
      scan.tw,
      scan.th,
      map,
      scan.sw,
      scan.sh,
      SCAN_STEP,
    ).score;
  };

  /*
   * Scale and roll are searched by alternation rather than as a grid.
   *
   * A full two-dimensional sweep of both at this resolution would be nine times
   * the passes for an answer barely different: over the small residuals being
   * corrected the two are close to independent, since scaling a mouth about its
   * own centre and rotating it about the same point disturb different things
   * about the correlation. Alternating coarse and fine passes over each -- four
   * sweeps rather than a grid -- converges on the same place for a fraction of
   * the work.
   */
  let zoom = bestOf(sweep(1, ZOOM_RANGE, ZOOM_COARSE_STEP), (z) => scoreAt(z, 0));
  if (zoom === null) return { kind: 'no-teeth' };

  let degrees =
    bestOf(sweep(0, ANGLE_RANGE, ANGLE_COARSE_STEP), (d) => scoreAt(zoom!, d)) ?? 0;
  zoom =
    bestOf(sweep(zoom, ZOOM_COARSE_STEP, ZOOM_FINE_STEP), (z) => scoreAt(z, degrees)) ??
    zoom;
  degrees =
    bestOf(sweep(degrees, ANGLE_COARSE_STEP, ANGLE_FINE_STEP), (d) => scoreAt(zoom!, d)) ??
    degrees;

  // ------------------------------------------------------------- the position
  const work = planFor(WORK_WIDTH, template);
  const fixed = templateMap(work);
  if (!fixed) return { kind: 'unavailable' };
  if (!hasEnamel(fixed)) return { kind: 'no-teeth' };

  /*
   * Confirm the scale at full resolution before trusting it.
   *
   * The sweep above runs at half width with a wide stride, which is what makes
   * searching scale affordable at all -- but choosing a parameter at reduced
   * resolution and never re-checking it is a real weakness. Detail the scan
   * cannot resolve is exactly the detail that distinguishes neighbouring
   * scales, so its answer is a neighbourhood rather than a value. Re-scoring
   * the winner and its two neighbours at full resolution costs three passes and
   * settles which of them it actually is.
   */
  let best: {
    zoom: number;
    degrees: number;
    map: Float32Array;
    found: ReturnType<typeof matchTemplate>;
  } | null = null;

  for (const z of [zoom - ZOOM_FINE_STEP, zoom, zoom + ZOOM_FINE_STEP]) {
    for (const d of [degrees - ANGLE_FINE_STEP, degrees, degrees + ANGLE_FINE_STEP]) {
      const map = searchMap(work, z, d);
      if (!map || !hasEnamel(map)) continue;
      const found = matchTemplate(fixed, work.tw, work.th, map, work.sw, work.sh);
      if (!best || found.score > best.found.score) {
        best = { zoom: z, degrees: d, map, found };
      }
    }
  }

  if (!best) return { kind: 'no-teeth' };

  const { zoom: finalZoom, degrees: finalDegrees, map: search, found } = best;
  if (found.score < ACCEPT_SCORE) return { kind: 'weak', score: found.score };

  // Sideways: the interdental gaps are effectively a barcode and the template
  // locks onto them, so this correction is trustworthy on its own.
  const dx = (work.margin - found.x) / work.workScale;

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
  const anteriorFrom = work.tw * (0.5 - ANTERIOR_SHARE / 2);
  const anteriorTo = work.tw * (0.5 + ANTERIOR_SHARE / 2);

  const templateEdges = fallingEdges(
    rowProfile(fixed, work.tw, work.th, anteriorFrom, anteriorTo),
  );
  const searchEdges = fallingEdges(
    rowProfile(search, work.sw, work.sh, found.x + anteriorFrom, found.x + anteriorTo),
  );

  /*
   * A perfectly aligned pair puts the template's first row at search row
   * `margin`, so the alignment is measured from there and a shift of zero means
   * the coarse fit already had the vertical right.
   */
  const vertical = alignProfiles(
    templateEdges,
    searchEdges,
    work.margin,
    work.margin,
  );

  let dy = 0;
  let verticalIsManual = true;

  if (vertical && vertical.score >= ACCEPT_VERTICAL) {
    dy = -vertical.shift / work.workScale;
    verticalIsManual = false;
  }

  /*
   * Scale and rotate about the mouth's centre, then translate. In that order:
   * the shift was measured on an image that had already been scaled and turned,
   * so it corrects that result rather than the coarse one. About the mouth
   * rather than the image origin, so all three stay independent and each
   * measures one thing.
   */
  const radians = (finalDegrees * Math.PI) / 180;
  const cos = Math.cos(radians) * finalZoom;
  const sin = Math.sin(radians) * finalZoom;
  const aboutMouth: Matrix2D = {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: centre.x - (cos * centre.x - sin * centre.y),
    f: centre.y - (sin * centre.x + cos * centre.y),
  };

  return {
    kind: 'refined',
    refinement: {
      correction: compose(aboutMouth, translation(dx, dy)),
      zoom: finalZoom,
      rotation: finalDegrees,
      moved: Math.hypot(dx, dy),
      score: found.score,
      verticalIsManual,
    },
  };
}

/** The raster geometry for one working width. */
interface Plan {
  workScale: number;
  tw: number;
  th: number;
  margin: number;
  sw: number;
  sh: number;
}

function planFor(workWidth: number, template: Rect): Plan {
  const workScale = workWidth / template.width;
  const tw = Math.max(8, Math.round(template.width * workScale));
  const th = Math.max(6, Math.round(template.height * workScale));

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

  return { workScale, tw, th, margin, sw: tw + margin * 2, sh: th + margin * 2 };
}

/** Candidate values from `centre - span` to `centre + span`, inclusive. */
function sweep(centre: number, span: number, step: number): number[] {
  const values: number[] = [];
  const steps = Math.round(span / step);
  for (let i = -steps; i <= steps; i++) values.push(centre + i * step);
  return values;
}

/** The candidate scoring highest, or null when none of them scored at all. */
function bestOf(
  candidates: readonly number[],
  score: (value: number) => number,
): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const value = score(candidate);
    if (value > bestScore) {
      bestScore = value;
      best = candidate;
    }
  }
  return bestScore === -Infinity ? null : best;
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
