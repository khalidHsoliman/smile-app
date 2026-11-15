/**
 * The numbers a clinician reads off a design.
 *
 * From the facial references: head tilt, midline cant and lip line cant. From
 * the designed upper teeth, per side: the central's width:length, and the
 * lateral's and canine's width as a share of the central beside them. And one
 * that joins the two: how far the dental midline sits from the facial one.
 *
 * Conventions, agreed with the clinic:
 *
 *  - Head tilt is the pupil line against the image horizontal. Both cants are
 *    against the pupil line: the midline against the line at 90 degrees to it,
 *    the lip line against it directly. A cant therefore says how the feature
 *    sits on the face, whatever the head is doing in the photograph.
 *  - Direction is named by the patient's side, taken from the *labels* of the
 *    pupil references, never from image left/right. A mirrored photograph with
 *    the same labels reads the same side. The lip line has no labels of its
 *    own: its ends are told apart by where they lie along the pupil line.
 *  - "Down" is the image's down: photographs are upright once rotation is
 *    baked in, and mirroring does not change it.
 *  - Widths are each tooth's own width and length as designed -- template
 *    size times its placed scale, so foreshortening, the tooth proportion
 *    slider and per-tooth edits all count -- with no projection for rotation.
 *  - Upper teeth only. Hidden (auxiliary) teeth do not count.
 *  - The dental midline is the point halfway between the inner edges of 11 and
 *    21 at their biting edge, rotation ignored like the widths. Its offset is
 *    measured along the pupil line, from the facial midline handle line at the
 *    same height, as a share of the two centrals' average width.
 *  - Angles show to 0.1 degree, tooth numbers and the midline offset as whole
 *    percents. A level or centred result is "0.0°" or "0%" with no side.
 *  - What cannot be worked out is "-": with a short reason in the panel, on its
 *    own in the report.
 *
 * Pure: no React, no store, no DOM.
 */

import {
  type Vec2,
  applyMatrix,
  distance,
  dot,
  length,
  normalize,
  perpendicular,
  scaleVec,
  sub,
} from './geometry.js';
import {
  computeFaceFrame,
  faceToWorldMatrix,
  type FacialReferences,
} from './faceFrame.js';
import type { PlacedTooth } from './fitting.js';
import type { Template } from './templates/types.js';
import { toFDI, type Universal } from './teeth.js';

/** The patient's side. */
export type Side = 'left' | 'right';

/** A number, or the reason it could not be worked out. */
export type Measurement<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * An unsigned angle and the patient's side it leans to.
 *
 * For head tilt and the lip line, `side` is the side that is lower; for the
 * midline, the side its lower end points toward. Null only when exactly level.
 */
export interface Angle {
  degrees: number;
  side: Side | null;
}

/**
 * A distance as a fraction of a central's width (0.09 means 9%), and the
 * patient's side it lies toward. Null only when exactly centred.
 */
export interface Offset {
  fraction: number;
  side: Side | null;
}

export interface FaceMeasurements {
  headTilt: Measurement<Angle>;
  midlineCant: Measurement<Angle>;
  lipLineCant: Measurement<Angle>;
}

/** One side of the upper arch. Values are fractions: 0.8 means 80%. */
export interface SideTeethMeasurements {
  centralWidthToLength: Measurement<number>;
  lateralToCentral: Measurement<number>;
  canineToCentral: Measurement<number>;
}

export interface ToothMeasurements {
  right: SideTeethMeasurements;
  left: SideTeethMeasurements;
}

/** Where a value is shown: the panel gives reasons, the report does not. */
export type Where = 'panel' | 'report';

/** Below this, in pixels, two points are treated as one -- as faceFrame does. */
const EPSILON = 1e-6;

const ok = <T>(value: T): Measurement<T> => ({ ok: true, value });
const fail = <T>(reason: string): Measurement<T> => ({ ok: false, reason });

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Patient's side for a signed offset: positive is the patient's left. */
const sideOf = (signed: number): Side | null =>
  signed > 0 ? 'left' : signed < 0 ? 'right' : null;

// --- face ---------------------------------------------------------------------

/**
 * Axes taken from the pupils: `u` along the pupil line toward the patient's
 * left (by label, so it points image-left on a mirrored photo), `v` at 90
 * degrees to it, pointing down the image.
 */
function pupilAxes(refs: FacialReferences): { u: Vec2; v: Vec2 } | null {
  const across = sub(refs.leftPupil, refs.rightPupil);
  if (length(across) < EPSILON) return null;
  const u = normalize(across);
  const normal = perpendicular(u);
  return { u, v: normal.y < 0 ? scaleVec(normal, -1) : normal };
}

/** Head tilt: the pupil line against the image horizontal. */
function headTilt(refs: FacialReferences): Measurement<Angle> {
  const across = sub(refs.leftPupil, refs.rightPupil);
  if (length(across) < EPSILON) return fail('pupils on top of each other');
  return ok({
    degrees: toDegrees(Math.atan2(Math.abs(across.y), Math.abs(across.x))),
    // Image y grows downward: a larger y on the left pupil is the left side lower.
    side: sideOf(across.y),
  });
}

