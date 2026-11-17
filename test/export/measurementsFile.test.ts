import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell,
  MEASUREMENTS_FILE_HEADER,
  measurementsCsv,
  measurementsFile,
  measurementsFileRows,
  type MeasurementsFileInput,
} from '../../src/export/measurementsFile.js';
import {
  dentalMidlineOffset,
  faceMeasurements,
  formatMidline,
  formatOffset,
  formatPercent,
  formatSize,
  formatTilt,
  toothMeasurements,
  toothSizes,
} from '../../src/domain/measurements.js';
import type { FacialReferences } from '../../src/domain/faceFrame.js';
import { vec } from '../../src/domain/geometry.js';
import { fitArches, type FitParams } from '../../src/domain/fitting.js';
import { applyEdits, editTooth, IDENTITY_EDIT, type ToothEdits } from '../../src/domain/toothEdits.js';
import { getTemplate } from '../../src/domain/templates/buildTemplate.js';
import type { Universal } from '../../src/domain/teeth.js';

// --- fixtures ------------------------------------------------------------------

/**
 * A level face at 0.1 mm per pixel with a 62 mm pupil distance, as in the
 * measurement tests: a central at scale 1 is 8.5 mm wide.
 */
function face(): FacialReferences {
  return {
    rightPupil: vec(190, 300),
    leftPupil: vec(810, 300),
    rightAla: vec(330, 450),
    leftAla: vec(670, 450),
    midlineTop: vec(500, 200),
    midlineBottom: vec(500, 700),
    lipCurve: [vec(430, 520), vec(465, 528), vec(500, 530), vec(535, 528), vec(570, 520)],
  };
}

const natural = getTemplate('natural')!;
const ANTERIOR_SIX: Universal[] = [6, 7, 8, 9, 10, 11];
const FIT: FitParams = { ratio: 0.8, scale: 1, smileCurve: 1, occlusalGap: 0, redProportion: 0.7, archWidth: 1 };

function design(selected: Universal[] = ANTERIOR_SIX, params: Partial<FitParams> = {}, edits: ToothEdits = {}) {
  return applyEdits(fitArches(selected, natural, { ...FIT, ...params }).teeth, edits);
}

/** The whole design moved `dx` face units toward the patient's left. */
function nudged(dx: number): ToothEdits {
  let edits: ToothEdits = {};
  for (const u of ANTERIOR_SIX) edits = editTooth(edits, u, { ...IDENTITY_EDIT, offset: vec(dx, 0) }, false);
  return edits;
}

function input(change: Partial<MeasurementsFileInput> = {}): MeasurementsFileInput {
  return {
    patientName: 'Jane Doe',
    clinicName: 'Bright Smiles',
    date: new Date(2025, 10, 14, 16, 45),
    selectedTeeth: ANTERIOR_SIX,
    refs: face(),
    teeth: design(ANTERIOR_SIX, {}, nudged(0.0225)),
    template: natural,
    pupilDistanceMm: 62,
    ...change,
  };
}

/** A small RFC 4180 reader, to check the file as a spreadsheet would read it. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

/** Measurement, Tooth and Unit of every row: the layout a lab's import relies on. */
const layout = (i: MeasurementsFileInput) => measurementsFileRows(i).map(([m, t, , u]) => [m, t, u]);

// --- the file ---------------------------------------------------------------------

