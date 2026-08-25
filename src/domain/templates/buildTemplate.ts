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
  },
  premolar: {
    width: 0.52,
    length: 1.15,
    incisalOffset: 0.13,
    zenithOffset: 0.0,
    zenithDrop: 0.05,
    incisalRounding: 0.3,
    cervicalTaper: 0.08,
  },
  molar: {
    width: 0.6,
    length: 1.1,
    incisalOffset: 0.2,
    zenithOffset: 0.0,
    zenithDrop: 0.05,
    incisalRounding: 0.28,
    cervicalTaper: 0.06,
  },
};

/**
 * A more stylized set: wider, squarer, more uniform -- the "Hollywood" look.
 * Deliberately flatter incisal offsets and less taper, which is exactly what
 * makes it read as cosmetic rather than natural.
 */
const HOLLYWOOD: Record<ToothType, TypeProportions> = {
  // Shorter and wider: width:length rises to 0.88, the squarer cosmetic look.
  central: { ...NATURAL.central, length: 1.14, incisalRounding: 0.08, cervicalTaper: 0.07 },
  lateral: { ...NATURAL.lateral, width: 0.72, length: 1.12, incisalOffset: 0.05, incisalRounding: 0.1, cervicalTaper: 0.08 },
  // Blunted rather than pointed -- below the isCusp threshold on purpose.
  canine: { ...NATURAL.canine, width: 0.64, length: 1.15, incisalOffset: 0.0, incisalRounding: 0.28, cervicalTaper: 0.07 },
  premolar: { ...NATURAL.premolar, width: 0.58, length: 1.08, incisalOffset: 0.09, incisalRounding: 0.18 },
  molar: { ...NATURAL.molar, width: 0.62, length: 1.05, incisalOffset: 0.15, incisalRounding: 0.2 },
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
  const flatHalf = isCusp ? 0 : halfWidth * (1 - p.incisalRounding);
  // How far the incisal corners sit above the lowest point of the edge.
  const cornerRise = length * (isCusp ? 0.16 : 0.05);

  const incisalEdge: Vec2[] = isCusp
    ? [vec(0, 0)]
    : [vec(-flatHalf, 0), vec(0, 0), vec(flatHalf, 0)];

  // The gum line is a smooth convex arc peaking at the zenith. `zenithDrop`
  // controls how much the shoulders fall away from that peak -- the peak is
  // the highest point, so the shoulders sit *below* it.
  const zenithX = side * p.zenithOffset * p.width;
  const gingivalZenith = vec(zenithX, length);
  const shoulderY = length - p.zenithDrop * p.width - length * 0.04;

  // Widest point of a natural tooth is in the incisal third, not at the edge.
  const bulgeY = length * 0.42;

  // A cusp needs its walls to leave the tip steeply. Pulling the control point
  // up to the corner height makes the two flanks meet at a genuine point; for a
  // flat-edged tooth the control stays low so the corner merely eases.
  const shoulderControlY = isCusp ? cornerRise : cornerRise * 0.4;

  const path = [
    // Start at the distal incisal corner (patient's right side of the tooth).
    `M ${round(-flatHalf)} 0`,
    // Up the mesial wall: ease out to the widest point, then taper to the gum.
    `Q ${round(-halfWidth)} ${round(shoulderControlY)} ${round(-halfWidth)} ${round(bulgeY)}`,
    `Q ${round(-cervicalHalf)} ${round(length * 0.8)} ${round(zenithX - cervicalHalf * 0.62)} ${round(shoulderY)}`,
    // Over the gum line: a single arc through the zenith, convex upward.
    `Q ${round(zenithX)} ${round(length + (length - shoulderY) * 0.55)} ${round(zenithX + cervicalHalf * 0.62)} ${round(shoulderY)}`,
    // Down the far wall, mirroring the near one.
    `Q ${round(cervicalHalf)} ${round(length * 0.8)} ${round(halfWidth)} ${round(bulgeY)}`,
    `Q ${round(halfWidth)} ${round(shoulderControlY)} ${round(flatHalf)} 0`,
    'Z',
  ];

  // A flat-edged tooth needs its incisal edge closed off explicitly; a cusp
  // already meets at a single point.
  if (!isCusp) path.splice(path.length - 1, 0, `L ${round(-flatHalf)} 0`);

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
