/**
 * The lip bounding box (spec 8.2).
 *
 * A rectangle around the mouth, in image pixels, used to crop the report's
 * close-up pair. The spec is blunt that this crop is the most persuasive image
 * in the whole report -- it is what the patient leans in to look at -- so it is
 * worth getting the framing right rather than cropping to the raw landmark
 * extent.
 *
 * Pure: derived from the aperture ring, no DOM.
 */

import type { Rect, Vec2 } from './geometry.js';

/**
 * How much room to leave around the mouth, as a fraction of its own size.
 *
 * A tight crop on the aperture alone looks clinical and slightly alarming --
 * disembodied teeth. Including some lip and the surrounding skin keeps the
 * image recognisably a smile. Horizontal padding is larger because a smile
 * reads best with the corners of the mouth well inside the frame.
 */
const PADDING_X = 0.38;
const PADDING_Y = 0.85;

/**
 * The aspect ratio the close-up is framed to.
 *
 * A mouth is far wider than it is tall, and cropping to its natural ratio
 * yields a letterbox strip that sits badly in a report and worse in a
 * messaging app. 4:3 gives the crop room above and below without losing the
 * width that makes the smile arc legible.
 */
const TARGET_ASPECT = 4 / 3;

/**
 * Frame a close-up crop around the mouth aperture.
 *
 * The result is clamped to the image, so a mouth near an edge yields a smaller
 * but still valid rectangle rather than one with negative coordinates.
 */
export function lipBoxFrom(
  aperture: readonly Vec2[],
  image: { width: number; height: number },
): Rect | null {
  if (aperture.length < 3) return null;

  const xs = aperture.map((p) => p.x);
  const ys = aperture.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const mouthWidth = maxX - minX;
  const mouthHeight = maxY - minY;
  if (mouthWidth <= 0 || mouthHeight <= 0) return null;

  const centre: Vec2 = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };

  // Pad first, then grow whichever axis is short of the target ratio -- never
  // shrink, or the padding just fought for would be cropped away again.
  let width = mouthWidth * (1 + PADDING_X * 2);
  let height = mouthHeight * (1 + PADDING_Y * 2);

  if (width / height < TARGET_ASPECT) width = height * TARGET_ASPECT;
  else height = width / TARGET_ASPECT;

  return clampToImage({ centre, width, height }, image);
}

/**
 * Fit a centred box inside the image.
 *
 * Shrinks before it slides: a box larger than the image is scaled down keeping
 * its aspect ratio, then nudged inside. Sliding first would push the mouth
 * off-centre in the crop.
 */
function clampToImage(
  box: { centre: Vec2; width: number; height: number },
  image: { width: number; height: number },
): Rect {
  const scale = Math.min(
    1,
    image.width / box.width,
    image.height / box.height,
  );
  const width = box.width * scale;
  const height = box.height * scale;

  const x = Math.max(0, Math.min(image.width - width, box.centre.x - width / 2));
  const y = Math.max(0, Math.min(image.height - height, box.centre.y - height / 2));

  return { x, y, width, height };
}

/** Move and resize a lip box, keeping it inside the image. Used by the nudge UI. */
export function adjustLipBox(
  box: Rect,
  delta: { dx?: number; dy?: number; scale?: number },
  image: { width: number; height: number },
): Rect {
  const scale = delta.scale ?? 1;
  const centre: Vec2 = {
    x: box.x + box.width / 2 + (delta.dx ?? 0),
    y: box.y + box.height / 2 + (delta.dy ?? 0),
  };
  return clampToImage(
    { centre, width: box.width * scale, height: box.height * scale },
    image,
  );
}
