/**
 * Correspondences for photo matching, from raw landmarks (spec 15).
 *
 * Both photographs are run through the same face model, so index i in one
 * result and index i in the other are the same mesh vertex on the same face.
 * That gives a dense, automatic set of correspondences with no clicking --
 * restricted to the rigid upper face, because the retractors deform everything
 * below the nose (see MATCH_STABLE_INDICES).
 *
 * Iris centres are appended when both detections carry them: they are the most
 * precisely localised points the model produces.
 */

import type { NormalizedLandmark } from '../domain/deriveReferences.js';
import type { PointPair } from '../domain/similarity.js';
import {
  IRIS_CENTER_IMAGE_LEFT,
  IRIS_CENTER_IMAGE_RIGHT,
  LANDMARKS_WITH_IRIS,
  MATCH_STABLE_INDICES,
} from './landmarkIndices.js';

interface Size {
  width: number;
  height: number;
}

export function buildMatchPairs(
  retracted: readonly NormalizedLandmark[],
  smile: readonly NormalizedLandmark[],
  retractedSize: Size,
  smileSize: Size,
): PointPair[] {
  const indices: number[] = [...MATCH_STABLE_INDICES];
  if (
    retracted.length >= LANDMARKS_WITH_IRIS &&
    smile.length >= LANDMARKS_WITH_IRIS
  ) {
    indices.push(IRIS_CENTER_IMAGE_RIGHT, IRIS_CENTER_IMAGE_LEFT);
  }

  const pairs: PointPair[] = [];
  for (const index of indices) {
    const s = retracted[index];
    const t = smile[index];
    if (!s || !t) continue;
    pairs.push({
      source: { x: s.x * retractedSize.width, y: s.y * retractedSize.height },
      target: { x: t.x * smileSize.width, y: t.y * smileSize.height },
    });
  }
  return pairs;
}
