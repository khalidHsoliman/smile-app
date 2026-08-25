/**
 * Decoding an uploaded file into a `Photo` (spec 3.1).
 *
 * Impure by nature -- it touches Blob, ImageBitmap and object URLs -- so it
 * lives in the feature, not in `domain/`. The orientation arithmetic it defers
 * to `domain/imageOrientation`.
 */

import type { Photo } from '../../state/store.js';

/** Files we accept on the drop tiles. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Refuse absurd uploads early. A 40MP phone photo is ~8000px on its long edge;
 * beyond that we are almost certainly looking at a mistake, and decoding it
 * would stall the tab.
 */
const MAX_EDGE = 12000;
const MAX_BYTES = 40 * 1024 * 1024;

export class PhotoLoadError extends Error {}

/**
 * Decode `file` into a `Photo`.
 *
 * Orientation is delegated to the browser via `imageOrientation: 'from-image'`,
 * which honours the EXIF tag during decode. The spec warns against trusting
 * this completely (11.4); the manual rotate control on the tile is the
 * mitigation, and `photo.rotation` is applied on top of whatever the decoder
 * produced.
 */
export async function loadPhoto(file: File): Promise<Photo> {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    throw new PhotoLoadError(`Unsupported image type: ${file.type || 'unknown'}`);
  }
  if (file.size > MAX_BYTES) {
    throw new PhotoLoadError('Image is larger than 40 MB');
  }

  const { width, height } = await measure(file);
  if (width > MAX_EDGE || height > MAX_EDGE) {
    throw new PhotoLoadError(`Image is too large: ${width} x ${height} px`);
  }

  return { url: URL.createObjectURL(file), width, height, rotation: 0 };
}

/**
 * Intrinsic size of the decoded image, with EXIF orientation already applied.
 *
 * `createImageBitmap` is the accurate path and is disposed immediately -- an
 * undisposed bitmap holds the full decoded surface in memory. Safari versions
 * that reject the options bag fall back to an `<img>` decode, which applies
 * EXIF orientation natively.
 */
async function measure(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the <img> path.
    } finally {
      bitmap?.close();
    }
  }
  return measureViaImage(file);
}

function measureViaImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoLoadError('Could not decode the image'));
    };

    img.src = url;
  });
}
