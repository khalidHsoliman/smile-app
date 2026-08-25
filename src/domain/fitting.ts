/**
 * Arch fitting (spec 6.3) -- the algorithm the product is built on.
 *
 * Given the face frame, a template and the selected teeth, place every tooth.
 * Everything here happens in **face-frame coordinates**: normalized units where
 * the origin is the midline crossed with the lip line, +x runs toward the
 * patient's left, +y runs down the face, and one unit is the inter-alar width.
 * Conversion to pixels happens once, at render time (spec 5.2, 11.3).
 *
 * Pure. No React, no store, no DOM.
 */

import { type Vec2, vec } from './geometry.js';
import { resolveArchRuns } from './archRun.js';
import { centralsOf, isUpper, type Arch, type Universal } from './teeth.js';
import type { Template, ToothTemplate } from './templates/types.js';

/** The five global fine-tune parameters (spec 6.4). */
export interface FitParams {
  ratio: number;
  scale: number;
  curveOfSpee: number;
  occlusalGap: number;
  innerGap: number;
}

/**
 * One placed tooth, in face-frame units.
 *
 * `outline` is still the template's local path; the placement is expressed as a
 * transform so the renderer can emit `<path d={outline} transform=...>` and the
 * original geometry stays intact for per-tooth editing later (spec 11.6).
 */
export interface PlacedTooth {
  universal: Universal;
  /** Where the tooth's incisal midpoint sits, in face-frame units. */
  position: Vec2;
  /** Scale applied to the template outline, x and y independently. */
  scaleX: number;
  scaleY: number;
  /** Rotation about `position`, radians. Follows the arch curvature. */
  rotation: number;
  /** The template path this instance draws. */
  outline: string;
  /** True for teeth added to complete the run -- rendered hidden (spec 6.3). */
  auxiliary: boolean;
}

export interface FitResult {
  teeth: PlacedTooth[];
  /** Auxiliary universals, for the renderer and for selection filtering. */
  auxiliary: Universal[];
}

/**
 * How wide the central incisor is, in face-frame units, before the `scale`
 * parameter is applied.
 *
 * One face unit is the inter-alar width. The classic DSD relationship is that
 * inter-alar width approximates inter-canine width -- so the six anterior teeth
 * span roughly one unit. Their combined template width is about 3.5 central
 * widths, which puts a single central near 0.29 units. That is the anchor the
 * `scale` slider multiplies from, so a scale of 1.0 lands in a credible place
 * on a typical face rather than requiring the user to hunt for it.
 */
const CENTRAL_WIDTH_IN_FACE_UNITS = 0.29;

/**
 * `occlusalGap` runs -100..+100 but means a modest vertical shift. This maps
 * the slider's full travel to about a third of a face unit either way, which
 * covers every plausible correction without the ends being useless.
 */
const OCCLUSAL_GAP_SCALE = 0.0035;

/**
 * Where the central incisal edge rests when `occlusalGap` is 0, in face units
 * below the lip line.
 *
 * The frame's origin is the midline crossed with the *lower border of the upper
 * lip*. In a natural smile the upper incisors show below that border -- that
 * visible band is most of what a smile design is judged on -- so resting the
 * edge exactly on the origin would tuck the teeth entirely behind the lip.
 * The default drops the incisal edge about a third of a face unit -- roughly
 * two thirds of a central incisor's length -- which fills the visible aperture
 * of an average smile instead of leaving a sliver of tooth under the lip. The
 * occlusalGap slider moves freely either side of it.
 */
const DEFAULT_INCISAL_DROP = 0.30;

/** `innerGap` runs -5..+5, in tenths of a central incisor width per step. */
const INNER_GAP_SCALE = 0.02;

/**
 * `curveOfSpee` runs -5..+5. At +5 the arch drops noticeably at the corners;
 * at -5 it reverses. The unit is face-frame y per unit x squared.
 */
const CURVE_SCALE = 0.06;

