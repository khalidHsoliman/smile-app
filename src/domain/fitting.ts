/**
 * Arch fitting -- the algorithm the product is built on.
 *
 * Given the face frame, a template and the selected teeth, place every tooth.
 * Everything here happens in **face-frame coordinates**: normalized units where
 * the origin is the midline crossed with the lip line, +x runs toward the
 * patient's left, +y runs down the face, and one unit is the inter-alar width.
 * Conversion to pixels happens once, at render time.
 *
 * Pure. No React, no store, no DOM.
 */

import { type Vec2, vec } from './geometry.js';
import { resolveArchRuns } from './archRun.js';
import {
  centralsOf,
  isPatientRight,
  isUpper,
  type Arch,
  type Universal,
} from './teeth.js';
import type { Template, ToothTemplate } from './templates/types.js';

/**
 * The global fine-tune parameters.
 *
 * Each one is explained where the parameter is used, and named the way the
 * field's own tools name things.
 */
export interface FitParams {
  /** Width:length of the central incisor. Clinical target 0.80. */
  ratio: number;
  /** Overall size of the arch against the face. */
  scale: number;
  /**
   * Curvature of the incisal edge line, following the lower lip.
   *
   * Named `smileCurve`, not "curve of Spee". The curve of Spee is the
   * antero-posterior curve of the occlusal plane, visible only in lateral view;
   * this application is frontal-only, and what is seen and adjusted here is the
   * smile curve. Every 2D tool in the field names it that way, and the old
   * label reads as a category error on a frontal tool.
   */
  smileCurve: number;
  /** Vertical offset of the arch against the lip line. */
  occlusalGap: number;
  /**
   * Recurring Esthetic Dental proportion: the apparent width of each tooth
   * relative to its neighbour toward the midline.
   *
   * Replaces the previous `innerGap` inter-tooth spacing control. Anterior
   * contact points normally touch, so a slider that opens spaces between them
   * produces diastemata -- a defect, not a design goal -- and no tool in the
   * field exposes one. What they expose instead is this: the width relationship
   * across the anterior six, which is a decision the clinician actually makes.
   *
   * 0.62 is the golden proportion (tall faces), 0.70 normal, 0.80 short faces.
   */
  redProportion: number;
  /**
   * Overall arch width, independent of tooth size -- the buccal corridor.
   *
   * Not in the inherited five, but it is step 8 of the DSD protocol and appears
   * across the field's tools. On a frontal 2D design it is one of the few
   * parameters that visibly changes the character of a smile: a narrow arch
   * leaves dark corridors at the cheeks, a wide one fills them.
   */
  archWidth: number;
}

/**
 * One placed tooth, in face-frame units.
 *
 * `outline` is still the template's local path; the placement is expressed as a
 * transform so the renderer can emit `<path d={outline} transform=...>` and the
 * original geometry stays intact for per-tooth editing later.
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
  /** True for teeth added to complete the run -- rendered hidden. */
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
 * One face unit is the inter-alar width, which averages about 34 mm. A
 * maxillary central incisor is about 8.5 mm wide, so the ratio is 8.5/34 =
 * 0.25.
 *
 * Derived from those two measurements rather than estimated. An earlier value
 * of 0.29 was reasoned backwards from "the anterior six span one inter-alar
 * width", which double-counted: that DSD relationship compares inter-alar width
 * to inter-*canine* width measured at the arch, not to the summed frontal
 * widths of six teeth. It made every design about 17% oversized at scale 1.0 --
 * a 9.9 mm central against a real 8.5 mm -- so clinicians had to pull the
 * scale slider down on every case before starting.
 *
 * Sanity check at scale 1.0: central 8.5 x 10.6 mm, inter-canine span ~38 mm.
 */
export const CENTRAL_WIDTH_IN_FACE_UNITS = 0.25;

/**
 * `occlusalGap` runs -100..+100 but means a modest vertical shift. This maps
 * the slider's full travel to about a third of a face unit either way, which
 * covers every plausible correction without the ends being useless.
 */
export const OCCLUSAL_GAP_SCALE = 0.0035;

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
export const DEFAULT_INCISAL_DROP = 0.30;

/**
 * Vertical gap between the upper and lower incisal edges, in face units.
 * Roughly 1.4 mm: enough that the rows read as occluding without overlapping.
 */
const INTER_ARCH_GAP = 0.04;

