import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_FILE_FORMAT,
  CASE_FILE_VERSION,
  CaseFileError,
  readCaseFile,
  writeCaseFile,
  type CaseContent,
  type CaseFileProblem,
} from '../../src/state/caseFile.js';
import { getTemplate } from '../../src/domain/templates/buildTemplate.js';
import { TEMPLATE_FILE_FORMAT, templateFromJson, templateToJson } from '../../src/state/templateFile.js';

// --- fixtures ------------------------------------------------------------------

/** Bytes that start like a real image of `type`, followed by `size` bytes of noise. */
function imageBytes(type: 'jpeg' | 'png' | 'webp', size = 64): Uint8Array<ArrayBuffer> {
  const head = {
    jpeg: [0xff, 0xd8, 0xff, 0xe0],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    webp: [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))),
  }[type];
  const bytes = new Uint8Array(head.length + size);
  bytes.set(head);
  // Every byte value, so base64 is exercised across the whole range.
  for (let i = 0; i < size; i++) bytes[head.length + i] = (i * 7 + 3) % 256;
  return bytes;
}

function fullCase(): CaseContent {
  return {
    photos: {
      smile: { blob: new Blob([imageBytes('jpeg')], { type: 'image/jpeg' }), width: 4032, height: 3024 },
      retracted: { blob: new Blob([imageBytes('png')], { type: 'image/png' }), width: 3024, height: 4032 },
    },
    selectedTeeth: [6, 7, 8, 9, 10, 11],
    refs: {
      leftPupil: { x: 1200.5, y: 900 },
      rightPupil: { x: 2800, y: 905.25 },
      leftAla: { x: 1800, y: 1700 },
      rightAla: { x: 2200, y: 1702 },
      midlineTop: { x: 2000, y: 600 },
      midlineBottom: { x: 2004, y: 2900 },
      lipCurve: [{ x: 1700, y: 2100 }, { x: 2000, y: 2150 }, { x: 2300, y: 2098 }],
      mouthAperture: [{ x: 1700, y: 2100 }, { x: 2300, y: 2100 }, { x: 2000, y: 2300 }],
    },
    matching: {
      pairs: [
        { source: { x: 10, y: 20 }, target: { x: 30, y: 40 } },
        { source: { x: 50, y: 60 }, target: { x: 70, y: 80 } },
      ],
      nudge: { x: -2, y: 1.5 },
      refinement: { a: 1.01, b: 0.002, c: -0.002, d: 1.01, e: 3, f: -4 },
      confirmed: true,
    },
    design: {
      templateId: 'natural',
      params: { ratio: 0.8, scale: 1.05, smileCurve: 1.2, occlusalGap: -3, redProportion: 0.7, archWidth: 1 },
      palette: { base: '#f4ece0', highlight: '#ffffff', cervical: '#E8D9BD', incisal: '#e4e8ea' },
      paletteSampled: true,
      edits: { 8: { offset: { x: 0.01, y: -0.02 }, rotation: 0.05, scaleX: 1.1, scaleY: 0.95 } },
      teethOpacity: 0.9,
      lipMask: true,
      photoBlend: false,
      mirrorMode: true,
    },
    report: { patientName: 'Jane Doe', clinicName: 'Bright Smiles' },
    pupilDistanceMm: 63.5,
  };
}

const SAVED_AT = new Date('2025-11-14T10:30:00.000Z');

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Compare two cases, with each photo Blob reduced to its type and bytes. */
async function comparable(content: CaseContent) {
  const photos: Record<string, unknown> = {};
  for (const [kind, photo] of Object.entries(content.photos)) {
    photos[kind] = { ...photo, blob: { type: photo.blob.type, bytes: await bytesOf(photo.blob) } };
  }
  return { ...content, photos };
}

/** A valid saved file, parsed, changed by `mutate`, and turned back into a file. */
async function alteredFile(mutate: (json: any) => void): Promise<Blob> {
  const json = JSON.parse(await (await writeCaseFile(fullCase(), SAVED_AT)).text());
  mutate(json);
  return new Blob([JSON.stringify(json, null, 2)]);
}

async function assertRefused(file: Blob, problem: CaseFileProblem, mention?: string) {
  await assert.rejects(readCaseFile(file), (error: unknown) => {
    assert.ok(error instanceof CaseFileError, `expected a CaseFileError, got ${String(error)}`);
    assert.equal(error.problem, problem, error.message);
    if (mention) assert.ok(error.message.includes(mention), `"${error.message}" should mention ${mention}`);
    return true;
  });
}

