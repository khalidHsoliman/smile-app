/**
 * Generating tooth outlines from the clinical proportions (spec 6.2).
 *
 * The outlines are *generated* from a small set of per-tooth-type parameters
 * rather than hand-drawn 32 times. Hand-drawing invites inconsistency between
 * contralateral partners and makes the aesthetic ratios invisible in the
 * source; here the proportions the spec calls out are named constants that a
 * clinician could review, and mirroring is exact by construction.
 *
 * "Ugly is fine; correct is not optional" (spec 14 step 6) -- so this
 * prioritizes the proportions being right over the silhouettes being beautiful.
 */

import { vec, type Vec2 } from '../geometry.js';
import { isUpper, mirrorOf, type Universal } from '../teeth.js';
import type { Template, ToothTemplate } from './types.js';

/**
 * The tooth types we distinguish. Molars are included so a wide selection still
 * lays out, but they are barely visible in a frontal smile and are shaped
 * generically on purpose.
 */
export type ToothType = 'central' | 'lateral' | 'canine' | 'premolar' | 'molar';

/**
 * Which type each universal number is, by position within the arch.
 *
 * Upper right runs 1(third molar) to 8(central); the arch is symmetric about
 * the midline, so position-from-centre determines the type.
 */
export function toothType(universal: Universal): ToothType {
  // Distance from the midline: 1 = central, 2 = lateral, 3 = canine, ...
  const fromMidline = isUpper(universal)
    ? universal <= 8
      ? 9 - universal
      : universal - 8
    : universal <= 24
      ? 25 - universal
      : universal - 24;

  switch (fromMidline) {
    case 1:
      return 'central';
    case 2:
      return 'lateral';
    case 3:
      return 'canine';
    case 4:
    case 5:
      return 'premolar';
    default:
      return 'molar';
  }
}

/**
 * The proportions from spec 6.2, as reviewable constants.
 *
 * `width` and `length` are both relative to the central incisor's width at 1.0.
 * Their quotient is the width:length ratio the spec calls the single most
 * important one (0.75-0.85); the central sits mid-range at 0.80 and the
 * fine-tune `ratio` slider moves it from there.
 *
 * `incisalOffset` is how far above the central's edge this tooth's edge sits,
 * in width units. The lateral is shorter and the canine returns to near the
 * central's level: that is the gull-wing arc.
 */
interface TypeProportions {
  width: number;
  /**
   * Crown length in central-incisor-width units, specified independently of
   * `width`.
   *
   * Deriving length from width would be wrong: a canine is narrow *and* long,
   * so `width / ratio` makes it far too short and drags its gingival zenith
   * down to the lateral's level. Spec 6.2 requires central and canine zeniths
   * roughly level with the lateral's sitting ~0.5-1mm more incisal, and that
   * only holds if length is its own parameter.
   */
  length: number;
  incisalOffset: number;
  /** Gingival zenith offset from the tooth's centre line, in width units. */
  zenithOffset: number;
  /** How far the zenith sits below the gingival extreme, in width units. */
  zenithDrop: number;
  /** Corner rounding at the incisal edge, as a share of half-width. */
  incisalRounding: number;
  /** Mesial-distal taper: how much narrower the tooth is at the gum line. */
  cervicalTaper: number;
  /**
   * How much rounder the *distal* incisal corner is than the mesial one.
   *
   * This is the single strongest cue that a drawn tooth is real. On a natural
   * central incisor the mesial corner (toward the midline) is nearly a right
   * angle while the distal corner is visibly rounded, and the asymmetry grows
   * as you move back along the arch. A perfectly symmetric tooth reads as
   * manufactured no matter how good its proportions are.
   */
  distalRounding: number;
  /**
   * Where the crown is widest, as a fraction of its length from the incisal
   * edge. Natural crowns bulge in the incisal third, not at the edge itself.
   */
  bulgeHeight: number;
  /**
   * Curvature of the incisal edge itself, in width units. Positive bows the
   * edge downward at its centre, which is what an unworn central does; a
   * dead-straight edge reads as a worn or artificial tooth.
   */
  incisalBow: number;
}

/*
 * Lengths are chosen so that the *gingival* line (length - incisalOffset) lands
 * where spec 6.2 wants it: central and canine roughly level, the lateral about
 * 0.06 units more incisal. With the central at width 1.0 and a 0.80 width:length
 * ratio its crown is 1.25 long, which fixes the scale for the rest.
 */