/**
 * Fit one arch.
 *
 * Walks outward from the central incisors, placing each tooth against its
 * neighbour's distal edge. The centrals straddle the dental midline, so with a
 * symmetric template the design is symmetric by construction.
 */
function fitArch(
  run: Universal[],
  auxiliarySet: Set<Universal>,
  arch: Arch,
  template: Template,
  params: FitParams,
): PlacedTooth[] {
  if (run.length === 0) return [];

  const [rightCentral] = centralsOf(arch);
  const centralWidth = CENTRAL_WIDTH_IN_FACE_UNITS * params.scale;
  const gap = params.innerGap * INNER_GAP_SCALE * centralWidth;

  // The template's own width:length is the baseline; `ratio` scales away from
  // it. A ratio equal to the template's leaves the teeth as authored.
  const referenceTooth = template.teeth[rightCentral];
  if (!referenceTooth) return [];
  const templateRatio = referenceTooth.width / referenceTooth.length;

  const placed: PlacedTooth[] = [];

  // Walk each side outward from the midline independently. `direction` is -1
  // toward the patient's right, +1 toward their left.
  for (const direction of [-1, 1] as const) {
    // Teeth on this side, ordered from the midline outward.
    const side = run
      .filter((t) => sideOf(t, arch) === direction)
      .sort((a, b) => distanceFromMidline(a, arch) - distanceFromMidline(b, arch));

    // The inner edge of the next tooth to place, measured from the midline.
    let edge = 0;

    for (const universal of side) {
      const tooth = template.teeth[universal];
      if (!tooth) continue;

      // The outline is authored in template units, where the central incisor is
      // 1.0 wide. Converting to face units is therefore one uniform factor --
      // `centralWidth` -- applied to every tooth. The per-tooth differences are
      // already baked into the outline itself.
      //
      // The occupied width must be computed from that same factor, or teeth
      // advance by a different amount than they are drawn at and the arch
      // overlaps itself.
      const width = tooth.width * centralWidth;
      const lengthScale = lengthScaleFor(params.ratio, templateRatio);

      // Centre of this tooth, measured outward along the arch.
      const centreOffset = edge + width / 2;
      const x = direction * centreOffset;

      placed.push({
        universal,
        position: vec(x, incisalY(x, tooth, centralWidth, params, arch)),
        scaleX: centralWidth,
        // Template outlines are authored with +y toward the gum. For the upper
        // arch the gum is above the biting edge, which in face-frame terms
        // (y down) means negating. The lower arch's gum is below, so it keeps
        // the sign -- this is the whole of the upper/lower difference.
        scaleY: centralWidth * lengthScale * (isUpper(universal) ? -1 : 1),
        // Teeth splay outward along the arch; the further from the midline, the
        // more they rotate. Without this the arch reads as a flat row.
        rotation: direction * splay(centreOffset, params),
        outline: tooth.outline,
        auxiliary: auxiliarySet.has(universal),
      });

      edge += width + gap;
    }
  }

  return placed.sort((a, b) => a.universal - b.universal);
}

/**
 * Which side of the midline a tooth sits on: -1 patient's right, +1 left.
 *
 * Upper 1-8 and lower 25-32 are the patient's right; the rest are their left.
 */
function sideOf(universal: Universal, arch: Arch): -1 | 1 {
  const [rightCentral] = centralsOf(arch);
  return universal <= rightCentral ? -1 : 1;
}

/** How many positions from the midline a tooth sits, 1 for a central. */
function distanceFromMidline(universal: Universal, arch: Arch): number {
  const [rightCentral, leftCentral] = centralsOf(arch);
  return universal <= rightCentral
    ? rightCentral - universal + 1
    : universal - leftCentral + 1;
}

/**
 * How much to stretch crown length for the `ratio` parameter.
 *
 * `ratio` is the target width:length. Lower means longer and narrower, higher
 * means shorter and wider (spec 6.4). Width is held and only length adjusted,
 * so the arch keeps its span while the teeth change proportion.
 *
 * Returns a multiplier on the authored length, so it applies uniformly to every
 * tooth in the arch rather than being recomputed per tooth.
 */