// --- round trip ------------------------------------------------------------------

test('a full case comes back exactly as saved, photos byte for byte', async () => {
  const opened = await readCaseFile(await writeCaseFile(fullCase(), SAVED_AT));
  assert.equal(opened.savedAt, SAVED_AT.getTime());
  assert.deepEqual(await comparable(opened.content), await comparable(fullCase()));
});

test('a minimal case round-trips: no photos, no references, no edits', async () => {
  const minimal: CaseContent = {
    ...fullCase(),
    photos: {},
    selectedTeeth: [],
    refs: null,
    design: { ...fullCase().design, templateId: null, edits: {} },
    matching: { pairs: [], nudge: { x: 0, y: 0 }, refinement: null, confirmed: false },
    report: { patientName: '', clinicName: '' },
    pupilDistanceMm: null,
  };
  const opened = await readCaseFile(await writeCaseFile(minimal, SAVED_AT));
  assert.deepEqual(opened.content, minimal);
});

test('optional fields that are absent stay absent', async () => {
  const { matching: _matching, ...withoutMatching } = fullCase();
  const { photoBlend: _photoBlend, ...designWithoutBlend } = fullCase().design;
  const { mouthAperture: _aperture, ...refsWithoutAperture } = fullCase().refs!;
  const old: CaseContent = {
    ...withoutMatching,
    refs: refsWithoutAperture,
    design: designWithoutBlend,
    photos: {},
  };
  const opened = await readCaseFile(await writeCaseFile(old, SAVED_AT));
  assert.deepEqual(opened.content, old);
  assert.ok(!('matching' in opened.content));
  assert.ok(!('photoBlend' in opened.content.design));
  assert.ok(!('mouthAperture' in opened.content.refs!));
});

test('a multi-megabyte photo survives the round trip', async () => {
  const big = imageBytes('webp', 5 * 1024 * 1024 + 1); // odd length: exercises base64 padding
  const content: CaseContent = {
    ...fullCase(),
    photos: { smile: { blob: new Blob([big], { type: 'image/webp' }), width: 8000, height: 6000 } },
  };
  const opened = await readCaseFile(await writeCaseFile(content, SAVED_AT));
  assert.deepEqual(await bytesOf(opened.content.photos.smile!.blob), big);
  assert.equal(opened.content.photos.smile!.blob.type, 'image/webp');
});

test('the file is readable JSON: marker, version and save time first, photos last', async () => {
  const text = await (await writeCaseFile(fullCase(), SAVED_AT)).text();
  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json), ['format', 'version', 'savedAt', 'case']);
  assert.equal(json.format, CASE_FILE_FORMAT);
  assert.equal(json.version, CASE_FILE_VERSION);
  assert.equal(json.savedAt, '2025-11-14T10:30:00.000Z');
  assert.equal(Object.keys(json.case).at(-1), 'photos');
  assert.ok(text.startsWith(`{\n  "format": "${CASE_FILE_FORMAT}"`));
});

test('only the case fields are written, nothing else that happens to be in the object', async () => {
  const content = {
    ...fullCase(),
    step: 'design',
    design: { ...fullCase().design, selection: [8], sampledPalette: null },
  } as CaseContent;
  const json = JSON.parse(await (await writeCaseFile(content, SAVED_AT)).text());
  assert.ok(!('step' in json.case));
  assert.ok(!('selection' in json.case.design));
  assert.ok(!('sampledPalette' in json.case.design));
});

test('extra fields in a file are dropped on open', async () => {
  const file = await alteredFile((json) => {
    json.case.somethingElse = 1;
    json.case.design.injected = 'x';
    json.case.photos.third = { anything: true };
  });
  const opened = await readCaseFile(file);
  assert.ok(!('somethingElse' in opened.content));
  assert.ok(!('injected' in opened.content.design));
  assert.deepEqual(Object.keys(opened.content.photos).sort(), ['retracted', 'smile']);
});