const NATURAL: Record<ToothType, TypeProportions> = {
  // The reference tooth. Everything else is expressed against it.
  central: {
    width: 1.0,
    length: 1.25, // width:length = 0.80, mid of the spec's 0.75-0.85
    incisalOffset: 0,
    zenithOffset: 0.06,
    zenithDrop: 0.04,
    incisalRounding: 0.16,
    cervicalTaper: 0.12,
    // Mesial corner nearly square, distal clearly rounded -- the classic
    // central incisor signature.
    distalRounding: 2.6,
    bulgeHeight: 0.36,
    incisalBow: 0.035,
  },
  // 0.62-0.70 in the spec; 0.66 is mid-range and reads naturally.
  // Gum line: 1.21 - 0.09 = 1.12, about 0.13 more incisal than the central's.
  // A subtler step than this leaves the gum line reading as flat, which spec
  // 6.2 calls out as the artificial-looking failure mode.
  lateral: {
    width: 0.66,
    length: 1.21,
    incisalOffset: 0.09,
    zenithOffset: 0.05,
    zenithDrop: 0.07,
    incisalRounding: 0.22,
    cervicalTaper: 0.14,
    // The lateral is rounder overall than the central, and more so distally.
    distalRounding: 2.2,
    bulgeHeight: 0.38,
    incisalBow: 0.05,
  },
  // 0.55-0.62 in the spec. Narrow but long -- its gum line returns to the
  // central's level (1.26 - 0.01 = 1.25) and its tip nearly does too.
  canine: {
    width: 0.58,
    length: 1.26,
    incisalOffset: 0.01,
    zenithOffset: 0.09,
    zenithDrop: 0.03,
    // The canine is pointed, not squared off -- its cusp tip is the feature.
    incisalRounding: 0.45,
    cervicalTaper: 0.1,
    // The cusp tip sits mesial of centre, so the distal slope is the longer
    // one. This is what stops a canine looking like a symmetric spike.
    distalRounding: 1.9,
    bulgeHeight: 0.34,
    incisalBow: 0,
  },
  premolar: {
    width: 0.52,
    length: 1.15,
    incisalOffset: 0.13,
    zenithOffset: 0.0,
    zenithDrop: 0.05,
    incisalRounding: 0.3,
    cervicalTaper: 0.08,
    distalRounding: 1.4,
    bulgeHeight: 0.4,
    incisalBow: 0.02,
  },
  molar: {
    width: 0.6,
    length: 1.1,
    incisalOffset: 0.2,
    zenithOffset: 0.0,
    zenithDrop: 0.05,
    incisalRounding: 0.28,
    cervicalTaper: 0.06,
    distalRounding: 1.2,
    bulgeHeight: 0.42,
    incisalBow: 0.015,
  },
};

/**
 * A more stylized set: wider, squarer, more uniform -- the "Hollywood" look.
 * Deliberately flatter incisal offsets and less taper, which is exactly what
 * makes it read as cosmetic rather than natural.
 */
const HOLLYWOOD: Record<ToothType, TypeProportions> = {
  // Shorter and wider: width:length rises to 0.88, the squarer cosmetic look.
  // The near-symmetric corners and flat incisal edges are the point -- that
  // deliberate uniformity is exactly what makes the set read as cosmetic.
  central: { ...NATURAL.central, length: 1.14, incisalRounding: 0.08, cervicalTaper: 0.07, distalRounding: 1.3, incisalBow: 0.012 },
  lateral: { ...NATURAL.lateral, width: 0.72, length: 1.12, incisalOffset: 0.05, incisalRounding: 0.1, cervicalTaper: 0.08, distalRounding: 1.25, incisalBow: 0.015 },
  // Blunted rather than pointed -- below the isCusp threshold on purpose.
  canine: { ...NATURAL.canine, width: 0.64, length: 1.15, incisalOffset: 0.0, incisalRounding: 0.28, cervicalTaper: 0.07, distalRounding: 1.2, incisalBow: 0.01 },
  premolar: { ...NATURAL.premolar, width: 0.58, length: 1.08, incisalOffset: 0.09, incisalRounding: 0.18, distalRounding: 1.15 },
  molar: { ...NATURAL.molar, width: 0.62, length: 1.05, incisalOffset: 0.15, incisalRounding: 0.2, distalRounding: 1.1 },
};

