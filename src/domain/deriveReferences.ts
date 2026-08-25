/**
 * Landmarks -> the four facial references (spec 5.3).
 *
 * Pure and detector-agnostic: it takes an array of normalized points and the
 * image size. That keeps the MediaPipe dependency in `vision/` and lets this be
 * exercised without a browser, a WASM runtime, or a model download.
 *
 * The output *seeds* the reference handles. Every clinician adjusts the midline
 * at least slightly -- it is a matter of professional judgment, not detection
 * accuracy -- so this only has to be close, never authoritative.
 */

import { type Vec2, midpoint, vec } from './geometry.js';
import type { FacialReferences } from './faceFrame.js';
import {
  ALA_IMAGE_LEFT,
  ALA_IMAGE_RIGHT,
  CHIN,
  EYE_IMAGE_LEFT,
  EYE_IMAGE_RIGHT,
  GLABELLA,
  IRIS_CENTER_IMAGE_LEFT,
  IRIS_CENTER_IMAGE_RIGHT,
  LANDMARKS_WITH_IRIS,
  MOUTH_APERTURE,
  UPPER_LIP_LOWER_BORDER,
} from '../vision/landmarkIndices.js';

/** A landmark as the detector reports it: normalized to 0..1 of the image. */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export class LandmarkError extends Error {}

/**
 * Convert detector output into editable references, in image pixels.
 *
 * `size` is the *displayed* image size, so rotation must already be applied by
 * the caller -- the detector sees the same pixels the user does.
 */
export function deriveReferences(
  landmarks: readonly NormalizedLandmark[],
  size: { width: number; height: number },
): FacialReferences {
  if (landmarks.length < LANDMARKS_WITH_IRIS - 10) {
    throw new LandmarkError(`Unexpected landmark count: ${landmarks.length}`);
  }

  const at = (index: number): Vec2 => {
    const point = landmarks[index];
    if (!point) throw new LandmarkError(`Landmark ${index} is missing`);
    return vec(point.x * size.width, point.y * size.height);
  };

  // Iris centres are far more accurate than eye corners, but they only exist
  // when the model runs with refinement. Fall back to the corner midpoint.
  const hasIris = landmarks.length >= LANDMARKS_WITH_IRIS;

  const imageRightPupil = hasIris
    ? at(IRIS_CENTER_IMAGE_RIGHT)
    : midpoint(at(EYE_IMAGE_RIGHT.inner), at(EYE_IMAGE_RIGHT.outer));
  const imageLeftPupil = hasIris
    ? at(IRIS_CENTER_IMAGE_LEFT)
    : midpoint(at(EYE_IMAGE_LEFT.inner), at(EYE_IMAGE_LEFT.outer));

  // MediaPipe's left/right is the image's; ours is the patient's. They mirror.
  const lipCurve = UPPER_LIP_LOWER_BORDER.map(at);
  const mouthAperture = MOUTH_APERTURE.map(at);

  return {
    leftPupil: imageRightPupil,
    rightPupil: imageLeftPupil,
    leftAla: at(ALA_IMAGE_RIGHT),
    rightAla: at(ALA_IMAGE_LEFT),
    midlineTop: at(GLABELLA),
    midlineBottom: at(CHIN),
    lipCurve,
    mouthAperture,
  };
}
