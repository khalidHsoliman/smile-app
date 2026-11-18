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
import type { StoredCase } from './persistence.js';
import type { Template } from '../domain/templates/types.js';
import {
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  isBuiltInTemplate,
} from '../domain/templates/buildTemplate.js';
import { loadPhotoBlob } from './photoBlobs.js';
import { templateFromJson, templateToJson } from './templateFile.js';

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

  // An imported template goes with the case; a built-in one is named only.
  const { templateId } = s.design;
  const template =
    templateId !== null && !isBuiltInTemplate(templateId)
      ? findTemplate(templateId, s.importedTemplates)
      : undefined;

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
        ...(template && { template }),
      },
      report: s.report,
      pupilDistanceMm: s.pupilDistanceMm,
    },
    unreadablePhotos,
  };
}

// --- restoring -------------------------------------------------------------------

export const MISSING_TEMPLATE_NOTICE =
  'The tooth template this case was designed with could not be found, so the case opened with ' +
  'Natural. Its per-tooth adjustments belonged to the other template and were cleared; the ' +
  'sliders are as they were.';

/** A saved design, ready for the store. */
export interface RestoredDesign {
  design: Omit<StoredCase['design'], 'template'>;
  /** The open case's imported templates: the one the design uses, if any. */
  importedTemplates: Template[];
  /** Shown to the clinician when the design could not open as saved. */
  notice: string | null;
}

/**
 * What a saved design opens with.
 *
 * A built-in template, or none, opens as saved. An imported one opens with the
 * template the case carries -- checked again, as a file would be, so one that
 * is missing, broken or not the one named is treated alike. In that case the
 * design opens on Natural rather than on nothing, with the per-tooth edits
 * cleared (they are deltas against the lost template's shapes) and a notice.
 *
 * Case files never reach the fallback: they are refused as damaged first.
 * This is for the autosave, which is not checked on the way in.
 */
export function restoredDesign(saved: StoredCase['design']): RestoredDesign {
  const { template, ...design } = saved;
  const id = design.templateId;
  if (id === null || isBuiltInTemplate(id)) {
    return { design, importedTemplates: [], notice: null };
  }

  const checked = recheck(template);
  if (checked?.id === id) {
    return { design, importedTemplates: [checked], notice: null };
  }
  return {
    design: { ...design, templateId: DEFAULT_TEMPLATE_ID, edits: {} },
    importedTemplates: [],
    notice: MISSING_TEMPLATE_NOTICE,
  };
}

/** The template through the same checks as a file, or undefined if it fails. */
function recheck(template: Template | undefined): Template | undefined {
  if (!template) return undefined;
  try {
    return templateFromJson(templateToJson(template));
  } catch {
    return undefined;
  }
}
