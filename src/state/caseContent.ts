/**
 * The case, as saved: what the autosave writes and what a case file holds.
 *
 * One function for both, so the browser copy and the file copy of a case can
 * never disagree about what a case is. It takes the inputs and leaves out
 * everything derived (see `StoredCase`).
 *
 * No npm imports, only types: the tests run this under plain Node.
 */

import type { AppState, PhotoKind } from './store.js';
import type { CaseContent } from './caseFile.js';
import { loadPhotoBlob } from './photoBlobs.js';

export interface BuiltCase {
  content: CaseContent;
  /**
   * Photos the case has but whose bytes could not be read -- the URL was
   * revoked mid-read because the photo was just replaced. Left out of
   * `content`. The autosave can shrug (the next save picks up the new photo);
   * a file must not silently go without one.
   */
  unreadablePhotos: PhotoKind[];
}

export async function buildCaseContent(s: AppState): Promise<BuiltCase> {
  const photos: CaseContent['photos'] = {};
  const unreadablePhotos: PhotoKind[] = [];
  for (const kind of ['smile', 'retracted'] as const) {
    const photo = s.photos[kind];
    if (!photo) continue;
    const blob = await loadPhotoBlob(photo.url);
    if (blob) photos[kind] = { blob, width: photo.width, height: photo.height };
    else unreadablePhotos.push(kind);
  }

  return {
    content: {
      photos,
      selectedTeeth: s.selectedTeeth,
      refs: s.face.refs,
      matching: {
        pairs: s.matching.pairs,
        nudge: s.matching.nudge,
        refinement: s.matching.refinement,
        confirmed: s.matching.confirmed,
      },
      design: {
        templateId: s.design.templateId,
        params: s.design.params,
        palette: s.design.palette,
        paletteSampled: s.design.paletteSampled,
        edits: s.design.edits,
        teethOpacity: s.design.teethOpacity,
        lipMask: s.design.lipMask,
        photoBlend: s.design.photoBlend,
        mirrorMode: s.design.mirrorMode,
      },
      report: s.report,
    },
    unreadablePhotos,
  };
}
