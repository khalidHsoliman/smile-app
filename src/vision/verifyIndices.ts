/**
 * A sanity check on the landmark indices (spec 5.3).
 *
 * The spec warns that MediaPipe index maps have shifted between versions and
 * that ours must be verified against real model output rather than trusted.
 * Verifying them needs a real face, so instead of a static assertion this runs
 * against the first photo the user actually loads and reports anything that
 * contradicts basic facial anatomy.
 *
 * It checks *relationships*, not coordinates: eyes above nose above lips, the
 * two pupils roughly level with each other, inter-alar narrower than
 * interpupillary. Any of these failing means an index is pointing at the wrong
 * part of the face -- which is exactly the failure mode a version bump causes,
 * and one that would otherwise show up as a silently wrong arch position.
 */

import type { FacialReferences } from '../domain/faceFrame.js';
import { distance } from '../domain/geometry.js';

export interface IndexCheck {
  ok: boolean;
  problems: string[];
}

export function verifyReferences(refs: FacialReferences): IndexCheck {
  const problems: string[] = [];

  const eyeY = (refs.leftPupil.y + refs.rightPupil.y) / 2;
  const alaY = (refs.leftAla.y + refs.rightAla.y) / 2;
  const lipY = refs.lipCurve.reduce((sum, p) => sum + p.y, 0) / refs.lipCurve.length;

  // Vertical ordering: eyes above nose above lips. Image y grows downward.
  if (!(eyeY < alaY)) problems.push('pupils are not above the nasal wings');
  if (!(alaY < lipY)) problems.push('nasal wings are not above the lip line');

  const interpupillary = distance(refs.leftPupil, refs.rightPupil);
  const interAlar = distance(refs.leftAla, refs.rightAla);

  // The nose is always narrower than the eyes are far apart.
  if (!(interAlar < interpupillary)) {
    problems.push('inter-alar width is not narrower than interpupillary width');
  }

  // Pupils should be near-level: a face rolled past ~35 degrees is not usable
  // for design anyway, so a larger tilt means the indices are wrong.
  const rise = Math.abs(refs.leftPupil.y - refs.rightPupil.y);
  const run = Math.abs(refs.leftPupil.x - refs.rightPupil.x);
  if (run === 0 || rise / run > 0.7) {
    problems.push('the pupils are not roughly level -- check the eye indices');
  }

  // The midline should run top-to-bottom, not sideways.
  const midlineRun = Math.abs(refs.midlineTop.x - refs.midlineBottom.x);
  const midlineRise = Math.abs(refs.midlineTop.y - refs.midlineBottom.y);
  if (midlineRise <= midlineRun) {
    problems.push('the midline is not predominantly vertical');
  }

  // The lip curve should span a meaningful width, not collapse to a point.
  const lipSpan = Math.abs(
    Math.max(...refs.lipCurve.map((p) => p.x)) -
      Math.min(...refs.lipCurve.map((p) => p.x)),
  );
  if (lipSpan < interAlar * 0.5) {
    problems.push('the lip line is implausibly narrow');
  }

  return { ok: problems.length === 0, problems };
}