/** Midline cant: the facial midline against the line at 90 degrees to the pupil line. */
function midlineCant(refs: FacialReferences): Measurement<Angle> {
  const axes = pupilAxes(refs);
  if (!axes) return fail('pupils on top of each other');
  const { u, v } = axes;

  if (length(sub(refs.midlineBottom, refs.midlineTop)) < EPSILON) {
    return fail('midline has no length');
  }

  // Which end is lower is measured, not read from the handle names, so
  // handles dragged past each other still give the right answer.
  const [upper, lower] =
    dot(refs.midlineTop, v) <= dot(refs.midlineBottom, v)
      ? [refs.midlineTop, refs.midlineBottom]
      : [refs.midlineBottom, refs.midlineTop];
  const down = sub(lower, upper);
  const along = dot(down, u);

  return ok({
    degrees: toDegrees(Math.atan2(Math.abs(along), dot(down, v))),
    side: sideOf(along),
  });
}

/**
 * Lip line cant: the line through the two ends of the lip line -- the mouth
 * corners -- against the pupil line.
 *
 * The ends are the points furthest toward each side along the pupil line, not
 * the first and last points: dragged handles can leave the first and last
 * points anywhere, and which end is the patient's left depends on the pupil
 * labels, not on the order.
 */
function lipLineCant(refs: FacialReferences): Measurement<Angle> {
  const axes = pupilAxes(refs);
  if (!axes) return fail('pupils on top of each other');
  const { u, v } = axes;

  if (refs.lipCurve.length < 2) return fail('lip line needs two points');

  let rightEnd = refs.lipCurve[0]!;
  let leftEnd = rightEnd;
  for (const point of refs.lipCurve) {
    if (dot(point, u) < dot(rightEnd, u)) rightEnd = point;
    if (dot(point, u) > dot(leftEnd, u)) leftEnd = point;
  }

  const across = sub(leftEnd, rightEnd);
  if (length(across) < EPSILON) return fail('lip line ends on top of each other');
  const drop = dot(across, v);

  return ok({
    degrees: toDegrees(Math.atan2(Math.abs(drop), dot(across, u))),
    // `v` points down: a positive drop is the left end lower.
    side: sideOf(drop),
  });
}

/** Head tilt and both cants. Null references make all three "-". */
export function faceMeasurements(refs: FacialReferences | null): FaceMeasurements {
  if (!refs) {
    const none = fail<Angle>('no facial references');
    return { headTilt: none, midlineCant: none, lipLineCant: none };
  }
  return {
    headTilt: headTilt(refs),
    midlineCant: midlineCant(refs),
    lipLineCant: lipLineCant(refs),
  };
}

// --- teeth --------------------------------------------------------------------

/** Upper central, lateral and canine on each side (FDI 11-13 and 21-23). */
const UPPER_ANTERIORS: Record<Side, { central: Universal; lateral: Universal; canine: Universal }> = {
  right: { central: 8, lateral: 7, canine: 6 },
  left: { central: 9, lateral: 10, canine: 11 },
};

interface Size {
  width: number;
  length: number;
  /** The incisal midpoint, in face units. */
  position: Vec2;
}

/**
 * A designed tooth's own width and length, in face units.
 *
 * The placed scales are face units per template unit (see fitting.ts), so the
 * template's size times them is what is drawn. `scaleY` carries the arch's
 * up/down sign, hence the absolute value.
 */
function sizeOf(
  universal: Universal,
  teeth: readonly PlacedTooth[],
  template: Template,
): Measurement<Size> {
  const placed = teeth.find((t) => t.universal === universal && !t.auxiliary);
  const authored = template.teeth[universal];
  if (!placed || !authored) return fail(`${toFDI(universal)} not in the design`);

  const size = {
    width: authored.width * Math.abs(placed.scaleX),
    length: authored.length * Math.abs(placed.scaleY),
    position: placed.position,
  };
  if (!(size.width > 0 && size.length > 0 && Number.isFinite(size.width + size.length))) {
    return fail(`${toFDI(universal)} has no size`);
  }
  return ok(size);
}

function sideTeeth(
  side: Side,
  teeth: readonly PlacedTooth[],
  template: Template,
): SideTeethMeasurements {
  const names = UPPER_ANTERIORS[side];
  const central = sizeOf(names.central, teeth, template);
  if (!central.ok) {
    return {
      centralWidthToLength: central,
      lateralToCentral: central,
      canineToCentral: central,
    };
  }

  const againstCentral = (universal: Universal): Measurement<number> => {
    const tooth = sizeOf(universal, teeth, template);
    return tooth.ok ? ok(tooth.value.width / central.value.width) : tooth;
  };

  return {
    centralWidthToLength: ok(central.value.width / central.value.length),
    lateralToCentral: againstCentral(names.lateral),
    canineToCentral: againstCentral(names.canine),
  };
}