/**
 * `smileCurve` runs -5..+5. At +5 the arch drops noticeably at the corners;
 * at -5 it reverses into the flat-or-reverse arc, the most common aesthetic
 * failure. The unit is face-frame y per unit x squared.
 */
export const CURVE_SCALE = 0.06;

/**
 * Where RED stops applying.
 *
 * The proportion is defined across the anterior six -- central, lateral,
 * canine. Premolars and molars are barely visible frontally and compounding the
 * ratio that far back would shrink them to nothing.
 */
const RED_LAST_POSITION = 3;

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
  // Arch width controls the buccal corridor by changing how sharply the arch
  // curves away from the viewer, not by compressing the teeth together.
  //
  // Scaling positions directly would be wrong: below 1.0 it pulls neighbours
  // closer than their own widths allow and they overlap. A real narrow arch
  // keeps its teeth in contact and turns them back toward the corners sooner,
  // so the posterior teeth foreshorten and the corridor darkens. That is
  // modelled here as apparent-width foreshortening that grows with distance
  // from the midline.
  const archCurvature = 1 - params.archWidth;

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
    // The previous tooth's placed width, for the monotonic-width clamp.
    let previousWidth: number | null = null;

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
      // RED reshapes the anterior width relationships. Position 1 (central) is
      // unchanged; every step outward multiplies by the proportion, so the
      // whole run stays anchored to the central rather than drifting.
      const redScale = redScaleFor(
        distanceFromMidline(universal, arch),
        tooth.width,
        params.redProportion,
      );

      // Foreshortening from arch curvature: teeth further from the midline turn
      // away from the viewer, so they present less width. A narrow arch turns
      // sooner and its corner teeth compress; a wide one presents them squarely.
      const turn = foreshortening(edge, centralWidth, archCurvature);
      const rawWidth = tooth.width * centralWidth * redScale * turn;

      /*
       * Widths must not increase moving away from the midline. RED applies only
       * across the anterior six, so at a low proportion the first premolar's
       * authored width could exceed the narrowed canine in front of it -- a
       * visible bulge at the anterior/posterior junction. Clamping against the
       * neighbour keeps the progression monotonic whatever the settings.
       */
      const width = Math.min(rawWidth, previousWidth ?? rawWidth);
      const widthScale = width / tooth.width;
      previousWidth = width;
      const lengthScale = lengthScaleFor(params.ratio, templateRatio);

      // Centre of this tooth, measured outward along the arch. Teeth stay in
      // contact: `edge` already accounts for every tooth placed before it.
      const centreOffset = edge + width / 2;
      const x = direction * centreOffset;

      placed.push({
        universal,
        position: vec(x, incisalY(x, tooth, centralWidth, params, arch)),
        scaleX: widthScale,
        // Template outlines are authored with +y toward the gum. For the upper
        // arch the gum is above the biting edge, which in face-frame terms
        // (y down) means negating. The lower arch's gum is below, so it keeps
        // the sign -- this is the whole of the upper/lower difference.
        scaleY: centralWidth * lengthScale * (isUpper(universal) ? -1 : 1),
        // Teeth splay outward along the arch; the further from the midline, the
        // more they rotate. Without this the arch reads as a flat row.
        rotation: direction * splay(centreOffset, params, arch),
        outline: tooth.outline,
        auxiliary: auxiliarySet.has(universal),
      });

      edge += width;
    }
  }

  return placed.sort((a, b) => a.universal - b.universal);
}

/**
 * Which side of the midline a tooth sits on: -1 patient's right, +1 left.
 *
 * Delegates to teeth.ts. The previous inline test compared against
 * centralsOf(arch)[0], assuming that entry is always the RIGHT central -- true
 * for the upper arch (8) but not the lower, where [24, 25] starts with the
 * LEFT central. Every lower tooth was assigned the wrong side, and the
 * template mirroring carried the same inversion, so the render was
 * self-consistently mirrored and looked plausible while being anatomically
 * backwards.
 */
const sideOf = (universal: Universal, _arch: Arch): -1 | 1 =>
  isPatientRight(universal) ? -1 : 1;

/** How many positions from the midline a tooth sits, 1 for a central. */
function distanceFromMidline(universal: Universal, arch: Arch): number {
  const [rightCentral, leftCentral] = centralsOf(arch);
  return universal <= rightCentral
    ? rightCentral - universal + 1
    : universal - leftCentral + 1;
}