function lengthScaleFor(ratio: number, templateRatio: number): number {
  // Guard the divide: `ratio` is clamped to >= 0.1 upstream, but this must not
  // produce Infinity if that ever changes.
  if (ratio <= 0) return 1;
  return templateRatio / ratio;
}

/**
 * Vertical position of a tooth's incisal edge, in face-frame units.
 *
 * y grows downward, and the origin sits on the lip line, so a tooth's incisal
 * edge sits near y = 0 by default. Three things move it:
 *
 *  - the template's own `incisalOffset`, which produces the gull-wing arc;
 *  - `curveOfSpee`, deepening or reversing the arc across the whole run;
 *  - `occlusalGap`, shifting the entire arch up or down against the lip.
 */
function incisalY(
  x: number,
  tooth: ToothTemplate,
  centralWidth: number,
  params: FitParams,
  arch: Arch,
): number {
  const gullWing = tooth.incisalOffset * centralWidth;
  // Quadratic in distance from the midline: flat at the centrals, rising into
  // the corners. Positive curveOfSpee deepens the arc (corners ride higher).
  const spee = params.curveOfSpee * CURVE_SCALE * x * x;
  const occlusal = params.occlusalGap * OCCLUSAL_GAP_SCALE;

  // The upper arch hangs down from above the lip line and the lower rises from
  // below, so the gull-wing and the curve mirror between them.
  const towardGum = arch === 'upper' ? -1 : 1;
  // The upper incisors show below the lip border; the lower arch sits above it.
  const rest = arch === 'upper' ? DEFAULT_INCISAL_DROP : -DEFAULT_INCISAL_DROP;

  return towardGum * (gullWing + spee) + occlusal + rest;
}

/**
 * How far a tooth rotates to follow the arch.
 *
 * Derived from the curve so the teeth stay perpendicular to it: the slope of
 * the incisal curve at this tooth's position is its rotation. Ties the splay to
 * `curveOfSpee` rather than making it a separate invented parameter.
 */
function splay(centreOffset: number, params: FitParams): number {
  // Slope of the incisal curve at this tooth: d/dx of curveOfSpee * k * x^2.
  const slope = 2 * params.curveOfSpee * CURVE_SCALE * centreOffset;
  // `atan` turns the slope into the angle the curve makes with the horizontal,
  // which is exactly how far the tooth must turn to stay perpendicular to it.
  // Damped, because following the curve exactly over-rotates the corner teeth
  // into a visible fan.
  return Math.atan(slope) * SPLAY_DAMPING;
}

/**
 * How much of the curve's own slope each tooth adopts. 1.0 would keep every
 * tooth exactly perpendicular to the incisal curve, which fans the corners out
 * far more than a real arch does.
 */
const SPLAY_DAMPING = 0.35;

/**
 * Fit the whole design.
 *
 * The selection is widened into contiguous, anchored runs first (spec 6.3) --
 * fitting cannot lay out a sparse selection, and a run without a central has no
 * anchor to walk outward from.
 */
export function fitArches(
  selected: readonly Universal[],
  template: Template,
  params: FitParams,
): FitResult {
  const runs = resolveArchRuns(selected);
  const auxiliary = [...runs.upper.auxiliary, ...runs.lower.auxiliary];
  const auxiliarySet = new Set(auxiliary);

  return {
    teeth: [
      ...fitArch(runs.upper.run, auxiliarySet, 'upper', template, params),
      ...fitArch(runs.lower.run, auxiliarySet, 'lower', template, params),
    ],
    auxiliary,
  };
}

/** The teeth a user can see and select -- auxiliaries are hidden (spec 6.3). */
export const visibleTeeth = (result: FitResult): PlacedTooth[] =>
  result.teeth.filter((t) => !t.auxiliary);
