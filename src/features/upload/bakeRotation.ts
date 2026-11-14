/**
 * Applying a rotation to the pixels themselves.
 *
 * Rotation used to be carried as a number beside the photo and re-applied by
 * every consumer at render time. That leaked a coordinate system into eight
 * call sites, and four of them got it wrong in the same way: the detector ran
 * on raw pixels while landmark coordinates were scaled by the *oriented*
 * dimensions, so a photo that needed the rotate button produced transposed
 * references, a misfitted arch, enamel colour sampled from the cheek, and an
 * export that letterboxed the photo inside a swapped-axis box.
 *
 * Baking removes the class of bug rather than the instances: after this, every
 * photo in the store is already the right way up, and no consumer needs to know
 * rotation ever existed. That is what normalising orientation at load means.
 */

import type { Photo } from '../../state/store.js';
import type { QuarterTurns } from '../../domain/imageOrientation.js';
import { normalizeTurns, orientedSize, swapsAxes } from '../../domain/imageOrientation.js';

export class RotationError extends Error {}

/**
 * Return a new `Photo` rotated by `turns` quarter turns.
 *
 * PNG, not JPEG: a clinical photograph may be rotated more than once, and
 * re-encoding lossily each time would visibly degrade the enamel detail the
 * whole design is judged on.
 */
export async function bakeRotation(
  photo: Photo,
  turns: number,
): Promise<Photo> {
  const quarter = normalizeTurns(turns);
  if (quarter === 0) return photo;

  const image = await decode(photo.url);
  const size = orientedSize({ width: photo.width, height: photo.height }, quarter);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new RotationError('Could not rotate the photo');

  // Rotate about the centre of the *output* box, then draw the source centred
  // on that origin. Swapping the axes is already handled by the canvas size.
  ctx.translate(size.width / 2, size.height / 2);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.drawImage(image, -photo.width / 2, -photo.height / 2);

  const blob = await toBlob(canvas);
  URL.revokeObjectURL(photo.url);

  return {
    url: URL.createObjectURL(blob),
    width: size.width,
    height: size.height,
  };
}

/**
 * Bake a legacy stored rotation. Cases saved before rotation was baked carry a
 * non-zero value; restoring them applies it once and the field is never used
 * again.
 */
export const bakeStoredRotation = (
  photo: Photo,
  stored: QuarterTurns | undefined,
): Promise<Photo> =>
  stored && swapsAxesOrTurns(stored) ? bakeRotation(photo, stored) : Promise.resolve(photo);

const swapsAxesOrTurns = (turns: QuarterTurns): boolean =>
  swapsAxes(turns) || normalizeTurns(turns) === 2;

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new RotationError('Could not read the photo'));
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new RotationError('Could not encode the rotated photo'));
    }, 'image/png');
  });
}