/**
 * How much apparent width a tooth loses to arch curvature.
 *
 * `curvature` is 0 for a flat arch presenting every tooth squarely, positive
 * for a narrow arch that turns away sooner, negative for a wide one. The
 * falloff is quadratic in distance from the midline, so the centrals are
 * essentially untouched and the effect concentrates at the corners -- which is
 * exactly where the buccal corridor lives.
 *
 * Clamped so an extreme setting cannot invert or collapse a tooth.
 */
function foreshortening(
  offsetFromMidline: number,
  centralWidth: number,
  curvature: number,
): number {
  if (curvature === 0) return 1;
  // Measure the offset in central-incisor widths so the effect is independent
  // of the overall scale.
  const units = offsetFromMidline / centralWidth;
  return Math.min(1.4, Math.max(0.4, 1 - curvature * units * units * 0.22));
}

/**
 * The RED width multiplier for a tooth at `position` from the midline.
 *
 * Recurring Esthetic Dental proportion: each anterior tooth's apparent width is
 * a fixed fraction of its neighbour toward the midline, so the lateral is
 * `red x` the central and the canine `red x` the lateral.
 *
 * The multiplier is computed against the tooth's *own template width*, not as a
 * correction factor on it. Correcting compounds wrongly: the template's
 * canine:lateral and lateral:central ratios differ from each other, so a single
 * factor applied repeatedly does not converge on a uniform proportion -- it
 * left the canine at 0.93 of the lateral when 0.70 was asked for.
 *
 * `templateWidth` is relative to the central at 1.0, which is exactly the scale
 * RED is defined in, so the target width is simply `red^(position-1)`.
 */
function redScaleFor(
  position: number,
  templateWidth: number,
  redProportion: number,
): number {
  if (position <= 1 || position > RED_LAST_POSITION) return 1;
  const target = redProportion ** (position - 1);
  return target / templateWidth;
}

/**
 * How much to stretch crown length for the `ratio` parameter.
 *
 * `ratio` is the target width:length. Lower means longer and narrower, higher
 * means shorter and wider. Width is held and only length adjusted,
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
 *  - `smileCurve`, deepening or reversing the arc across the whole run;
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
  // the corners. A positive smileCurve deepens the arc (corners ride higher).
  const spee = params.smileCurve * CURVE_SCALE * x * x;
  const occlusal = params.occlusalGap * OCCLUSAL_GAP_SCALE;

  // The upper arch hangs down toward the lower lip and the lower arch rises
  // from below it, so the gull-wing and the curve mirror between them.
  const towardGum = arch === 'upper' ? -1 : 1;

  /*
   * Where each arch's incisal edge rests. The upper drops DEFAULT_INCISAL_DROP
   * below the lip-line origin; the lower sits just below the upper's edge, at
   * the occlusal plane.
   *
   * This was previously -DEFAULT_INCISAL_DROP -- a sign error that placed the
   * lower arch's incisal edges ABOVE the upper lip, rendering an entire arch
   * inside the lip near the nose. The lip mask clipped it in the smile view,
   * so every visual check passed; the first unmasked retracted-view export
   * showed a row of teeth under the patient's nose.
   */
  const rest =
    arch === 'upper'
      ? DEFAULT_INCISAL_DROP
      : DEFAULT_INCISAL_DROP + INTER_ARCH_GAP;

  return towardGum * (gullWing + spee) + occlusal + rest;
}

/**
 * How far a tooth rotates to follow the arch.
 *
 * Derived from the curve so the teeth stay perpendicular to it: the slope of
 * the incisal curve at this tooth's position is its rotation. Ties the splay to
 * `smileCurve` rather than making it a separate invented parameter.
 */
function splay(centreOffset: number, params: FitParams, arch: Arch): number {
  // Slope of the incisal curve at this tooth: d/dx of the curve incisalY
  // draws. incisalY applies towardGum (-1 upper, +1 lower) to the quadratic,
  // so the slope must carry the same sign -- without it the upper arch rotated
  // against its own curve, fanning corner teeth the wrong way while the lower
  // arch followed correctly.
  const towardGum = arch === 'upper' ? -1 : 1;
  const slope = towardGum * 2 * params.smileCurve * CURVE_SCALE * centreOffset;
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
 * The selection is widened into contiguous, anchored runs first --
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

/** The teeth a user can see and select -- auxiliaries are hidden. */
export const visibleTeeth = (result: FitResult): PlacedTooth[] =>
  result.teeth.filter((t) => !t.auxiliary);