test('a photo whose file name lied about its type saves and opens as what it really is', async () => {
  // A JPEG named .png: Chrome reports image/png. A PNG with no type at all.
  const content = fullCase();
  content.photos.smile = { ...content.photos.smile!, blob: new Blob([imageBytes('jpeg')], { type: 'image/png' }) };
  content.photos.retracted = { ...content.photos.retracted!, blob: new Blob([imageBytes('png')]) };

  const opened = await readCaseFile(await writeCaseFile(content, SAVED_AT));
  assert.equal(opened.content.photos.smile!.blob.type, 'image/jpeg');
  assert.deepEqual(await bytesOf(opened.content.photos.smile!.blob), imageBytes('jpeg'));
  assert.equal(opened.content.photos.retracted!.blob.type, 'image/png');
  assert.deepEqual(await bytesOf(opened.content.photos.retracted!.blob), imageBytes('png'));
});

// --- refusing to write -------------------------------------------------------------

test('a case a file cannot carry faithfully is refused, not written with holes', async () => {
  const nan = fullCase();
  nan.design.params.scale = NaN; // JSON would write null
  await assert.rejects(writeCaseFile(nan, SAVED_AT), (e: unknown) =>
    e instanceof CaseFileError && e.problem === 'cannot-save' && e.message.includes('case.design.params.scale'),
  );

  // A GIF renamed .jpg: the browser shows it, but a case file cannot carry it.
  const gif = fullCase();
  const gifBytes = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0]));
  gif.photos.smile = { ...gif.photos.smile!, blob: new Blob([gifBytes], { type: 'image/jpeg' }) };
  await assert.rejects(writeCaseFile(gif, SAVED_AT), (e: unknown) =>
    e instanceof CaseFileError && e.problem === 'cannot-save' && e.message.includes('smile photo is not a JPEG, PNG or WebP'),
  );

  await assert.rejects(writeCaseFile(fullCase(), new Date(NaN)), (e: unknown) =>
    e instanceof CaseFileError && e.problem === 'cannot-save',
  );
});

// --- broken and foreign files ---------------------------------------------------------

test('files that are not case files at all', async () => {
  await assertRefused(new Blob([]), 'not-a-case-file');
  await assertRefused(new Blob([imageBytes('jpeg')]), 'not-a-case-file');
  await assertRefused(new Blob(['hello']), 'not-a-case-file');
  for (const json of ['null', '[]', '"text"', '42', '{}', '{"format":"something-else","version":1}']) {
    await assertRefused(new Blob([json]), 'not-a-case-file');
  }
});

test('a case file cut short is damaged, not "some other file"', async () => {
  const text = await (await writeCaseFile(fullCase(), SAVED_AT)).text();
  for (const keep of [40, Math.floor(text.length / 2), text.length - 2]) {
    await assertRefused(new Blob([text.slice(0, keep)]), 'damaged', 'incomplete');
  }
});

test('a file from a newer version is refused with a clear message', async () => {
  const file = await alteredFile((json) => {
    json.version = CASE_FILE_VERSION + 1;
    json.case = { whatever: 'a future shape' };
  });
  await assertRefused(file, 'newer-version', 'Update the app');
});

test('a missing or invalid version is damaged', async () => {
  for (const version of [undefined, null, 0, -1, 1.5, '1']) {
    await assertRefused(await alteredFile((json) => { json.version = version; }), 'damaged', 'version');
  }
});

