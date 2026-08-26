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

/**
 * The upper border of the *lower* lip, ordered from the image's left back to
 * its right -- the reverse of `UPPER_LIP_LOWER_BORDER`, so concatenating the
 * two walks the mouth aperture as one closed ring.
 *
 * 78 and 308 are the mouth corners and belong to both borders, so they are
 * omitted here to avoid duplicating them in the ring.
 */
export const LOWER_LIP_UPPER_BORDER = [
  324, 318, 402, 317, 14, 87, 178, 88, 95,
] as const;

/**
 * The mouth aperture, as one closed ring of landmark indices.
 *
 * This is the inner opening between the lips -- the region where teeth are
 * actually visible. It is the clip path the design is masked to (spec 7.1);
 * without it the template teeth paint straight over the lips and every design
 * reads as pasted on.
 */
export const MOUTH_APERTURE = [
  ...UPPER_LIP_LOWER_BORDER,
  ...LOWER_LIP_UPPER_BORDER,
] as const;

/**
 * Mesh vertices used to align the retracted photo to the smile photo.
 *
 * Chosen from the *rigid upper face*: eye corners, the nose midline chain from
 * nasion to tip, the alae, glabella and forehead. Everything below the nose is
 * excluded on purpose -- the retractors displace the lips and cheeks, and the
 * jaw usually sits differently between the two shots, so the chin and mouth
 * would feed the fit exactly the deformation it must not learn.
 *
 * A subtlety that lowers the risk here: for *matching*, an index does not need
 * its anatomical label to be correct. It needs to be the SAME mesh vertex in
 * both photographs -- the model guarantees that by construction -- and to sit
 * on a rigid part of the face. A vertex that turned out to be "bridge of nose,
 * slightly left" rather than "nasion" would align just as well.
 */
export const MATCH_STABLE_INDICES = [
  33, 133, 362, 263, // eye corners (outer/inner, both eyes)
  10, // forehead midline
  9, // glabella
  168, 6, 197, 195, 5, // nose midline, nasion down to the supratip
  1, // nose tip
  48, 278, // nasal wings
] as const;

/** Point counts the model is known to emit. */
export const LANDMARKS_WITH_IRIS = 478;
export const LANDMARKS_WITHOUT_IRIS = 468;