/**
 * Build one tooth outline in its local frame.
 *
 * Origin is the incisal midpoint, +y toward the gum. The silhouette is a
 * rounded trapezoid: widest at the incisal third, tapering toward the gum, with
 * the incisal corners eased. Quadratic curves keep the proximal walls and the
 * gum line smooth -- a polyline reads as faceted at design scale.
 *
 * `isCusp` teeth (canines) come to a point instead of a flat edge: the cusp tip
 * is the canine's defining feature and a flat-topped canine reads as wrong
 * immediately.
 *
 * `side` is -1 for the patient's right, +1 for their left, and mirrors the
 * asymmetric features -- the zenith sits distal to the tooth's centre line.
 */
function buildOutline(p: TypeProportions, side: -1 | 1): {
  outline: string;
  incisalEdge: Vec2[];
  gingivalZenith: Vec2;
} {
  const halfWidth = p.width / 2;
  const length = p.length;
  const cervicalHalf = halfWidth * (1 - p.cervicalTaper);

  // A high rounding value means a pointed tooth rather than a wide flat edge.
  const isCusp = p.incisalRounding >= 0.4;

  // `side` is -1 for the patient's right, +1 for their left. Mesial is the edge
  // facing the midline, distal the one facing away. In local coordinates the
  // mesial edge is at -x for a patient's-left tooth and +x for a right one.
  const mesialSign = side === 1 ? -1 : 1;

  // The distal corner is rounder than the mesial one. Splitting a shared
  // rounding budget between them keeps the tooth's width honest while making
  // the two corners visibly different.
  const meanRound = p.incisalRounding;
  const distalRound = Math.min(0.92, meanRound * p.distalRounding);
  const mesialRound = Math.max(0.02, meanRound * 2 - distalRound);

  // A cusp meets at a single tip rather than along a flat edge. The tip sits
  // mesial of centre on a real canine, so the distal slope is the longer of the
  // two -- that offset is what stops it looking like a symmetric spike.
  const cuspTipX = isCusp ? mesialSign * halfWidth * 0.16 : 0;
  const mesialFlat = isCusp ? cuspTipX * mesialSign : halfWidth * (1 - mesialRound);
  const distalFlat = isCusp ? -cuspTipX * mesialSign : halfWidth * (1 - distalRound);

  // How far each incisal corner rises above the lowest point of the edge. The
  // rounder corner rises further, which is what makes the rounding read.
  const mesialRise = length * (isCusp ? 0.15 : 0.035) + halfWidth * mesialRound * 0.16;
  const distalRise = length * (isCusp ? 0.20 : 0.045) + halfWidth * distalRound * 0.26;

  // The incisal edge bows downward at its centre on an unworn tooth.
  const bowY = -p.incisalBow * p.width;

  /*
   * The incisal edge as the fitter sees it: the anchor laid along the smile
   * curve. Every point sits at y = 0 by contract -- the bow is a shape detail
   * of the drawn outline, not a displacement of the anchor. Letting the bow
   * leak in here would tilt the tooth against the smile curve by however much
   * the edge was bowed.
   */
  const incisalEdge: Vec2[] = isCusp
    ? [vec(cuspTipX, 0)]
    : [
        vec(mesialSign * mesialFlat, 0),
        vec(0, 0),
        vec(-mesialSign * distalFlat, 0),
      ];

  // The gum line is a smooth convex arc peaking at the zenith, which sits
  // distal to the tooth's centre line.
  const zenithX = side * p.zenithOffset * p.width;
  const gingivalZenith = vec(zenithX, length);
  const shoulderY = length - p.zenithDrop * p.width - length * 0.04;

  // Widest point of the crown, in the incisal third.
  const bulgeY = length * p.bulgeHeight;

  // Signed x helpers, so the path can be written in mesial/distal terms and
  // come out mirrored correctly for either side.
  const mx = (v: number) => mesialSign * v;
  const dx = (v: number) => -mesialSign * v;

  // Cubic control points give the walls an S-curve -- convex at the bulge,
  // concave as they taper to the gum -- which a single quadratic cannot do.
  const path = [
    `M ${round(mx(mesialFlat))} ${round(0)}`,

    // Mesial wall, incisal corner to widest point. The near control sits low
    // and close, so the corner turns tightly; a squarer corner has a smaller
    // mesialRise and turns tighter still. A cusp's mesial slope is shorter and
    // steeper than its distal one.
    isCusp
      ? `C ${round(mx(halfWidth * 0.58))} ${round(mesialRise * 0.62)}` +
        ` ${round(mx(halfWidth * 0.95))} ${round(bulgeY * 0.40)}` +
        ` ${round(mx(halfWidth))} ${round(bulgeY)}`
      : `C ${round(mx(halfWidth * 0.995))} ${round(mesialRise * 0.55)}` +
        ` ${round(mx(halfWidth))} ${round(bulgeY * 0.45)}` +
        ` ${round(mx(halfWidth))} ${round(bulgeY)}`,

    // Mesial wall, widest point to the gingival shoulder: a long concave taper.
    `C ${round(mx(halfWidth))} ${round(bulgeY + (shoulderY - bulgeY) * 0.42)}` +
      ` ${round(mx(cervicalHalf))} ${round(shoulderY - (shoulderY - bulgeY) * 0.18)}` +
      ` ${round(zenithX + mx(cervicalHalf * 0.60))} ${round(shoulderY)}`,

    // The gingival arc across the top, peaking at the zenith.
    `C ${round(zenithX + mx(cervicalHalf * 0.26))} ${round(length)}` +
      ` ${round(zenithX + dx(cervicalHalf * 0.26))} ${round(length)}` +
      ` ${round(zenithX + dx(cervicalHalf * 0.60))} ${round(shoulderY)}`,

    // Distal wall, shoulder back down to the widest point.
    `C ${round(dx(cervicalHalf))} ${round(shoulderY - (shoulderY - bulgeY) * 0.18)}` +
      ` ${round(dx(halfWidth))} ${round(bulgeY + (shoulderY - bulgeY) * 0.42)}` +
      ` ${round(dx(halfWidth))} ${round(bulgeY)}`,

    // Distal wall down to the incisal corner. On a flat-edged tooth the rounder
    // corner needs its controls pulled in, which softens it. On a cusp the wall
    // must instead run cleanly to the tip -- reusing the corner controls there
    // hooks the outline back on itself and leaves a notch on the outer flank.
    isCusp
      ? `C ${round(dx(halfWidth * 0.92))} ${round(bulgeY * 0.34)}` +
        ` ${round(dx(halfWidth * 0.52))} ${round(distalRise * 0.60)}` +
        ` ${round(dx(distalFlat))} ${round(0)}`
      : `C ${round(dx(halfWidth))} ${round(bulgeY * 0.40)}` +
        ` ${round(dx(halfWidth * 0.94))} ${round(distalRise * 0.72)}` +
        ` ${round(dx(distalFlat))} ${round(0)}`,
  ];

  if (isCusp) {
    // Close the cusp: both flanks already end at the tip's x, so this only has
    // to run the short distal slope back to it. Keeping the control close to
    // the tip preserves the point instead of rounding it off.
    path.push(
      `Q ${round(cuspTipX * 0.4)} ${round(-halfWidth * 0.10)}` +
        ` ${round(mx(mesialFlat))} ${round(0)}`,
    );
  } else {
    // A gently bowed incisal edge rather than a straight line.
    path.push(
      `Q ${round(0)} ${round(bowY * 2)} ${round(mx(mesialFlat))} ${round(0)}`,
    );
  }

  path.push('Z');

  return { outline: path.join(' '), incisalEdge, gingivalZenith };
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

function buildTooth(
  universal: Universal,
  proportions: Record<ToothType, TypeProportions>,
): ToothTemplate {
  const p = proportions[toothType(universal)];

  // Patient's right teeth (upper 1-8, lower 25-32) mirror the left ones.
  const side: -1 | 1 = mirrorOf(universal) > universal ? -1 : 1;
  const { outline, incisalEdge, gingivalZenith } = buildOutline(p, side);

  return {
    universal,
    outline,
    width: p.width,
    length: p.length,
    gingivalZenith,
    incisalEdge,
    incisalOffset: p.incisalOffset,
  };
}

function buildTemplate(
  id: string,
  name: string,
  description: string,
  proportions: Record<ToothType, TypeProportions>,
): Template {
  const teeth: Record<Universal, ToothTemplate> = {};
  for (let universal = 1; universal <= 32; universal++) {
    teeth[universal] = buildTooth(universal, proportions);
  }
  return { id, name, description, teeth };
}

export const TEMPLATES: Template[] = [
  buildTemplate(
    'natural',
    'Natural',
    'Softly rounded with a visible smile arc. The default for most cases.',
    NATURAL,
  ),
  buildTemplate(
    'hollywood',
    'Hollywood',
    'Wider, squarer and more uniform. A deliberately cosmetic look.',
    HOLLYWOOD,
  ),
];

export const getTemplate = (id: string): Template | undefined =>
  TEMPLATES.find((t) => t.id === id);

export const DEFAULT_TEMPLATE_ID = 'natural';