const DAMAGE: Array<[string, (json: any) => void, string]> = [
  ['no save time', (j) => { delete j.savedAt; }, 'savedAt'],
  ['unreadable save time', (j) => { j.savedAt = 'yesterday'; }, 'savedAt'],
  ['no case', (j) => { delete j.case; }, 'case'],
  ['no photos object', (j) => { delete j.case.photos; }, 'case.photos'],
  ['no report', (j) => { delete j.case.report; }, 'case.report'],
  ['patient name not text', (j) => { j.case.report.patientName = 7; }, 'case.report.patientName'],
  ['teeth not a list', (j) => { j.case.selectedTeeth = '6-11'; }, 'case.selectedTeeth'],
  ['tooth out of range', (j) => { j.case.selectedTeeth.push(33); }, 'case.selectedTeeth[6]'],
  ['tooth not whole', (j) => { j.case.selectedTeeth[0] = 6.5; }, 'case.selectedTeeth[0]'],
  ['reference point missing', (j) => { delete j.case.refs.leftPupil; }, 'case.refs.leftPupil'],
  ['reference coordinate null (a NaN once)', (j) => { j.case.refs.lipCurve[1].y = null; }, 'case.refs.lipCurve[1].y'],
  ['aperture not a list', (j) => { j.case.refs.mouthAperture = {}; }, 'case.refs.mouthAperture'],
  ['match pair broken', (j) => { j.case.matching.pairs[1].target = 5; }, 'case.matching.pairs[1].target'],
  ['match confirmed not true/false', (j) => { j.case.matching.confirmed = 'yes'; }, 'case.matching.confirmed'],
  ['refinement incomplete', (j) => { delete j.case.matching.refinement.f; }, 'case.matching.refinement.f'],
  ['no design', (j) => { delete j.case.design; }, 'case.design'],
  ['template id not text', (j) => { j.case.design.templateId = 3; }, 'case.design.templateId'],
  ['parameter missing', (j) => { delete j.case.design.params.archWidth; }, 'case.design.params.archWidth'],
  ['parameter as text', (j) => { j.case.design.params.scale = '1.0'; }, 'case.design.params.scale'],
  ['palette colour not hex', (j) => { j.case.design.palette.base = 'white'; }, 'case.design.palette.base'],
  ['palette colour fetching a URL', (j) => { j.case.design.palette.highlight = 'url(https://example.com/x)'; }, 'case.design.palette.highlight'],
  ['edit for a non-tooth', (j) => { j.case.design.edits['40'] = j.case.design.edits['8']; }, 'case.design.edits.40'],
  ['edit keyed by a non-number', (j) => { j.case.design.edits['08'] = j.case.design.edits['8']; }, 'case.design.edits.08'],
  ['edit incomplete', (j) => { delete j.case.design.edits['8'].scaleY; }, 'case.design.edits.8.scaleY'],
  ['opacity missing', (j) => { delete j.case.design.teethOpacity; }, 'case.design.teethOpacity'],
  ['photo blend not true/false', (j) => { j.case.design.photoBlend = 1; }, 'case.design.photoBlend'],
  ['no pupil distance in a version 2 file', (j) => { delete j.case.pupilDistanceMm; }, 'case.pupilDistanceMm'],
  ['pupil distance as text', (j) => { j.case.pupilDistanceMm = '62'; }, 'case.pupilDistanceMm'],
  ['pupil distance true/false', (j) => { j.case.pupilDistanceMm = true; }, 'case.pupilDistanceMm'],
  ['pupil distance a list', (j) => { j.case.pupilDistanceMm = [62]; }, 'case.pupilDistanceMm'],
  ['pupil distance an object', (j) => { j.case.pupilDistanceMm = { mm: 62 }; }, 'case.pupilDistanceMm'],
  ['pupil distance below 40 mm', (j) => { j.case.pupilDistanceMm = 39.9; }, 'case.pupilDistanceMm'],
  ['pupil distance above 80 mm', (j) => { j.case.pupilDistanceMm = 80.1; }, 'case.pupilDistanceMm'],
  ['pupil distance zero', (j) => { j.case.pupilDistanceMm = 0; }, 'case.pupilDistanceMm'],
  ['pupil distance negative', (j) => { j.case.pupilDistanceMm = -62; }, 'case.pupilDistanceMm'],
  ['pupil distance in cm', (j) => { j.case.pupilDistanceMm = 6.2; }, 'case.pupilDistanceMm'],
  ['photo not an object', (j) => { j.case.photos.smile = 'data:image/jpeg;base64,...'; }, 'case.photos.smile'],
  ['photo of an unsupported type', (j) => { j.case.photos.smile.type = 'text/html'; }, 'case.photos.smile.type'],
  ['photo without a type', (j) => { delete j.case.photos.smile.type; }, 'case.photos.smile.type'],
  ['photo width zero', (j) => { j.case.photos.smile.width = 0; }, 'case.photos.smile.width'],
  ['photo height fractional', (j) => { j.case.photos.retracted.height = 10.5; }, 'case.photos.retracted.height'],
  ['photo data missing', (j) => { delete j.case.photos.smile.data; }, 'case.photos.smile.data'],
  ['photo data not base64', (j) => { j.case.photos.smile.data = '@@not base64@@'; }, 'case.photos.smile.data'],
  ['photo data empty', (j) => { j.case.photos.smile.data = ''; }, 'case.photos.smile.data'],
  ['photo data cut short', (j) => { j.case.photos.smile.data = j.case.photos.smile.data.slice(0, 1); }, 'case.photos.smile.data'],
  ['photo bytes not the stated type', (j) => {
    [j.case.photos.smile.data, j.case.photos.retracted.data] = [j.case.photos.retracted.data, j.case.photos.smile.data];
  }, 'case.photos.smile.data'],
];

