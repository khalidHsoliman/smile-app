/**
 * Carrying the face frame across a photo alignment.
 *
 * The design is authored against the smile photo, so showing it on the
 * retracted view means expressing the same frame in the retracted photo's
 * coordinates: invert the alignment (which maps retracted -> smile) and apply
 * it to the frame's origin and axes.
 *
 * Shared rather than written at each call site. The report and the design-step
 * reference both need it, and two copies of a derivation that decides where
 * teeth land is exactly the drift that makes an export stop matching the screen.
 */

import type { FaceFrame, FacialReferences } from './faceFrame.js';
import {
  applyMatrix,
  applyMatrixToVector,
  invert,
  normalize,
  type Matrix2D,
} from './geometry.js';
import { scaleOf } from './similarity.js';

/**
 * The face frame as seen in the retracted photo.
 *
 * Returns null without an alignment: overlaying an unaligned design would place
 * teeth confidently in the wrong place, which is worse than not showing them.
 */
export function alignedFaceFrame(
  frame: FaceFrame | null,
  alignment: Matrix2D | null,
): FaceFrame | null {
  if (!frame || !alignment) return null;

  const toRetracted = invert(alignment);
  return {
    ...frame,
    origin: applyMatrix(toRetracted, frame.origin),
    // Axes are directions, so translation must not apply -- and they are
    // re-normalised because the alignment carries a scale.
    xAxis: normalize(applyMatrixToVector(toRetracted, frame.xAxis)),
    yAxis: normalize(applyMatrixToVector(toRetracted, frame.yAxis)),
    scale: frame.scale / scaleOf(alignment),
  };
}

/**
 * The references with the mouth aperture removed.
 *
 * The aperture is in smile-photo coordinates; masking the retracted view with
 * it would clip the design against the wrong mouth entirely. The key is omitted
 * rather than set to undefined, which `exactOptionalPropertyTypes` rightly
 * treats as a different thing.
 */
export function withoutAperture(
  refs: FacialReferences | null,
): FacialReferences | null {
  if (!refs) return null;
  const { mouthAperture: _omitted, ...rest } = refs;
  return rest;
}