test('a full case: every row, as a lab opens it', () => {
  assert.equal(
    measurementsCsv(input()),
    [
      'Measurement,Tooth,Value,Unit,Note',
      'Patient,,Jane Doe,,',
      'Clinic,,Bright Smiles,,',
      'Date,,2025-11-14,,',
      'Teeth,,"13, 12, 11, 21, 22, 23",,',
      'Pupil distance,,62.0,mm,',
      'Head tilt,,0.0,°,',
      'Midline cant,,0.0,°,',
      'Lip line cant,,0.0,°,',
      "Dental midline offset,,9,%,toward patient's left",
      "Dental midline offset,,0.8,mm,toward patient's left",
      'Central width : length,11,80,%,',
      'Central width : length,21,80,%,',
      'Lateral / central,12,70,%,',
      'Lateral / central,22,70,%,',
      'Canine / central,13,49,%,',
      'Canine / central,23,49,%,',
      'Width (as seen from the front),11,8.5,mm,',
      'Length,11,10.6,mm,',
      'Width (as seen from the front),21,8.5,mm,',
      'Length,21,10.6,mm,',
      'Width (as seen from the front),12,5.9,mm,',
      'Length,12,10.3,mm,',
      'Width (as seen from the front),22,5.9,mm,',
      'Length,22,10.3,mm,',
      'Width (as seen from the front),13,4.2,mm,',
      'Length,13,10.7,mm,',
      'Width (as seen from the front),23,4.2,mm,',
      'Length,23,10.7,mm,',
      '',
    ].join('\r\n'),
  );
});

test('every line has five columns and ends in CRLF; "." for decimals, "," between columns', () => {
  const text = measurementsCsv(input());
  assert.ok(!/[^\r]\n/.test(text), 'no bare line feeds');
  assert.ok(text.endsWith('\r\n'));
  const rows = readCsv(text);
  assert.deepEqual(rows[0], [...MEASUREMENTS_FILE_HEADER]);
  for (const row of rows) assert.equal(row.length, 5, JSON.stringify(row));
  for (const row of rows.slice(6)) {
    const value = row[2];
    assert.ok(value !== undefined && (value === '' || /^\d+(\.\d)?$/.test(value)), String(value));
  }
});

test('the download is UTF-8 with a byte order mark, typed as CSV', async () => {
  const blob = measurementsFile(input({ patientName: 'José Müller' }));
  assert.equal(blob.type, 'text/csv;charset=utf-8');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  assert.equal(text, `\ufeff${measurementsCsv(input({ patientName: 'José Müller' }))}`);
  assert.ok(text.includes('José Müller') && text.includes('°'));
});

test('the same rows in the same order, whatever can be worked out', () => {
  const expected = layout(input());
  const variants: Array<[string, Partial<MeasurementsFileInput>]> = [
    ['no pupil distance', { pupilDistanceMm: null }],
    ['no design', { teeth: null }],
    ['no template', { template: undefined }],
    ['no references', { refs: null }],
    ['no canines', { teeth: design([7, 8, 9, 10]), selectedTeeth: [7, 8, 9, 10] }],
    ['no names, no teeth', { patientName: '', clinicName: '', selectedTeeth: [] }],
  ];
  for (const [what, change] of variants) assert.deepEqual(layout(input(change)), expected, what);
  assert.equal(expected.length, 29);
});

// --- no pupil distance --------------------------------------------------------------

test('no pupil distance: the mm rows stay, empty, with a note; the rest is unchanged', () => {
  const rows = measurementsFileRows(input({ pupilDistanceMm: null }));
  const full = measurementsFileRows(input());
  const mm = (r: readonly string[]) => r[3] === 'mm';

  assert.deepEqual(rows.find((r) => r[0] === 'Pupil distance'), ['Pupil distance', '', '', 'mm', 'not entered']);
  for (const row of rows.filter(mm).filter((r) => r[0] !== 'Pupil distance')) {
    assert.deepEqual([row[2], row[4]], ['', 'no pupil distance entered'], row.join(','));
  }
  assert.equal(rows.filter(mm).length, 14);
  assert.deepEqual(rows.filter((r) => !mm(r)), full.filter((r) => !mm(r)));
  assert.deepEqual(rows.find((r) => r[0] === 'Dental midline offset' && r[3] === '%'), [
    'Dental midline offset', '', '9', '%', "toward patient's left",
  ]);
});

test('a tooth the design lacks says so in mm too, ahead of the missing pupil distance', () => {
  const rows = measurementsFileRows(input({ teeth: design([7, 8, 9, 10]), pupilDistanceMm: null }));
  const note = (measurement: string, tooth: string) => rows.find((r) => r[0] === measurement && r[1] === tooth)![4];
  assert.equal(note('Canine / central', '13'), '13 not in the design');
  assert.equal(note('Width (as seen from the front)', '13'), '13 not in the design');
  assert.equal(note('Length', '23'), '23 not in the design');
  assert.equal(note('Width (as seen from the front)', '11'), 'no pupil distance entered');
});

