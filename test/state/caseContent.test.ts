import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseContent } from '../../src/state/caseContent.js';
import { readCaseFile, writeCaseFile } from '../../src/state/caseFile.js';
import type { AppState } from '../../src/state/store.js';

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
