/**
 * The report's measurements as a CSV file, for the lab.
 *
 * Everything the report shows, one value per row, in a fixed layout: every
 * file has the same five columns and the same rows in the same order, whether
 * or not a value could be worked out, so a lab's spreadsheet or import can rely
 * on it. A value that cannot be worked out is left empty, with the reason in
 * the last column. Numbers are rounded exactly as the report shows them, by
 * the same code, so the file and the printout cannot disagree.
 *
 * The format is fixed, not the browser's: UTF-8 with a byte order mark (so
 * Excel reads accented and non-Latin names, ° and × correctly), "," between
 * columns, "." for decimals, CRLF line ends, and quotes only where a value
 * needs them (RFC 4180).
 *
 * The file leaves the browser with the patient's name in it, and a spreadsheet
 * runs a cell that starts with "=", "+", "-" or "@" as a formula. Every cell
 * that would is written with a leading apostrophe, so it opens as plain text,
 * the apostrophe showing -- a name cannot run anything on the lab's computer.
 *
 * No npm imports, no DOM: the tests run this under plain Node.
 */

import {
  angleSideShown,
  degreesText,
  dentalMidlineOffset,
  faceMeasurements,
  isUsablePupilDistance,
  midlineDirection,
  mmText,
  NO_PUPIL_DISTANCE,
  offsetDirection,
  offsetSideShown,
  percentText,
  PUPIL_DISTANCE_MM,
  tiltDirection,
  toothMeasurements,
  toothSizes,
  type Angle,
  type Measurement,
  type Side,
  type SideTeethMeasurements,
  type SideToothSizes,
} from '../domain/measurements.js';
import type { FacialReferences } from '../domain/faceFrame.js';
import type { PlacedTooth } from '../domain/fitting.js';
import type { Template } from '../domain/templates/types.js';
import { toFDI, type Universal } from '../domain/teeth.js';
import { localDay } from './fileNames.js';

/** What the report shows, and the day the file is made. */
export interface MeasurementsFileInput {
  patientName: string;
  clinicName: string;
  date: Date;
  selectedTeeth: readonly Universal[];
  refs: FacialReferences | null;
  /** The design as shown: the fit with the per-tooth edits applied. */
  teeth: readonly PlacedTooth[] | null;
  template: Template | undefined;
  pupilDistanceMm: number | null;
}

/** Measurement, Tooth, Value, Unit, Note. */
export type MeasurementsFileRow = readonly [string, string, string, string, string];

export const MEASUREMENTS_FILE_HEADER: MeasurementsFileRow = [
  'Measurement',
  'Tooth',
  'Value',
  'Unit',
  'Note',
];

/** The note on a size in mm when no pupil distance was entered. */
const NO_PUPIL_DISTANCE_NOTE = 'no pupil distance entered';

/** FDI numbers of the upper central, lateral and canine on each side. */
const TEETH: Record<Side, { central: string; lateral: string; canine: string }> = {
  right: { central: '11', lateral: '12', canine: '13' },
  left: { central: '21', lateral: '22', canine: '23' },
};

