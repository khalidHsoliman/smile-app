/**
 * MediaPipe Face Landmarker wrapper.
 *
 * Both the WASM runtime and the model are served from our own origin rather
 * than a CDN. That is not incidental: the application is a no-backend, patient
 * photos never leave the browser tool, and a CDN fetch at analysis time would
 * be a third-party request on a page handling clinical photographs. It also
 * means the tool works offline once loaded.
 *
 * Loading is memoized and detection is serialized -- a user can outrun both
 *.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '../domain/deriveReferences.js';

const WASM_PATH = '/wasm';
const MODEL_PATH = '/models/face_landmarker.task';

export class FaceDetectionError extends Error {}

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * Load the detector once and reuse it. The WASM runtime plus a 3.7 MB model is
 * far too expensive to repeat, and two concurrent callers must not each start a
 * load -- hence memoizing the promise rather than the resolved value.
 */
export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        // Refinement adds the iris landmarks (468/473), which give far better
        // pupil centres than eye corners do.
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    } catch (cause) {
      // Let a later attempt retry rather than caching the failure forever.
      landmarkerPromise = null;
      throw new FaceDetectionError(
        `Could not load the face detector: ${(cause as Error).message}`,
      );
    }
  })();

  return landmarkerPromise;
}

/**
 * Serializes detection. A user who re-uploads or rotates while a detection is
 * in flight would otherwise have two runs racing to write the same references,
 * and the loser could land last.
 */
let queue: Promise<unknown> = Promise.resolve();

export function detectLandmarks(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<NormalizedLandmark[]> {
  const run = queue.then(async () => {
    const landmarker = await loadFaceLandmarker();
    const result = landmarker.detect(image);

    const face = result.faceLandmarks[0];
    if (!face || face.length === 0) {
      throw new FaceDetectionError(
        'No face was found in the photo. Check that it is frontal and well lit.',
      );
    }
    return face.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  });

  // Keep the chain alive regardless of this run's outcome.
  queue = run.catch(() => undefined);
  return run;
}

/** Decode an object URL into an element the detector accepts. */
export function decodeForDetection(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new FaceDetectionError('Could not decode the photo'));
    img.src = url;
  });
}