for (const [what, mutate, path] of DAMAGE) {
  test(`damaged file refused whole: ${what}`, async () => {
    await assertRefused(await alteredFile(mutate), 'damaged', path);
  });
}

test('damage messages are meant for the user', async () => {
  await assert.rejects(
    readCaseFile(await alteredFile((j) => { j.case.design.params.scale = 'big'; })),
    { message: 'This case file is damaged and cannot be opened (case.design.params.scale is missing or not a number).' },
  );
});

// --- the pupil distance and version 1 files ---------------------------------------------

test('this app writes version 3, with the pupil distance version 2 added', async () => {
  assert.equal(CASE_FILE_VERSION, 3);
  const json = JSON.parse(await (await writeCaseFile(fullCase(), SAVED_AT)).text());
  assert.equal(json.version, 3);
  assert.equal(json.case.pupilDistanceMm, 63.5);
});

test('the pupil distance round-trips, entered or not, at either end of the range', async () => {
  for (const pupilDistanceMm of [63.5, 40, 80, null]) {
    const content: CaseContent = { ...fullCase(), photos: {}, pupilDistanceMm };
    const text = await (await writeCaseFile(content, SAVED_AT)).text();
    assert.equal(JSON.parse(text).case.pupilDistanceMm, pupilDistanceMm);
    const opened = await readCaseFile(new Blob([text]));
    assert.equal(opened.content.pupilDistanceMm, pupilDistanceMm);
    assert.deepEqual(opened.content, content);
  }
});

/** A file as version 1 of the app wrote it: version 1, no pupil distance. */
const versionOneFile = (mutate: (json: any) => void = () => {}) =>
  alteredFile((json) => {
    json.version = 1;
    delete json.case.pupilDistanceMm;
    mutate(json);
  });

test('a version 1 file opens whole, with no pupil distance', async () => {
  const opened = await readCaseFile(await versionOneFile());
  assert.equal(opened.savedAt, SAVED_AT.getTime());
  assert.equal(opened.content.pupilDistanceMm, null);
  assert.deepEqual(
    await comparable(opened.content),
    await comparable({ ...fullCase(), pupilDistanceMm: null }),
  );
});

test('a version 1 file opened and saved again becomes version 3, still with no distance', async () => {
  const opened = await readCaseFile(await versionOneFile());
  const json = JSON.parse(await (await writeCaseFile(opened.content, SAVED_AT)).text());
  assert.equal(json.version, 3);
  assert.equal(json.case.pupilDistanceMm, null);
});

test('a pupil distance in a version 1 file is not the app\'s, and is dropped like any unknown field', async () => {
  for (const stray of [70, 'abc', 500]) {
    const opened = await readCaseFile(await versionOneFile((json) => { json.case.pupilDistanceMm = stray; }));
    assert.equal(opened.content.pupilDistanceMm, null);
  }
});

test('a version 1 file is still checked in full', async () => {
  await assertRefused(
    await versionOneFile((json) => { json.case.design.params.scale = 'big'; }),
    'damaged',
    'case.design.params.scale',
  );
  await assertRefused(await versionOneFile((json) => { json.case = 'nothing'; }), 'damaged', 'case');
});

test('a bad pupil distance is refused with a message for the user', async () => {
  await assert.rejects(
    readCaseFile(await alteredFile((j) => { j.case.pupilDistanceMm = 95; })),
    { message: 'This case file is damaged and cannot be opened (case.pupilDistanceMm is not between 40 and 80 mm).' },
  );
  await assert.rejects(
    readCaseFile(await alteredFile((j) => { j.case.pupilDistanceMm = '62'; })),
    { message: 'This case file is damaged and cannot be opened (case.pupilDistanceMm is missing or not a number).' },
  );
});

test('a pupil distance a file cannot carry is refused on saving, not written', async () => {
  for (const pupilDistanceMm of [NaN, Infinity, 30, 120]) {
    await assert.rejects(
      writeCaseFile({ ...fullCase(), pupilDistanceMm }, SAVED_AT),
      (e: unknown) =>
        e instanceof CaseFileError && e.problem === 'cannot-save' && e.message.includes('case.pupilDistanceMm'),
    );
  }
});