/** The same rows, in the same order, every time. The header row first. */
export function measurementsFileRows(input: MeasurementsFileInput): MeasurementsFileRow[] {
  const { refs, teeth, template, pupilDistanceMm } = input;
  const rows: MeasurementsFileRow[] = [MEASUREMENTS_FILE_HEADER];

  // A reason for the lab, not an instruction to the clinician.
  const why = (reason: string): string =>
    reason === NO_PUPIL_DISTANCE ? NO_PUPIL_DISTANCE_NOTE : reason;

  const text = (measurement: string, raw: string, whenEmpty: string) => {
    const value = cleanText(raw).trim();
    rows.push([measurement, '', value, '', value === '' ? whenEmpty : '']);
  };

  // --- the report's header ---
  text('Patient', input.patientName, 'not entered');
  text('Clinic', input.clinicName, 'not entered');
  text('Date', localDay(input.date), '');
  text('Teeth', input.selectedTeeth.map(toFDI).join(', '), 'no teeth selected');

  const pd = pupilDistanceMm;
  rows.push(
    pd === null
      ? ['Pupil distance', '', '', 'mm', 'not entered']
      : isUsablePupilDistance(pd)
        ? ['Pupil distance', '', mmText(pd), 'mm', '']
        : ['Pupil distance', '', '', 'mm', `must be ${PUPIL_DISTANCE_MM.min}–${PUPIL_DISTANCE_MM.max} mm`],
  );

  // --- the face ---
  const face = faceMeasurements(refs);
  const angle = (measurement: string, m: Measurement<Angle>, wording: (side: Side) => string) => {
    if (!m.ok) return rows.push([measurement, '', '', '°', why(m.reason)]);
    const side = angleSideShown(m.value);
    return rows.push([measurement, '', degreesText(m.value.degrees), '°', side ? wording(side) : '']);
  };
  angle('Head tilt', face.headTilt, tiltDirection);
  angle('Midline cant', face.midlineCant, midlineDirection);
  angle('Lip line cant', face.lipLineCant, tiltDirection);

  // --- the dental midline offset: a % row and an mm row ---
  const offset = dentalMidlineOffset(refs, teeth, template, pd);
  if (offset.ok) {
    const side = offsetSideShown(offset.value);
    const direction = side ? offsetDirection(side) : '';
    rows.push(['Dental midline offset', '', percentText(offset.value.fraction), '%', direction]);
    rows.push(
      offset.value.mm === null
        ? ['Dental midline offset', '', '', 'mm', pd === null ? NO_PUPIL_DISTANCE_NOTE : 'no usable pupil distance']
        : ['Dental midline offset', '', mmText(offset.value.mm), 'mm', direction],
    );
  } else {
    rows.push(['Dental midline offset', '', '', '%', why(offset.reason)]);
    rows.push(['Dental midline offset', '', '', 'mm', why(offset.reason)]);
  }

  // --- the upper teeth: ratios, right side then left, as the report reads ---
  const ratios = toothMeasurements(teeth, template);
  const ratio = (measurement: string, tooth: string, m: Measurement<number>) =>
    rows.push(m.ok ? [measurement, tooth, percentText(m.value), '%', ''] : [measurement, tooth, '', '%', why(m.reason)]);
  const ratioRows: Array<[string, keyof SideTeethMeasurements, keyof SideToothSizes]> = [
    ['Central width : length', 'centralWidthToLength', 'central'],
    ['Lateral / central', 'lateralToCentral', 'lateral'],
    ['Canine / central', 'canineToCentral', 'canine'],
  ];
  for (const [measurement, key, tooth] of ratioRows) {
    for (const side of ['right', 'left'] as const) {
      ratio(measurement, TEETH[side][tooth], ratios[side][key]);
    }
  }

  // --- the upper teeth in mm: width then length, per tooth ---
  const sizes = toothSizes(refs, teeth, template, pd);
  for (const tooth of ['central', 'lateral', 'canine'] as const) {
    for (const side of ['right', 'left'] as const) {
      const fdi = TEETH[side][tooth];
      const m = sizes[side][tooth];
      if (m.ok) {
        rows.push(['Width (as seen from the front)', fdi, mmText(m.value.width), 'mm', '']);
        rows.push(['Length', fdi, mmText(m.value.length), 'mm', '']);
      } else {
        rows.push(['Width (as seen from the front)', fdi, '', 'mm', why(m.reason)]);
        rows.push(['Length', fdi, '', 'mm', why(m.reason)]);
      }
    }
  }

  return rows;
}

/**
 * Text as one line: line breaks, tabs and other control characters become
 * spaces, and the invisible marks that reorder how text displays are dropped,
 * as in file names.
 */
function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
}

/**
 * One cell as CSV: cleaned to one line; with a leading apostrophe if a
 * spreadsheet would run it as a formula; quoted only when it holds a comma, a
 * quote, or spaces at its ends.
 */
export function csvCell(value: string): string {
  let cell = cleanText(value);
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  return /[",]|^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** The file's text, without the byte order mark. */
export function measurementsCsv(input: MeasurementsFileInput): string {
  return measurementsFileRows(input)
    .map((row) => row.map(csvCell).join(','))
    .map((line) => `${line}\r\n`)
    .join('');
}

/** The file, ready to download: UTF-8 with a byte order mark. */
export function measurementsFile(input: MeasurementsFileInput): Blob {
  return new Blob(['\ufeff', measurementsCsv(input)], { type: 'text/csv;charset=utf-8' });
}
