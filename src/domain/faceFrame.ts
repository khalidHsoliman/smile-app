/**
 * The face frame: the coordinate system every design lives in (spec 5.2).
 *
 * Design geometry is authored in normalized face units and converted to pixels
 * only at render time. That is what makes a design invariant to photo
 * resolution, crop, zoom and head tilt -- and it eliminates the family of bugs
 * where the design drifts when the photo is re-fitted to the viewport
 * (spec 11.3).
 *
 * The frame is *derived*, never stored alongside its inputs: it is recomputed
 * from the references whenever they change (spec 9.1).
 *
 * Face-unit conventions:
 *   - origin (0,0) is the midline crossed with the lip line -- the anchor the
 *     dental midline is placed against.
 *   - +x runs towards the patient's left (the viewer's right), along the
 *     interpupillary line.
 *   - +y runs down the face, perpendicular to +x.
 *   - one unit is the inter-alar width, the classic DSD width reference.
 */

import {
  type Matrix2D,
  type Vec2,
  angleOf,
  applyMatrix,
  compose,
  distance,
  invert,
  normalize,
  perpendicular,
  scaling,
  sub,
  vec,
} from './geometry.js';

/**
 * The four user-editable facial references (spec 5.1), in image pixels.
 *
 * These are what the clinician drags. Every one of them is a judgment call --
 * especially the midline -- so the detector only seeds them.
 */
export interface FacialReferences {
  /** Pupil centres. Defines roll: teeth are levelled against this, not the image edge. */
  leftPupil: Vec2;
  rightPupil: Vec2;
  /** Outer edges of the nostrils. Their separation is the width reference. */
  leftAla: Vec2;
  rightAla: Vec2;
  /**
   * Two points on the facial midline (glabella to chin). Stored as a segment
   * rather than a point plus an angle so the user can drag either end.
   */
  midlineTop: Vec2;
  midlineBottom: Vec2;
  /**
   * The lower border of the upper lip when smiling, ordered left to right.
   * Controls vertical placement and the smile arc the incisal edges follow.
   */
  lipCurve: Vec2[];
  /**
   * The mouth aperture as a closed ring, in image pixels.
   *
   * The design is clipped to this so teeth cannot paint over the lips
   * (spec 7.1). Optional: it comes from the detector, and a hand-placed set of
   * references has no aperture -- the design then renders unmasked rather than
   * vanishing entirely.
   */
  mouthAperture?: Vec2[];
}

/** The derived orthonormal frame. */
export interface FaceFrame {
  /** Midline crossed with the lip line: the design anchor, in image pixels. */
  origin: Vec2;
  /** Unit vector along the interpupillary line, towards the patient's left. */
  xAxis: Vec2;
  /** Unit vector perpendicular to xAxis, pointing down the face. */
  yAxis: Vec2;
  /** Pixels per face unit -- the inter-alar width. */
  scale: number;
  /** Roll of xAxis relative to image horizontal, radians. */
  roll: number;
}

export class FaceFrameError extends Error {}

/**
 * "Left" and "right" in the reference names are the *patient's*, which is the
 * clinical convention. A frontal photograph puts the patient's left on the
 * viewer's right, so the patient's left pupil has the larger image x.
 *
 * Uploads are occasionally mirrored, so the orientation is measured from the
 * points rather than assumed -- otherwise a mirrored photo silently flips the
 * whole frame and every tooth lands on the wrong side.
 */
function facingAxis(patientLeft: Vec2, patientRight: Vec2): Vec2 {
  const axis = normalize(sub(patientLeft, patientRight));
  return axis.x < 0 ? vec(-axis.x, -axis.y) : axis;
}

/**
 * Derive the frame from the references.
 *
 * Throws when the references are degenerate -- coincident pupils or alae, or a
 * midline with no length. Callers surface that as "adjust the references",
 * never as a silent identity frame: a wrong-but-plausible frame would place the
 * entire arch incorrectly with no visible cause.
 */
export function computeFaceFrame(refs: FacialReferences): FaceFrame {
  const interAlar = distance(refs.leftAla, refs.rightAla);
  if (interAlar < 1e-6) {
    throw new FaceFrameError('The nasal wing markers are on top of each other');
  }
  if (distance(refs.leftPupil, refs.rightPupil) < 1e-6) {
    throw new FaceFrameError('The pupil markers are on top of each other');
  }
  if (refs.lipCurve.length < 2) {
    throw new FaceFrameError('The lip line needs at least two points');
  }

  // Roll comes from the pupils: heads are always slightly tilted (spec 5.1).
  const xAxis = facingAxis(refs.leftPupil, refs.rightPupil);

  return {
    origin: midlineLipIntersection(refs),
    xAxis,
    yAxis: perpendicular(xAxis),
    scale: interAlar,
    roll: angleOf(xAxis),
  };
}

