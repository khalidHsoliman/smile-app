/**
 * Per-tooth edits (spec 6.5, 11.6).
 *
 * **Edits are deltas applied on top of the computed fit, never replacements
 * for it.** That is the whole design, and spec 11.6 is emphatic about it: if a
 * per-tooth edit replaced the fitted placement, the next global slider change
 * would either destroy the manual work or have to be blocked while editing.
 * As deltas, the two compose -- a clinician can nudge tooth 9, then change the
 * arch width, and the nudge survives.
 *
 * All values are in face-frame units, matching the fit they are applied to.
 *
 * Pure: no React, no store, no DOM.
 */

import { type Vec2, vec } from './geometry.js';
import { mirrorOf, type Universal } from './teeth.js';
import type { PlacedTooth } from './fitting.js';

/** A single tooth's manual adjustment, relative to its fitted placement. */
export interface ToothEdit {
  /** Translation in face units. */
  offset: Vec2;
  /** Extra rotation in radians, on top of the arch splay. */
  rotation: number;
  /** Multiplier on the fitted width. */
  scaleX: number;
  /** Multiplier on the fitted length. */
  scaleY: number;
}

export type ToothEdits = Partial<Record<Universal, ToothEdit>>;

export const IDENTITY_EDIT: ToothEdit = {
  offset: { x: 0, y: 0 },
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

/** True when an edit leaves the tooth exactly as fitted. */
export const isIdentityEdit = (edit: ToothEdit): boolean =>
  edit.offset.x === 0 &&
  edit.offset.y === 0 &&
  edit.rotation === 0 &&
  edit.scaleX === 1 &&
  edit.scaleY === 1;

/**
 * Limits on a single edit.
 *
 * Generous enough for any real correction, tight enough that a runaway drag
 * cannot fling a tooth off the face or invert it. A negative scale would mirror
 * the outline, which is a different operation with its own explicit action.
 */
const LIMITS = {
  offset: 0.5, // face units -- half the inter-alar width in any direction
  rotation: Math.PI / 6, // 30 degrees
  scaleMin: 0.4,
  scaleMax: 2.5,
} as const;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Clamp an edit into the usable range. */
export function clampEdit(edit: ToothEdit): ToothEdit {
  return {
    offset: vec(
      clamp(edit.offset.x, -LIMITS.offset, LIMITS.offset),
      clamp(edit.offset.y, -LIMITS.offset, LIMITS.offset),
    ),
    rotation: clamp(edit.rotation, -LIMITS.rotation, LIMITS.rotation),
    scaleX: clamp(edit.scaleX, LIMITS.scaleMin, LIMITS.scaleMax),
    scaleY: clamp(edit.scaleY, LIMITS.scaleMin, LIMITS.scaleMax),
  };
}

/** Combine two edits, `later` applied on top of `earlier`. */
export function composeEdits(earlier: ToothEdit, later: ToothEdit): ToothEdit {
  return clampEdit({
    offset: vec(
      earlier.offset.x + later.offset.x,
      earlier.offset.y + later.offset.y,
    ),
    rotation: earlier.rotation + later.rotation,
    scaleX: earlier.scaleX * later.scaleX,
    scaleY: earlier.scaleY * later.scaleY,
  });
}

/**
 * Apply the edits to a fitted arch.
 *
 * Runs *after* the fit, as spec 11.6 requires -- the fit itself never sees the
 * edits, so a global parameter change recomputes cleanly and the deltas
 * reapply on top of the new placement.
 */
export function applyEdits(
  teeth: readonly PlacedTooth[],
  edits: ToothEdits,
): PlacedTooth[] {
  return teeth.map((tooth) => {
    const edit = edits[tooth.universal];
    if (!edit || isIdentityEdit(edit)) return tooth;

    return {
      ...tooth,
      position: vec(
        tooth.position.x + edit.offset.x,
        tooth.position.y + edit.offset.y,
      ),
      rotation: tooth.rotation + edit.rotation,
      scaleX: tooth.scaleX * edit.scaleX,
      // scaleY carries the arch's up/down sign, so the multiplier must not
      // touch it -- multiplying by a positive keeps the sign intact.
      scaleY: tooth.scaleY * edit.scaleY,
    };
  });
}

/**
 * The mirrored form of an edit, for the contralateral partner.
 *
 * Mirroring negates the horizontal offset and the rotation, because the two
 * sides of the arch face opposite directions: nudging tooth 8 outward and its
 * partner 9 outward means opposite signs in face-frame x.
 */
export const mirrorEdit = (edit: ToothEdit): ToothEdit => ({
  offset: vec(-edit.offset.x, edit.offset.y),
  rotation: -edit.rotation,
  scaleX: edit.scaleX,
  scaleY: edit.scaleY,
});

/**
 * Apply an edit to a tooth and, in mirror mode, the reflected edit to its
 * partner (spec 6.5).
 *
 * Mirror mode is a toggle rather than a separate action because symmetric
 * adjustment is the common case -- a clinician lengthening one central almost
 * always wants the other to match.
 */
export function editTooth(
  edits: ToothEdits,
  universal: Universal,
  delta: ToothEdit,
  mirror: boolean,
): ToothEdits {
  const next: ToothEdits = { ...edits };
  const current = edits[universal] ?? IDENTITY_EDIT;
  next[universal] = composeEdits(current, delta);

  if (mirror) {
    const partner = mirrorOf(universal);
    if (partner !== universal) {
      const partnerCurrent = edits[partner] ?? IDENTITY_EDIT;
      next[partner] = composeEdits(partnerCurrent, mirrorEdit(delta));
    }
  }

  return next;
}

/** Drop the edits for these teeth, returning them to the computed fit. */
export function clearEdits(
  edits: ToothEdits,
  universals: readonly Universal[],
): ToothEdits {
  const next: ToothEdits = { ...edits };
  for (const universal of universals) delete next[universal];
  return next;
}

/** True when any tooth carries a manual adjustment. */
export const hasEdits = (edits: ToothEdits): boolean =>
  Object.values(edits).some((e) => e !== undefined && !isIdentityEdit(e));
