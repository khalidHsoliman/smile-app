/**
 * Tooth numbering: the backbone of the data model.
 *
 * Universal numbering (1-32) is the canonical internal ID. FDI is a display
 * concern only -- never store it, never key anything by it.
 */

/** Canonical tooth identifier: Universal numbering, 1-32. */
export type Universal = number;

/** Which jaw a tooth belongs to. */
export type Arch = 'upper' | 'lower';

export const UPPER_RANGE = [1, 16] as const;
export const LOWER_RANGE = [17, 32] as const;

/** Upper central incisors. The aesthetic centrepiece and the fitting anchor. */
export const UPPER_CENTRALS = [8, 9] as const;
/** Lower central incisors. */
export const LOWER_CENTRALS = [24, 25] as const;

/**
 * Universal -> FDI, indexed by `universal - 1`.
 *
 * This ordering is battle-tested; it is transcribed verbatim from the domain
 * specification and must not be "tidied".
 */
const UNIVERSAL_TO_FDI = [
  18, 17, 16, 15, 14, 13, 12, 11, // universal 1-8   -> upper right
  21, 22, 23, 24, 25, 26, 27, 28, // universal 9-16  -> upper left
  38, 37, 36, 35, 34, 33, 32, 31, // universal 17-24 -> lower left
  41, 42, 43, 44, 45, 46, 47, 48, // universal 25-32 -> lower right
] as const;

/** True if `n` is a valid universal tooth number. */
export const isUniversal = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= 32;

/** Convert a universal number to its FDI two-digit equivalent, for display. */
export function toFDI(universal: Universal): number {
  const fdi = UNIVERSAL_TO_FDI[universal - 1];
  if (fdi === undefined) {
    throw new RangeError(`Not a universal tooth number: ${universal}`);
  }
  return fdi;
}

/** Convert an FDI two-digit number back to universal. Inverse of `toFDI`. */
export function fromFDI(fdi: number): Universal {
  const index = UNIVERSAL_TO_FDI.indexOf(fdi as (typeof UNIVERSAL_TO_FDI)[number]);
  if (index === -1) throw new RangeError(`Not an FDI tooth number: ${fdi}`);
  return index + 1;
}

/**
 * True for the maxillary arch. This single predicate drives grouping, template
 * loading, arch fitting and layer visibility -- it is centralised on purpose.
 */
export const isUpper = (universal: Universal): boolean => universal <= 16;

/** The arch a tooth belongs to. */
export const archOf = (universal: Universal): Arch =>
  isUpper(universal) ? 'upper' : 'lower';

/**
 * The contralateral partner: the same tooth on the other side of the midline.
 *
 * Upper (1-16): partner = 17 - n   ->  8 <-> 9
 * Lower (17-32): partner = 49 - n  ->  24 <-> 25
 */
export function mirrorOf(universal: Universal): Universal {
  if (!isUniversal(universal)) {
    throw new RangeError(`Not a universal tooth number: ${universal}`);
  }
  return isUpper(universal) ? 17 - universal : 49 - universal;
}

/** The central incisors of an arch -- the anchors arch fitting lays out from. */
export const centralsOf = (arch: Arch): readonly [number, number] =>
  arch === 'upper' ? UPPER_CENTRALS : LOWER_CENTRALS;

/** The inclusive universal-number bounds of an arch. */
export const rangeOf = (arch: Arch): readonly [number, number] =>
  arch === 'upper' ? UPPER_RANGE : LOWER_RANGE;