// --- values that cannot be worked out ---------------------------------------------------

test('what cannot be worked out is an empty value with the reason, the unit kept', () => {
  const noRefs = measurementsFileRows(input({ refs: null }));
  assert.deepEqual(noRefs.find((r) => r[0] === 'Head tilt'), ['Head tilt', '', '', '°', 'no facial references']);
  assert.deepEqual(noRefs.filter((r) => r[0] === 'Dental midline offset'), [
    ['Dental midline offset', '', '', '%', 'no facial references'],
    ['Dental midline offset', '', '', 'mm', 'no facial references'],
  ]);
  // The ratios need no references; sizes in mm do.
  assert.deepEqual(noRefs.find((r) => r[0] === 'Central width : length'), ['Central width : length', '11', '80', '%', '']);
  assert.deepEqual(noRefs.find((r) => r[0] === 'Length'), ['Length', '11', '', 'mm', 'no facial references']);

  const noDesign = measurementsFileRows(input({ teeth: null }));
  for (const row of noDesign.slice(9)) assert.deepEqual([row[2], row[4]], ['', 'no design yet'], row.join(','));

  const refs = face();
  refs.leftPupil = refs.rightPupil;
  const pupils = measurementsFileRows(input({ refs }));
  assert.deepEqual(pupils.find((r) => r[0] === 'Head tilt')!.slice(2), ['', '°', 'pupils on top of each other']);
  assert.deepEqual(pupils.find((r) => r[0] === 'Width (as seen from the front)')!.slice(2), ['', 'mm', 'pupils on top of each other']);
});

test('empty names and no teeth: empty values, with a note', () => {
  const rows = measurementsFileRows(input({ patientName: '  ', clinicName: '', selectedTeeth: [] }));
  assert.deepEqual(rows.slice(1, 5), [
    ['Patient', '', '', '', 'not entered'],
    ['Clinic', '', '', '', 'not entered'],
    ['Date', '', '2025-11-14', '', ''],
    ['Teeth', '', '', '', 'no teeth selected'],
  ]);
});

// --- the file agrees with the report -------------------------------------------------

test('every number and side is the one the report shows', () => {
  const cases: Array<[string, MeasurementsFileInput]> = [
    ['as designed', input()],
    ['larger, one central widened', input({ teeth: design(ANTERIOR_SIX, { scale: 1.23 }, editTooth(nudged(-0.031), 9, { ...IDENTITY_EDIT, scaleX: 1.07 }, false)) })],
    ['narrow arch, other distance', input({ teeth: design(ANTERIOR_SIX, { archWidth: 0.83, redProportion: 0.62 }), pupilDistanceMm: 66.4 })],
    ['tilted, canted face', (() => {
      const refs = face();
      refs.leftPupil = vec(810, 331);
      refs.midlineBottom = vec(540, 700);
      refs.lipCurve = refs.lipCurve.map((p, i) => vec(p.x, p.y + i * 4));
      return input({ refs });
    })()],
  ];

  for (const [what, i] of cases) {
    const rows = measurementsFileRows(i);
    const get = (m: string, unit: string, tooth = '') => rows.find((r) => r[0] === m && r[3] === unit && r[1] === tooth)!;
    const shown = (row: readonly string[]) => `${row[2]}${row[3]}${row[4] ? `, ${row[4]}` : ''}`;
    const f = faceMeasurements(i.refs);

    assert.equal(shown(get('Head tilt', '°')), formatTilt(f.headTilt, 'report'), what);
    assert.equal(shown(get('Midline cant', '°')), formatMidline(f.midlineCant, 'report'), what);
    assert.equal(shown(get('Lip line cant', '°')), formatTilt(f.lipLineCant, 'report'), what);

    const pct = get('Dental midline offset', '%');
    const mm = get('Dental midline offset', 'mm');
    assert.equal(
      `${pct[2]}% (${mm[2]} mm)${pct[4] ? `, ${pct[4]}` : ''}`,
      formatOffset(dentalMidlineOffset(i.refs, i.teeth, i.template, i.pupilDistanceMm), 'report'),
      what,
    );

    const ratios = toothMeasurements(i.teeth, i.template);
    const sizes = toothSizes(i.refs, i.teeth, i.template, i.pupilDistanceMm);
    const fdi = { right: { central: '11', lateral: '12', canine: '13' }, left: { central: '21', lateral: '22', canine: '23' } };
    for (const side of ['right', 'left'] as const) {
      assert.equal(`${get('Central width : length', '%', fdi[side].central)[2]}%`, formatPercent(ratios[side].centralWidthToLength, 'report'));
      assert.equal(`${get('Lateral / central', '%', fdi[side].lateral)[2]}%`, formatPercent(ratios[side].lateralToCentral, 'report'));
      assert.equal(`${get('Canine / central', '%', fdi[side].canine)[2]}%`, formatPercent(ratios[side].canineToCentral, 'report'));
      for (const tooth of ['central', 'lateral', 'canine'] as const) {
        const n = fdi[side][tooth];
        assert.equal(
          `${get('Width (as seen from the front)', 'mm', n)[2]} × ${get('Length', 'mm', n)[2]}`,
          formatSize(sizes[side][tooth], 'report'),
          `${what}, ${n}`,
        );
      }
    }
  }
});

