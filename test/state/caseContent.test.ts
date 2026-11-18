import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseContent, MISSING_TEMPLATE_NOTICE, restoredDesign } from '../../src/state/caseContent.js';
import { readCaseFile, writeCaseFile } from '../../src/state/caseFile.js';
import type { AppState } from '../../src/state/store.js';
import type { StoredCase } from '../../src/state/persistence.js';
import { getTemplate } from '../../src/domain/templates/buildTemplate.js';
import { templateFromJson, templateToJson } from '../../src/state/templateFile.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6]);

/**
 * Store state as the app holds it, including the parts that must NOT be saved:
 * the step, the derived frame and transform, the selection, the undo history.
 */
function appState(): AppState {
  return {
    step: 'design',
    unlockedSteps: new Set(['upload', 'matching', 'analysis', 'design']),
    photos: {
      smile: { url: URL.createObjectURL(new Blob([JPEG], { type: 'image/jpeg' })), width: 40, height: 30 },
      retracted: { url: URL.createObjectURL(new Blob([PNG], { type: 'image/png' })), width: 30, height: 40 },
    },
    selectedTeeth: [7, 8, 9, 10],
    matching: {
      pairs: [{ source: { x: 1, y: 2 }, target: { x: 3, y: 4 } }, { source: { x: 5, y: 6 }, target: { x: 7, y: 8 } }],
      refinement: null,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 2 },
      error: 0.5,
      confirmed: true,
      nudge: { x: 1, y: -1 },
    },
    face: {
      refs: {
        leftPupil: { x: 1, y: 1 }, rightPupil: { x: 3, y: 1 },
        leftAla: { x: 1.5, y: 2 }, rightAla: { x: 2.5, y: 2 },
        midlineTop: { x: 2, y: 0 }, midlineBottom: { x: 2, y: 4 },
        lipCurve: [{ x: 1, y: 3 }, { x: 3, y: 3 }],
      },
      frame: { derived: true } as unknown as NonNullable<AppState['face']['frame']>,
      error: null,
    },
    design: {
      templateId: 'natural',
      params: { ratio: 0.8, scale: 1, smileCurve: 1, occlusalGap: 0, redProportion: 0.7, archWidth: 1 },
      teethOpacity: 0.75,
      lipMask: false,
      photoBlend: true,
      palette: { base: '#f4ece0', highlight: '#ffffff', cervical: '#e8d9bd', incisal: '#e4e8ea' },
      paletteSampled: false,
      sampledPalette: { base: '#000000', highlight: '#000000', cervical: '#000000', incisal: '#000000' },
      edits: { 9: { offset: { x: 0.1, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 } },
      selection: [9],
      mirrorMode: false,
    },
    importedTemplates: [],
    templateNotice: null,
    view: { transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
    report: { patientName: 'Jane Doe', clinicName: 'Clinic' },
    pupilDistanceMm: 61.5,
    paramDragActive: false,
    undoBatchDepth: 0,
    pendingUndo: null,
  } as unknown as AppState;
}

test('the case holds the inputs, and nothing derived or momentary', async () => {
  const s = appState();
  const { content, unreadablePhotos } = await buildCaseContent(s);
  assert.deepEqual(unreadablePhotos, []);

  const { photos, ...rest } = content;
  assert.deepEqual(rest, {
    selectedTeeth: s.selectedTeeth,
    refs: s.face.refs,
    matching: { pairs: s.matching.pairs, nudge: s.matching.nudge, refinement: null, confirmed: true },
    design: {
      templateId: 'natural',
      params: s.design.params,
      palette: s.design.palette,
      paletteSampled: false,
      edits: s.design.edits,
      teethOpacity: 0.75,
      lipMask: false,
      photoBlend: true,
      mirrorMode: false,
    },
    report: s.report,
    pupilDistanceMm: 61.5,
  });

  assert.deepEqual(new Uint8Array(await photos.smile!.blob.arrayBuffer()), JPEG);
  assert.equal(photos.smile!.blob.type, 'image/jpeg');
  assert.equal(photos.smile!.width, 40);
  assert.deepEqual(new Uint8Array(await photos.retracted!.blob.arrayBuffer()), PNG);
});

test('a photo whose bytes cannot be read is reported, not silently dropped', async () => {
  const s = appState();
  URL.revokeObjectURL(s.photos.retracted!.url); // replaced mid-save
  const { content, unreadablePhotos } = await buildCaseContent(s);
  assert.deepEqual(unreadablePhotos, ['retracted']);
  assert.ok(!('retracted' in content.photos));
  assert.ok('smile' in content.photos);
});

test('what the app builds, a file carries unchanged', async () => {
  const { content } = await buildCaseContent(appState());
  const opened = await readCaseFile(await writeCaseFile(content));
  const { photos, ...rest } = opened.content;
  const { photos: _original, ...expected } = content;
  assert.deepEqual(rest, expected);
  assert.deepEqual(new Uint8Array(await photos.smile!.blob.arrayBuffer()), JPEG);
  assert.deepEqual(new Uint8Array(await photos.retracted!.blob.arrayBuffer()), PNG);
});

test('a pupil distance not entered is saved as null, not left out', async () => {
  const s = { ...appState(), pupilDistanceMm: null } as AppState;
  const { content } = await buildCaseContent(s);
  assert.ok('pupilDistanceMm' in content);
  assert.equal(content.pupilDistanceMm, null);
  const opened = await readCaseFile(await writeCaseFile(content));
  assert.equal(opened.content.pupilDistanceMm, null);
});

// --- imported templates ----------------------------------------------------------------

/** A clinic's own template: one of the built-in shapes under a name of its own. */
const clinicTemplate = (name = 'Clinic A', base = 'natural') =>
  templateFromJson({ ...templateToJson(getTemplate(base)!), name });

/** The app state with templates imported into the case and `templateId` in use. */
function stateUsing(templateId: string, importedTemplates = [clinicTemplate(), clinicTemplate('Clinic B', 'hollywood')]): AppState {
  const s = appState();
  return { ...s, importedTemplates, design: { ...s.design, templateId } };
}

test('the imported template in use is saved with the design, and only that one', async () => {
  const [a, b] = [clinicTemplate(), clinicTemplate('Clinic B', 'hollywood')];
  const { content } = await buildCaseContent(stateUsing(b.id));
  assert.equal(content.design.templateId, b.id);
  assert.deepEqual(content.design.template, b);
  assert.notDeepEqual(content.design.template, a);
});

test('a built-in template in use saves no template, whatever was imported', async () => {
  const { content } = await buildCaseContent(stateUsing('hollywood'));
  assert.ok(!('template' in content.design));
});

test('a case built on an imported template goes through a file unchanged', async () => {
  const { content } = await buildCaseContent(stateUsing(clinicTemplate().id));
  const opened = await readCaseFile(await writeCaseFile(content));
  const { photos: _opened, ...rest } = opened.content;
  const { photos: _original, ...expected } = content;
  assert.deepEqual(rest, expected);
});

/** A saved design, as the autosave holds it. */
const savedDesign = (patch: Partial<StoredCase['design']>): StoredCase['design'] => ({
  templateId: 'natural',
  params: { ratio: 0.78, scale: 1.2, smileCurve: 2, occlusalGap: -5, redProportion: 0.66, archWidth: 1.1 },
  palette: { base: '#f4ece0', highlight: '#ffffff', cervical: '#e8d9bd', incisal: '#e4e8ea' },
  paletteSampled: true,
  edits: { 9: { offset: { x: 0.1, y: 0 }, rotation: 0.02, scaleX: 1, scaleY: 1 } },
  teethOpacity: 0.8,
  lipMask: true,
  photoBlend: false,
  mirrorMode: true,
  ...patch,
});

test('a saved design on a built-in template, or none, opens as saved', () => {
  for (const templateId of ['natural', 'hollywood', null]) {
    const saved = savedDesign({ templateId });
    assert.deepEqual(restoredDesign(saved), { design: saved, importedTemplates: [], notice: null });
  }
});

test('a saved design on an imported template opens with that template in the case', () => {
  const template = clinicTemplate();
  const { template: _carried, ...design } = savedDesign({ templateId: template.id, template });
  const restored = restoredDesign(savedDesign({ templateId: template.id, template }));
  assert.deepEqual(restored.design, design);
  assert.ok(!('template' in restored.design));
  assert.deepEqual(restored.importedTemplates, [template]);
  assert.equal(restored.notice, null);
});

test('the autosave round trip: what the app builds, it restores, template and all', async () => {
  const template = clinicTemplate('Clinic B', 'hollywood');
  const { content } = await buildCaseContent(stateUsing(template.id));
  const restored = restoredDesign(content.design);
  assert.equal(restored.design.templateId, template.id);
  assert.deepEqual(restored.importedTemplates, [template]);
  assert.deepEqual(restored.design.edits, appState().design.edits);
  assert.equal(restored.notice, null);
});

/** What every failed restore must come to: Natural, no edits, sliders kept, a notice. */
function assertFellBack(saved: StoredCase['design']) {
  const restored = restoredDesign(saved);
  assert.equal(restored.design.templateId, 'natural');
  assert.deepEqual(restored.design.edits, {});
  assert.deepEqual(restored.design.params, saved.params);
  assert.equal(restored.design.palette, saved.palette);
  assert.ok(!('template' in restored.design));
  assert.deepEqual(restored.importedTemplates, []);
  assert.equal(restored.notice, MISSING_TEMPLATE_NOTICE);
}

test('an autosave naming an unknown template opens on Natural, edits cleared, with a notice', () => {
  assertFellBack(savedDesign({ templateId: 'porcelain' }));
  assertFellBack(savedDesign({ templateId: clinicTemplate().id }));
});

test('an autosave carrying the wrong or a broken template falls back the same way', () => {
  const template = clinicTemplate();
  // Not the template named.
  assertFellBack(savedDesign({ templateId: template.id, template: clinicTemplate('Clinic B') }));
  // Changed since it was saved, so no longer the template its id describes.
  const changed = { ...template, teeth: { ...template.teeth, 7: { ...template.teeth[7]!, incisalOffset: 0.1 } } };
  assertFellBack(savedDesign({ templateId: template.id, template: changed }));
  // Broken: a tooth gone, or not a template at all.
  const { 8: _central, ...teeth } = template.teeth;
  assertFellBack(savedDesign({ templateId: template.id, template: { ...template, teeth } }));
  assertFellBack(savedDesign({ templateId: template.id, template: {} as never }));
});

test('the notice says what happened and what was kept', () => {
  assert.match(MISSING_TEMPLATE_NOTICE, /could not be found/);
  assert.match(MISSING_TEMPLATE_NOTICE, /Natural/);
  assert.match(MISSING_TEMPLATE_NOTICE, /per-tooth adjustments .* cleared/);
  assert.match(MISSING_TEMPLATE_NOTICE, /sliders are as they were/);
});