// --- imported templates (version 3) ---------------------------------------------------

/** A clinic's own template: Natural's shapes under a name of its own. */
const clinicTemplate = () => templateFromJson({ ...templateToJson(getTemplate('natural')!), name: 'Clinic A' });

/** The full case, designed with the clinic's template. */
function importedCase(): CaseContent {
  const template = clinicTemplate();
  return { ...fullCase(), design: { ...fullCase().design, templateId: template.id, template } };
}

/** A valid saved file of `importedCase`, parsed, changed by `mutate`, and turned back into a file. */
async function alteredImportedFile(mutate: (json: any) => void): Promise<Blob> {
  const json = JSON.parse(await (await writeCaseFile(importedCase(), SAVED_AT)).text());
  mutate(json);
  return new Blob([JSON.stringify(json, null, 2)]);
}

test('a case with an imported template comes back with that template, exactly', async () => {
  const opened = await readCaseFile(await writeCaseFile(importedCase(), SAVED_AT));
  assert.deepEqual(await comparable(opened.content), await comparable(importedCase()));
  assert.equal(opened.content.design.template!.name, 'Clinic A');
  assert.equal(opened.content.design.template!.id, opened.content.design.templateId);
});

test('the file carries an imported template as template file JSON, photos still last', async () => {
  const json = JSON.parse(await (await writeCaseFile(importedCase(), SAVED_AT)).text());
  const carried = json.case.design.template;
  assert.equal(carried.format, TEMPLATE_FILE_FORMAT);
  assert.equal(carried.name, 'Clinic A');
  assert.equal(Object.keys(carried.teeth).length, 32);
  assert.ok('11' in carried.teeth);
  // No id in the carried template: it is worked out from the content.
  assert.ok(!('id' in carried));
  assert.equal(json.case.design.templateId, clinicTemplate().id);
  assert.equal(Object.keys(json.case).at(-1), 'photos');
});

test('a case with a built-in template carries no template, only its id', async () => {
  for (const templateId of ['natural', 'hollywood', null]) {
    const content: CaseContent = { ...fullCase(), design: { ...fullCase().design, templateId } };
    const json = JSON.parse(await (await writeCaseFile(content, SAVED_AT)).text());
    assert.ok(!('template' in json.case.design), String(templateId));
    const opened = await readCaseFile(new Blob([JSON.stringify(json)]));
    assert.ok(!('template' in opened.content.design));
    assert.equal(opened.content.design.templateId, templateId);
  }
});

/** A file as version 2 of the app wrote it: version 2, built-in templates only. */
const versionTwoFile = (mutate: (json: any) => void = () => {}) =>
  alteredFile((json) => {
    json.version = 2;
    mutate(json);
  });

test('a version 2 file opens whole, on its built-in template', async () => {
  const opened = await readCaseFile(await versionTwoFile());
  assert.deepEqual(await comparable(opened.content), await comparable(fullCase()));
  assert.ok(!('template' in opened.content.design));
});

test('a version 2 file opened and saved again becomes version 3', async () => {
  const opened = await readCaseFile(await versionTwoFile((json) => { json.case.design.templateId = 'hollywood'; }));
  const json = JSON.parse(await (await writeCaseFile(opened.content, SAVED_AT)).text());
  assert.equal(json.version, 3);
  assert.equal(json.case.design.templateId, 'hollywood');
  assert.ok(!('template' in json.case.design));
});

test('a template in a version 2 file is not the app\'s, and is dropped like any unknown field', async () => {
  const carried = templateToJson(clinicTemplate());
  // Beside a built-in template it is simply dropped...
  const opened = await readCaseFile(await versionTwoFile((json) => { json.case.design.template = carried; }));
  assert.equal(opened.content.design.templateId, 'natural');
  assert.ok(!('template' in opened.content.design));
  // ...and it cannot make a version 2 design naming another template open.
  await assertRefused(
    await versionTwoFile((json) => {
      json.case.design.templateId = clinicTemplate().id;
      json.case.design.template = carried;
    }),
    'damaged',
    'case.design.templateId',
  );
});