test('a centred design names no side; the side follows the pupil handles', () => {
  const centred = measurementsFileRows(input({ teeth: design() }));
  assert.deepEqual(centred.filter((r) => r[0] === 'Dental midline offset').map((r) => r.slice(2)), [
    ['0', '%', ''],
    ['0.0', 'mm', ''],
  ]);
  const right = measurementsFileRows(input({ teeth: design(ANTERIOR_SIX, {}, nudged(-0.0225)) }));
  assert.equal(right.find((r) => r[0] === 'Dental midline offset')![4], "toward patient's right");
});

// --- cells ---------------------------------------------------------------------------

test('cells are quoted only when they need it, quotes doubled', () => {
  assert.equal(csvCell('Jane Doe'), 'Jane Doe');
  assert.equal(csvCell("O'Brien"), "O'Brien");
  assert.equal(csvCell('Doe, Jane'), '"Doe, Jane"');
  assert.equal(csvCell('Jane "JD" Doe'), '"Jane ""JD"" Doe"');
  assert.equal(csvCell(' padded '), '" padded "');
  assert.equal(csvCell(''), '');
});

test('a cell a spreadsheet would run as a formula is written as text', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('+1 555 0100'), "'+1 555 0100");
  assert.equal(csvCell('-Smith'), "'-Smith");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Anne-Marie'), 'Anne-Marie');

  const rows = readCsv(measurementsCsv(input({ patientName: '=cmd|" /C calc"!A0', clinicName: '@clinic' })));
  assert.equal(rows[1]![2], `'=cmd|" /C calc"!A0`);
  assert.equal(rows[2]![2], "'@clinic");
});

test('names keep their letters, on one line, without hidden direction marks', () => {
  const rows = readCsv(measurementsCsv(input({ patientName: 'محمد\r\nعلي', clinicName: 'Clinic\u202eevil\ttab' })));
  assert.equal(rows.length, 29); // the line break in the name added no line
  assert.equal(rows[1]![2], 'محمد  علي');
  assert.equal(rows[2]![2], 'Clinicevil tab');
  // A name that is nothing but invisible marks is no name.
  assert.deepEqual(measurementsFileRows(input({ patientName: '\u202e\u2066\n' }))[1], ['Patient', '', '', '', 'not entered']);
});

test('the date is the local calendar day the file is made', () => {
  assert.deepEqual(measurementsFileRows(input({ date: new Date(2026, 0, 5, 23, 59) }))[3], ['Date', '', '2026-01-05', '', '']);
});
