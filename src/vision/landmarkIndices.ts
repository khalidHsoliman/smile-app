/**
 * MediaPipe Face Landmarker indices we depend on.
 *
 * The spec is explicit that these must be verified against the current model
 * rather than trusted (spec 5.3): index maps have shifted between MediaPipe
 * versions. They are isolated in this file so that verification has exactly one
 * place to touch, and so a version bump does not send anyone hunting through
 * the derivation code.
 *
 * Geometry note: MediaPipe reports landmarks in *its own* left/right, which is
 * the image's. Our references use the patient's left/right, the clinical
 * convention -- the two are mirrored. The mapping is applied once, here, and
 * `deriveReferences` measures orientation from the points anyway, so a mirrored
 * upload still resolves correctly.
 */

/**
 * Iris centres, present only when `outputFaceBlendshapes` refinement is on.
 * With refinement the model emits 478 points; without it, 468 and no irises.
 */
export const IRIS_CENTER_IMAGE_RIGHT = 468;
export const IRIS_CENTER_IMAGE_LEFT = 473;

/**
 * Eye-corner fallbacks, used when the model returns only 468 points. Averaging
 * the inner and outer corner approximates the pupil closely enough to seed a
 * handle the clinician will adjust anyway.
 */
export const EYE_IMAGE_RIGHT = { inner: 133, outer: 33 } as const;
export const EYE_IMAGE_LEFT = { inner: 362, outer: 263 } as const;

/** Outer edges of the nostrils -- the inter-alar width reference. */
export const ALA_IMAGE_RIGHT = 48;
export const ALA_IMAGE_LEFT = 278;

/** Midline anchors: glabella (between the brows) down to the chin. */
export const GLABELLA = 9;
export const NOSE_TIP = 1;
export const CHIN = 152;

/**
 * The lower border of the upper lip, ordered from the image's right to its
 * left. This is the smile curve the incisal edges are laid against, so it is
 * sampled across the full width rather than at the centre alone.
 */
export const UPPER_LIP_LOWER_BORDER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
] as const;

/** Point counts the model is known to emit. */
export const LANDMARKS_WITH_IRIS = 478;
export const LANDMARKS_WITHOUT_IRIS = 468;
