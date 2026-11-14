/**
 * Photo orientation.
 *
 * A meaningful fraction of real uploads arrive sideways: phones record the
 * sensor orientation in EXIF rather than rotating the pixels. Browsers mostly
 * honour that now, but we must not rely on it -- so
 * orientation is modelled here as data, and the user gets a manual rotate
 * control as the escape hatch.
 *
 * Pure: no DOM, no decoding. The upload feature supplies the numbers.
 */

/** Quarter turns clockwise. Always normalized to 0..3. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** Normalize any integer rotation into 0..3 quarter turns. */
export const normalizeTurns = (turns: number): QuarterTurns =>
  (((Math.round(turns) % 4) + 4) % 4) as QuarterTurns;

export const rotateBy = (current: number, delta: number): QuarterTurns =>
  normalizeTurns(current + delta);

/** True when the rotation swaps the width and height of the image. */
export const swapsAxes = (turns: number): boolean => normalizeTurns(turns) % 2 === 1;

export interface Size {
  width: number;
  height: number;
}

/** The on-screen size of an image after `turns` quarter turns. */
export const orientedSize = (size: Size, turns: number): Size =>
  swapsAxes(turns)
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };

/**
 * The EXIF orientation tag (1-8) expressed as the rotation we apply.
 *
 * The mirrored tags (2, 4, 5, 7) are rare and only arise from front-facing
 * cameras and some editing software. We deliberately drop the flip and keep
 * only the rotation: a mirrored *clinical* photo is a fault to be re-shot, not
 * something to silently correct, and flipping would make left and right
 * ambiguous -- which for a tool built on contralateral tooth pairs is worse
 * than a rotation the user can fix by hand.
 */
export function exifOrientationToTurns(orientation: number): QuarterTurns {
  switch (orientation) {
    case 3:
    case 4:
      return 2;
    case 5:
    case 6:
      return 1;
    case 7:
    case 8:
      return 3;
    default:
      return 0; // 1, 2, absent, or malformed
  }
}