test('a version 2 or version 1 file naming an unknown template is damaged', async () => {
  await assertRefused(
    await versionTwoFile((json) => { json.case.design.templateId = 'porcelain'; }),
    'damaged',
    'case.design.templateId is "porcelain", which is not a built-in template, and the case does not carry that template',
  );
  await assertRefused(
    await versionOneFile((json) => { json.case.design.templateId = 'porcelain'; }),
    'damaged',
    'case.design.templateId',
  );
});

const templateRefusals: [string, (json: any) => void, string][] = [
  ['an unknown template, not carried', (j) => {
    j.case.design.templateId = 'porcelain';
    delete j.case.design.template;
  }, 'case.design.templateId is "porcelain", which is not a built-in template'],
  ['an imported template, not carried', (j) => { delete j.case.design.template; }, 'the case does not carry that template'],
  ['a carried template beside a built-in one', (j) => { j.case.design.templateId = 'natural'; }, 'case.design.template is there, but the design does not use an imported template'],
  ['a carried template and no template chosen', (j) => { j.case.design.templateId = null; }, 'case.design.template is there'],
  ['a carried template that is not an object', (j) => { j.case.design.template = 'Clinic A'; }, 'case.design.template is not a usable template: is not a tooth template'],
  ['a carried template without its marker', (j) => { delete j.case.design.template.format; }, 'case.design.template is not a usable template: is not a tooth template'],
  ['a carried template missing a tooth', (j) => { delete j.case.design.template.teeth['23']; }, 'case.design.template is not a usable template: teeth.23 is missing'],
  ['a carried template with a bad outline', (j) => { j.case.design.template.teeth['12'].outline = 'M 0 0 l 1 1 Z'; }, 'teeth.12.outline uses "l"'],
  ['a carried template with a built-in name', (j) => { j.case.design.template.name = 'Natural'; }, 'is the name of a built-in template'],
  ['a carried template from a newer template format', (j) => { j.case.design.template.version = 2; }, 'is template file version 2, newer than this app reads'],
  ['a carried template edited inside the case file', (j) => { j.case.design.template.teeth['12'].incisalOffset = 0.1; }, `case.design.template is not the template the design names ("${clinicTemplate().id}")`],
  ['a carried template renamed inside the case file', (j) => { j.case.design.template.name = 'Clinic B'; }, 'is not the template the design names'],
  ['a carried template swapped for another', (j) => {
    j.case.design.template = templateToJson(templateFromJson({ ...templateToJson(getTemplate('hollywood')!), name: 'Clinic A' }));
  }, 'is not the template the design names'],
];

for (const [what, mutate, mention] of templateRefusals) {
  test(`refused as damaged: ${what}`, async () => {
    await assertRefused(await alteredImportedFile(mutate), 'damaged', mention);
  });
}

test('a damaged template reads as one sentence', async () => {
  await assert.rejects(
    readCaseFile(await alteredImportedFile((j) => { delete j.case.design.template.teeth['23']; })),
    {
      message:
        'This case file is damaged and cannot be opened (case.design.template is not a usable template: ' +
        'teeth.23 is missing: a template needs all 32 teeth).',
    },
  );
});

test('the app will not write a case whose template it could not open again', async () => {
  const cannotSave = (mention: string) => (e: unknown) =>
    e instanceof CaseFileError && e.problem === 'cannot-save' && e.message.includes(mention);

  // An imported template named, but not there to carry.
  const { template: _template, ...withoutTemplate } = importedCase().design;
  await assert.rejects(
    writeCaseFile({ ...importedCase(), design: withoutTemplate }, SAVED_AT),
    cannotSave('the case does not carry that template'),
  );
  // A template carried, but not the one named.
  await assert.rejects(
    writeCaseFile({ ...importedCase(), design: { ...importedCase().design, templateId: 'custom-0000000000000000' } }, SAVED_AT),
    cannotSave('is not the template the design names'),
  );
  // A template carried beside a built-in one.
  await assert.rejects(
    writeCaseFile({ ...importedCase(), design: { ...importedCase().design, templateId: 'natural' } }, SAVED_AT),
    cannotSave('case.design.template is there'),
  );
  // A carried template a file could not hold.
  const { 8: _central, ...teeth } = clinicTemplate().teeth;
  await assert.rejects(
    writeCaseFile({ ...importedCase(), design: { ...importedCase().design, template: { ...clinicTemplate(), teeth } } }, SAVED_AT),
    cannotSave('case.design.template teeth.11 is missing'),
  );
});
