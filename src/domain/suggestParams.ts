/**
 * A per-photo starting point for the fit.
 *
 * The fixed defaults assumed an average face, and no face is average: on real
 * photographs the arch started oversized and low, and every case began with
 * the same ritual -- scale down a little, move up, adjust again. But by the
 * time the design step opens we know exactly where the visible mouth is: the
 * detected aperture. So the starting scale and vertical position are derived
 * from it, and the sliders begin as refinements rather than corrections.
 *
 * These are *suggestions* for the two placement parameters only. The clinical
 * proportions -- ratio, RED, smile curve -- keep their published defaults;
 * the aperture says where the mouth is, not what the teeth should look like.
 *
 * Pure: no React, no store, no DOM.
 */

import type { FaceFrame, FacialReferences } from './faceFrame.js';
import { worldToFaceMatrix } from './faceFrame.js';
import { applyMatrix } from './geometry.js';
import {
  CENTRAL_WIDTH_IN_FACE_UNITS,
  DEFAULT_INCISAL_DROP,
  OCCLUSAL_GAP_SCALE,
} from './fitting.js';

/**
 * How much of the aperture width the anterior six should span.
 *
 * Not most of it: the aperture runs corner to corner of the smile, and the
 * canines sit at the *inter-canine* width -- roughly 60-65% of that, with the
 * premolars, molars and buccal corridors filling the outer thirds. An early
 * value of 0.94 came from eyeballing a synthetic face whose mouth was drawn
 * far too wide for its nose; against real anatomy it would have oversized
 * every arch, which is precisely the complaint this module exists to fix.
 */
const SPAN_OF_APERTURE = 0.62;

/**
 * Where the central incisal edge should sit, as a fraction of the aperture's
 * depth below the lip line. Upper teeth dominate a natural smile: they show
 * for roughly the upper two thirds of the opening, with the lower teeth and
 * the dark of the mouth below.
 */
const DROP_OF_APERTURE = 0.72;

/**
 * The anterior six's combined width in central-incisor units at the default
 * RED proportion of 0.70: two of each of central (1.0), lateral (0.70) and
 * canine (0.49).
 */
const ANTERIOR_SIX_WIDTH = 2 * (1 + 0.7 + 0.49);

export interface SuggestedParams {
  scale: number;
  occlusalGap: number;
}

/**
 * Derive starting scale and vertical position from the mouth aperture.
 *
 * Returns null when there is no usable aperture -- hand-placed references have
 * none -- and the caller keeps the fixed defaults.
 */
export function suggestFitParams(
  refs: FacialReferences,
  frame: FaceFrame,
): SuggestedParams | null {
  const aperture = refs.mouthAperture;
  if (!aperture || aperture.length < 3) return null;

  // The aperture in face units, where the fit itself operates: x spans the
  // smile, y grows downward from the lip line at the origin.
  const toFace = worldToFaceMatrix(frame);
  const points = aperture.map((p) => applyMatrix(toFace, p));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...ys);

  // A degenerate aperture -- closed mouth, detector failure -- must not
  // produce a microscopic arch. Below these bounds the data is not a smile.
  if (width < 0.3 || depth < 0.04) return null;

  // Anterior span in face units is ANTERIOR_SIX_WIDTH * centralWidth * scale;
  // solve for the scale that makes it SPAN_OF_APERTURE of the real width.
  const scale =
    (width * SPAN_OF_APERTURE) /
    (ANTERIOR_SIX_WIDTH * CENTRAL_WIDTH_IN_FACE_UNITS);

  // The fitter already drops the edge DEFAULT_INCISAL_DROP below the lip line;
  // occlusalGap covers the difference to the aperture-derived target.
  const targetDrop = depth * DROP_OF_APERTURE;
  const occlusalGap = (targetDrop - DEFAULT_INCISAL_DROP) / OCCLUSAL_GAP_SCALE;

  return {
    scale: clamp(round2(scale), 0.1, 4),
    occlusalGap: clamp(Math.round(occlusalGap), -100, 100),
  };
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;