/**
 * Where the facial midline crosses the lip curve.
 *
 * The lip curve is a polyline, so this walks its segments looking for a
 * crossing. If the midline misses the curve entirely -- an off-centre or
 * too-short lip line, which happens constantly while the user is still
 * dragging -- it falls back to the point on the curve nearest the midline. That
 * keeps the frame usable mid-edit instead of throwing on every intermediate
 * drag position.
 */
function midlineLipIntersection(refs: FacialReferences): Vec2 {
  const a = refs.midlineTop;
  const b = refs.midlineBottom;
  const dir = sub(b, a);
  if (Math.hypot(dir.x, dir.y) < 1e-6) {
    throw new FaceFrameError('The midline has no length');
  }

  let best: { point: Vec2; distance: number } | null = null;

  for (let i = 0; i < refs.lipCurve.length - 1; i++) {
    const p = refs.lipCurve[i]!;
    const q = refs.lipCurve[i + 1]!;
    const candidate = crossingOrNearest(a, b, p, q);
    if (candidate.distance === 0) return candidate.point;
    if (!best || candidate.distance < best.distance) best = candidate;
  }

  if (!best) throw new FaceFrameError('The lip line needs at least two points');
  return best.point;
}

/**
 * Where segment `p`-`q` meets the infinite line through `a`-`b`, or the end of
 * the segment closest to that line when they do not meet. `distance` is 0
 * exactly when a true crossing was found.
 */
function crossingOrNearest(
  a: Vec2,
  b: Vec2,
  p: Vec2,
  q: Vec2,
): { point: Vec2; distance: number } {
  const lineNormal = perpendicular(normalize(sub(b, a)));

  const signedDistance = (point: Vec2): number => {
    const rel = sub(point, a);
    return rel.x * lineNormal.x + rel.y * lineNormal.y;
  };

  const dp = signedDistance(p);
  const dq = signedDistance(q);

  /*
   * The segment lies exactly along the line -- both endpoints on the midline,
   * reachable while dragging lip handles. `dp/(dp-dq)` would be 0/0 = NaN and
   * propagate a NaN origin into every rendered tooth with no error raised, so
   * the segment's own midpoint is taken instead.
   */
  if (dp === 0 && dq === 0) {
    return { point: vec((p.x + q.x) / 2, (p.y + q.y) / 2), distance: 0 };
  }

  // The segment straddles the line: interpolate to the exact crossing.
  if (dp === 0 || dq === 0 || dp * dq < 0) {
    const t = dp / (dp - dq);
    return {
      point: vec(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t),
      distance: 0,
    };
  }

  return Math.abs(dp) <= Math.abs(dq)
    ? { point: p, distance: Math.abs(dp) }
    : { point: q, distance: Math.abs(dq) };
}

/**
 * Face units -> image pixels.
 *
 * Built once and reused. The frame axes are already orthonormal, so this is a
 * scale followed by the rotation-plus-translation the axes describe.
 */
export function faceToWorldMatrix(frame: FaceFrame): Matrix2D {
  const oriented: Matrix2D = {
    a: frame.xAxis.x,
    b: frame.xAxis.y,
    c: frame.yAxis.x,
    d: frame.yAxis.y,
    e: frame.origin.x,
    f: frame.origin.y,
  };
  return compose(scaling(frame.scale), oriented);
}

/** Image pixels -> normalized face units. */
export const worldToFaceMatrix = (frame: FaceFrame): Matrix2D =>
  invert(faceToWorldMatrix(frame));

/**
 * Convenience wrappers. For more than a handful of points, build the matrix
 * once with `faceToWorldMatrix` rather than paying for it per point.
 */
export const toFace = (p: Vec2, frame: FaceFrame): Vec2 =>
  applyMatrix(worldToFaceMatrix(frame), p);

export const toWorld = (p: Vec2, frame: FaceFrame): Vec2 =>
  applyMatrix(faceToWorldMatrix(frame), p);

/** A frame for a perfectly level face -- for template authoring and checks. */
export const identityFrame = (origin: Vec2 = vec(0, 0), scale = 1): FaceFrame => ({
  origin,
  xAxis: vec(1, 0),
  yAxis: vec(0, 1),
  scale,
  roll: 0,
});