/**
 * The tooth numbers, per side.
 *
 * `teeth` is the design as shown: the fit with the per-tooth edits applied.
 * `template` is the one it was fitted with.
 */
export function toothMeasurements(
  teeth: readonly PlacedTooth[] | null,
  template: Template | undefined,
): ToothMeasurements {
  if (!teeth || !template) {
    const none = fail<number>('no design yet');
    const empty = { centralWidthToLength: none, lateralToCentral: none, canineToCentral: none };
    return { right: empty, left: empty };
  }
  return {
    right: sideTeeth('right', teeth, template),
    left: sideTeeth('left', teeth, template),
  };
}

// --- dental midline -------------------------------------------------------------

/**
 * How far the designed dental midline sits from the facial midline.
 *
 * The dental midline point is halfway between the inner (mesial) edges of 11
 * and 21 at their biting edge, as designed: each edge is half the tooth's own
 * width from its incisal midpoint, along the face's horizontal, rotation
 * ignored. It is taken into the photograph with the same face frame the design
 * is drawn with. The distance is along the pupil line, to the point on the
 * facial midline handle line at the same height (measured square to the pupil
 * line), and is expressed as a share of the average width of 11 and 21.
 *
 * Both centrals must be shown.
 */
export function dentalMidlineOffset(
  refs: FacialReferences | null,
  teeth: readonly PlacedTooth[] | null,
  template: Template | undefined,
): Measurement<Offset> {
  if (!teeth || !template) return fail('no design yet');
  if (!refs) return fail('no facial references');

  const right = sizeOf(UPPER_ANTERIORS.right.central, teeth, template);
  if (!right.ok) return right;
  const left = sizeOf(UPPER_ANTERIORS.left.central, teeth, template);
  if (!left.ok) return left;

  // The same checks computeFaceFrame makes, in the words the other rows use.
  const axes = pupilAxes(refs);
  if (!axes) return fail('pupils on top of each other');
  const { u, v } = axes;
  const top = refs.midlineTop;
  const down = sub(refs.midlineBottom, top);
  if (length(down) < EPSILON) return fail('midline has no length');
  if (distance(refs.leftAla, refs.rightAla) < EPSILON) {
    return fail('nasal wings on top of each other');
  }
  if (refs.lipCurve.length < 2) return fail('lip line needs two points');
  const steep = dot(down, v);
  if (Math.abs(steep) < EPSILON * length(down)) {
    return fail('midline runs along the pupil line');
  }

  const frame = computeFaceFrame(refs);

  // Inner edges, in face units: 11 sits toward -x and its inner edge is its +x
  // side; 21 the other way round.
  const r = right.value;
  const l = left.value;
  const dental = applyMatrix(faceToWorldMatrix(frame), {
    x: (r.position.x + r.width / 2 + (l.position.x - l.width / 2)) / 2,
    y: (r.position.y + l.position.y) / 2,
  });

  // The facial midline at the dental point's height.
  const facial = {
    x: top.x + down.x * (dot(sub(dental, top), v) / steep),
    y: top.y + down.y * (dot(sub(dental, top), v) / steep),
  };

  const offset = dot(sub(dental, facial), u);
  const centralWidth = ((r.width + l.width) / 2) * frame.scale;
  return ok({ fraction: Math.abs(offset) / centralWidth, side: sideOf(offset) });
}

// --- formatting ----------------------------------------------------------------

const unavailable = (reason: string, where: Where): string =>
  where === 'panel' ? `- (${reason})` : '-';

/**
 * Shared by the angle formats. Rounded first, so a value that shows as 0.0 is
 * level and names no side, even when a hair off zero.
 */
function formatAngle(
  m: Measurement<Angle>,
  where: Where,
  wording: (side: Side) => string,
): string {
  if (!m.ok) return unavailable(m.reason, where);
  const rounded = Math.round(m.value.degrees * 10) / 10;
  const text = `${rounded.toFixed(1)}°`;
  return rounded === 0 || m.value.side === null ? text : `${text}, ${wording(m.value.side)}`;
}

/** Head tilt or lip line cant: "2.1°, patient's left side lower". */
export const formatTilt = (m: Measurement<Angle>, where: Where): string =>
  formatAngle(m, where, (side) => `patient's ${side} side lower`);

/** Midline cant: "2.1°, lower end toward patient's left". */
export const formatMidline = (m: Measurement<Angle>, where: Where): string =>
  formatAngle(m, where, (side) => `lower end toward patient's ${side}`);

/** The dental midline offset: "9%, toward patient's left", or "0%". */
export function formatOffset(m: Measurement<Offset>, where: Where): string {
  if (!m.ok) return unavailable(m.reason, where);
  const rounded = Math.round(m.value.fraction * 100);
  const text = `${rounded}%`;
  return rounded === 0 || m.value.side === null
    ? text
    : `${text}, toward patient's ${m.value.side}`;
}

/** A tooth number as a whole percent: "80%". */
export function formatPercent(m: Measurement<number>, where: Where): string {
  if (!m.ok) return unavailable(m.reason, where);
  return `${Math.round(m.value * 100)}%`;
}
