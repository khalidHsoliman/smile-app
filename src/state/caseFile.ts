/**
 * The case file: one whole case as a single `.smilecase` file.
 *
 * This is how a case outlives "New case" and moves to another computer. The
 * file is JSON with the photos embedded as base64, so it needs nothing to read
 * but the app -- and nothing to write it but the browser. It never touches a
 * server: the clinician downloads it and carries it, like any patient record.
 *
 * It holds exactly what the autosave holds (the case's *inputs*; everything
 * derived is recomputed on open) plus a format marker, a format version and
 * the save time.
 *
 * A file comes from outside the app, so reading it trusts nothing: every field
 * is checked and rebuilt before it reaches the store, and a file that fails
 * any check is refused whole rather than half-loaded. Writing runs the same
 * checks, so the app can never produce a file it would then refuse to open.
 *
 * No npm imports here, only types: the tests run this under plain Node.
 */

import type { StoredCase, StoredPhoto } from './persistence.js';
import type { FineTuneParams, PhotoKind } from './store.js';
import type { FacialReferences } from '../domain/faceFrame.js';
import type { PointPair } from '../domain/similarity.js';
import type { Matrix2D, Vec2 } from '../domain/geometry.js';
import type { ToothEdit, ToothEdits } from '../domain/toothEdits.js';
import type { ToothPalette } from '../vision/sampleToothColor.js';
import { isUniversal, type Universal } from '../domain/teeth.js';
import { ACCEPTED_TYPES } from '../features/upload/loadPhoto.js';

/** Marks a JSON file as ours. Written first so it is visible at the top. */
export const CASE_FILE_FORMAT = 'smile-design-case';

/**
 * The format version this build writes, and the newest it can open.
 *
 * Bump it whenever the file's shape changes, and add a step to `UPGRADES` that
 * turns the previous version's body into the new one -- old files must always
 * keep opening. Files with a higher version are refused.
 */
export const CASE_FILE_VERSION = 1;

export const CASE_FILE_EXTENSION = '.smilecase';

/** A photo as the case file carries it: the bytes, without legacy fields. */
export type CasePhoto = Omit<StoredPhoto, 'rotation'>;

/**
 * The content of a case: the autosaved case without its storage key and save
 * time. `restoreCase({ id, savedAt, ...content })` loads it.
 */
export type CaseContent = Omit<StoredCase, 'id' | 'savedAt' | 'photos'> & {
  photos: Partial<Record<PhotoKind, CasePhoto>>;
};

/** A successfully read case file. */
export interface OpenedCase {
  /** When the file was saved, epoch milliseconds. */
  savedAt: number;
  content: CaseContent;
}

export type CaseFileProblem =
  /** Not a case file at all: some other file was picked. */
  | 'not-a-case-file'
  /** A case file, but cut short or altered: something in it is wrong. */
  | 'damaged'
  /** Saved by a newer version of the app than this one. */
  | 'newer-version'
  /** Writing only: the case in memory holds something a file cannot carry. */
  | 'cannot-save';

/** Every failure to read or write a case file. `message` is user-facing. */
export class CaseFileError extends Error {
  readonly problem: CaseFileProblem;

  constructor(problem: CaseFileProblem, message: string) {
    super(message);
    this.name = 'CaseFileError';
    this.problem = problem;
  }
}

// --- writing -----------------------------------------------------------------

/**
 * Turn a case into a `.smilecase` file.
 *
 * Only the known fields are copied, so nothing else in the store can leak into
 * a file that leaves the browser. Throws `CaseFileError('cannot-save')` if the
 * case holds something the file could not carry faithfully -- a NaN, say,
 * which JSON would silently turn into null.
 */
export async function writeCaseFile(content: CaseContent, savedAt: Date = new Date()): Promise<Blob> {
  const photos: Record<string, unknown> = {};
  for (const kind of PHOTO_KINDS) {
    const photo = content.photos[kind];
    if (!photo) continue;
    const bytes = new Uint8Array(await photo.blob.arrayBuffer());
    // The type the bytes really are, not the one the browser reported: that
    // comes from the file name, so a JPEG named .png arrives as image/png, and
    // recording it would write a file that opening then refuses as damaged.
    const type = ACCEPTED_TYPES.find((t) => SIGNATURES[t](bytes));
    if (!type) {
      throw new CaseFileError(
        'cannot-save',
        `This case cannot be saved to a file: the ${kind} photo is not a JPEG, PNG or WebP image.`,
      );
    }
    photos[kind] = { type, width: photo.width, height: photo.height, data: toBase64(bytes) };
  }

  let body: Omit<CaseContent, 'photos'>;
  try {
    if (Number.isNaN(savedAt.getTime())) throw new Invalid('savedAt', 'is not a valid date');
    // The same checks as opening, run on what is about to be written. The
    // result is a fresh copy holding the known fields only.
    body = readBody({ ...content, photos }).body;
  } catch (error) {
    if (error instanceof Invalid) {
      throw new CaseFileError(
        'cannot-save',
        `This case cannot be saved to a file: ${error.detail}. This is a bug in the app, not something you did.`,
      );
    }
    throw error;
  }

  const file = {
    format: CASE_FILE_FORMAT,
    version: CASE_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    // The photos go last: a person opening the file sees the short, readable
    // fields first rather than megabytes of base64.
    case: { ...body, photos },
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

// --- reading -----------------------------------------------------------------

const NOT_A_CASE =
  'This file is not a Smile Design case. Choose a file that ends in .smilecase.';

/**
 * Read a `.smilecase` file (a `File` from an input is a `Blob`).
 *
 * Resolves with the whole case or rejects with a `CaseFileError` whose message
 * can be shown as-is. Never returns a partial case.
 */
export async function readCaseFile(file: Blob): Promise<OpenedCase> {
  const text = await file.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // A case file cut short (an interrupted copy) is no longer valid JSON, but
    // still starts with the marker -- which says "damaged", not "wrong file".
    if (MARKER_AT_START.test(text.slice(0, 200))) {
      throw damaged('the file is incomplete');
    }
    throw new CaseFileError('not-a-case-file', NOT_A_CASE);
  }

  if (!isRecord(json) || json['format'] !== CASE_FILE_FORMAT) {
    throw new CaseFileError('not-a-case-file', NOT_A_CASE);
  }

  const version = json['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw damaged('its format version is missing or invalid');
  }
  if (version > CASE_FILE_VERSION) {
    throw new CaseFileError(
      'newer-version',
      `This case was saved by a newer version of Smile Design (case file version ${version}; ` +
        `this app opens up to version ${CASE_FILE_VERSION}). Update the app to open it.`,
    );
  }

  try {
    const savedAt = typeof json['savedAt'] === 'string' ? Date.parse(json['savedAt']) : NaN;
    if (Number.isNaN(savedAt)) throw new Invalid('savedAt', 'is not a valid date');

    const { body, photos } = readBody(upgrade(version, json['case']));

    const restored: CaseContent['photos'] = {};
    for (const [kind, photo] of photos) {
      restored[kind] = {
        blob: decodePhoto(photo, `case.photos.${kind}`),
        width: photo.width,
        height: photo.height,
      };
    }
    return { savedAt, content: { ...body, photos: restored } };
  } catch (error) {
    if (error instanceof Invalid) throw damaged(error.detail);
    throw error;
  }
}

const MARKER_AT_START = new RegExp(`^\\s*\\{\\s*"format"\\s*:\\s*"${CASE_FILE_FORMAT}"`);

function damaged(detail: string): CaseFileError {
  return new CaseFileError(
    'damaged',
    `This case file is damaged and cannot be opened (${detail}).`,
  );
}

/**
 * Bring an older file's body up to the current version, one version at a
 * time. `UPGRADES[n]` turns a version-n body into a version-(n+1) body.
 */
const UPGRADES: Record<number, (body: unknown) => unknown> = {};

function upgrade(version: number, body: unknown): unknown {
  let current = body;
  for (let v = version; v < CASE_FILE_VERSION; v++) {
    const step = UPGRADES[v];
    if (!step) throw new Error(`No upgrade from case file version ${v}`);
    current = step(current);
  }
  return current;
}

// --- checking ----------------------------------------------------------------
//
// Each reader takes an unknown value and returns a freshly built, typed copy,
// or throws `Invalid` naming where the problem is. Building copies (rather than
// casting) is what keeps unknown extra fields out of the store.

/** A failed check. Internal: mapped to 'damaged' or 'cannot-save'. */
class Invalid extends Error {
  readonly detail: string;
  constructor(path: string, problem: string) {
    super(`${path} ${problem}`);
    this.detail = `${path} ${problem}`;
  }
}

const PHOTO_KINDS = ['smile', 'retracted'] as const satisfies readonly PhotoKind[];

/** Photo fields as they sit in the file, before the bytes are decoded. */
interface PhotoFields {
  type: string;
  width: number;
  height: number;
  data: string;
}

function readBody(raw: unknown): {
  body: Omit<CaseContent, 'photos'>;
  photos: Map<PhotoKind, PhotoFields>;
} {
  const c = record(raw, 'case');

  const photos = new Map<PhotoKind, PhotoFields>();
  const rawPhotos = record(c['photos'], 'case.photos');
  for (const kind of PHOTO_KINDS) {
    if (rawPhotos[kind] !== undefined) {
      photos.set(kind, photoFields(rawPhotos[kind], `case.photos.${kind}`));
    }
  }

  const body: Omit<CaseContent, 'photos'> = {
    report: report(c['report'], 'case.report'),
    selectedTeeth: array(c['selectedTeeth'], 'case.selectedTeeth', tooth),
    refs: c['refs'] === null ? null : facialReferences(c['refs'], 'case.refs'),
    // Optional: absent in cases saved before matching existed.
    ...(c['matching'] !== undefined && { matching: matching(c['matching'], 'case.matching') }),
    design: design(c['design'], 'case.design'),
  };

  return { body, photos };
}

function report(raw: unknown, path: string): CaseContent['report'] {
  const r = record(raw, path);
  return {
    patientName: string(r['patientName'], `${path}.patientName`),
    clinicName: string(r['clinicName'], `${path}.clinicName`),
  };
}

function facialReferences(raw: unknown, path: string): FacialReferences {
  const r = record(raw, path);
  const refs: FacialReferences = {
    leftPupil: vec2(r['leftPupil'], `${path}.leftPupil`),
    rightPupil: vec2(r['rightPupil'], `${path}.rightPupil`),
    leftAla: vec2(r['leftAla'], `${path}.leftAla`),
    rightAla: vec2(r['rightAla'], `${path}.rightAla`),
    midlineTop: vec2(r['midlineTop'], `${path}.midlineTop`),
    midlineBottom: vec2(r['midlineBottom'], `${path}.midlineBottom`),
    lipCurve: array(r['lipCurve'], `${path}.lipCurve`, vec2),
  };
  if (r['mouthAperture'] !== undefined) {
    refs.mouthAperture = array(r['mouthAperture'], `${path}.mouthAperture`, vec2);
  }
  return refs;
}

function matching(raw: unknown, path: string): NonNullable<CaseContent['matching']> {
  const m = record(raw, path);
  const result: NonNullable<CaseContent['matching']> = {
    pairs: array(m['pairs'], `${path}.pairs`, pointPair),
    nudge: vec2(m['nudge'], `${path}.nudge`),
    confirmed: boolean(m['confirmed'], `${path}.confirmed`),
  };
  if (m['refinement'] !== undefined) {
    result.refinement =
      m['refinement'] === null ? null : matrix(m['refinement'], `${path}.refinement`);
  }
  return result;
}

function design(raw: unknown, path: string): CaseContent['design'] {
  const d = record(raw, path);
  const templateId = d['templateId'];
  const result: CaseContent['design'] = {
    templateId: templateId === null ? null : string(templateId, `${path}.templateId`),
    params: params(d['params'], `${path}.params`),
    palette: palette(d['palette'], `${path}.palette`),
    paletteSampled: boolean(d['paletteSampled'], `${path}.paletteSampled`),
    edits: edits(d['edits'], `${path}.edits`),
    teethOpacity: finite(d['teethOpacity'], `${path}.teethOpacity`),
    lipMask: boolean(d['lipMask'], `${path}.lipMask`),
    mirrorMode: boolean(d['mirrorMode'], `${path}.mirrorMode`),
  };
  if (d['photoBlend'] !== undefined) {
    result.photoBlend = boolean(d['photoBlend'], `${path}.photoBlend`);
  }
  return result;
}

function params(raw: unknown, path: string): FineTuneParams {
  const p = record(raw, path);
  return {
    ratio: finite(p['ratio'], `${path}.ratio`),
    scale: finite(p['scale'], `${path}.scale`),
    smileCurve: finite(p['smileCurve'], `${path}.smileCurve`),
    occlusalGap: finite(p['occlusalGap'], `${path}.occlusalGap`),
    redProportion: finite(p['redProportion'], `${path}.redProportion`),
    archWidth: finite(p['archWidth'], `${path}.archWidth`),
  };
}

/**
 * Strictly `#rrggbb`. The palette ends up in CSS and SVG fills, where anything
 * looser (a `url(...)`, say) could make the browser fetch from elsewhere.
 */
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function palette(raw: unknown, path: string): ToothPalette {
  const p = record(raw, path);
  const colour = (key: keyof ToothPalette): string => {
    const value = string(p[key], `${path}.${key}`);
    if (!HEX_COLOUR.test(value)) throw new Invalid(`${path}.${key}`, 'is not a #rrggbb colour');
    return value;
  };
  return {
    base: colour('base'),
    highlight: colour('highlight'),
    cervical: colour('cervical'),
    incisal: colour('incisal'),
  };
}

function edits(raw: unknown, path: string): ToothEdits {
  const e = record(raw, path);
  const result: ToothEdits = {};
  for (const [key, value] of Object.entries(e)) {
    const n = Number(key);
    if (String(n) !== key || !isUniversal(n)) {
      throw new Invalid(`${path}.${key}`, 'is not a tooth number');
    }
    result[n] = toothEdit(value, `${path}.${key}`);
  }
  return result;
}

function toothEdit(raw: unknown, path: string): ToothEdit {
  const t = record(raw, path);
  return {
    offset: vec2(t['offset'], `${path}.offset`),
    rotation: finite(t['rotation'], `${path}.rotation`),
    scaleX: finite(t['scaleX'], `${path}.scaleX`),
    scaleY: finite(t['scaleY'], `${path}.scaleY`),
  };
}

function photoFields(raw: unknown, path: string): PhotoFields {
  const p = record(raw, path);
  const type = string(p['type'], `${path}.type`);
  if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
    throw new Invalid(`${path}.type`, `is not a supported image type (${type || 'none'})`);
  }
  return {
    type,
    width: dimension(p['width'], `${path}.width`),
    height: dimension(p['height'], `${path}.height`),
    data: string(p['data'], `${path}.data`),
  };
}

/** The first bytes of each accepted image type. */
const SIGNATURES: Record<(typeof ACCEPTED_TYPES)[number], (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte),
  'image/webp': (b) =>
    ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
};

function decodePhoto(photo: PhotoFields, path: string): Blob {
  const bytes = fromBase64(photo.data);
  if (!bytes) throw new Invalid(`${path}.data`, 'is not valid photo data');
  const matches = SIGNATURES[photo.type as keyof typeof SIGNATURES];
  if (!matches(bytes)) {
    throw new Invalid(`${path}.data`, `is not a ${photo.type.slice('image/'.length).toUpperCase()} image`);
  }
  return new Blob([bytes], { type: photo.type });
}

// --- small checkers ------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new Invalid(path, 'is missing or not an object');
  return raw;
}

function array<T>(raw: unknown, path: string, item: (raw: unknown, path: string) => T): T[] {
  if (!Array.isArray(raw)) throw new Invalid(path, 'is missing or not a list');
  return raw.map((value, i) => item(value, `${path}[${i}]`));
}

function string(raw: unknown, path: string): string {
  if (typeof raw !== 'string') throw new Invalid(path, 'is missing or not text');
  return raw;
}

function boolean(raw: unknown, path: string): boolean {
  if (typeof raw !== 'boolean') throw new Invalid(path, 'is missing or not true/false');
  return raw;
}

function finite(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Invalid(path, 'is missing or not a number');
  }
  return raw;
}

function dimension(raw: unknown, path: string): number {
  const n = finite(raw, path);
  if (!Number.isInteger(n) || n <= 0) throw new Invalid(path, 'is not a positive whole number');
  return n;
}

function tooth(raw: unknown, path: string): Universal {
  const n = finite(raw, path);
  if (!isUniversal(n)) throw new Invalid(path, 'is not a tooth number (1-32)');
  return n;
}

function vec2(raw: unknown, path: string): Vec2 {
  const v = record(raw, path);
  return { x: finite(v['x'], `${path}.x`), y: finite(v['y'], `${path}.y`) };
}

function pointPair(raw: unknown, path: string): PointPair {
  const p = record(raw, path);
  return { source: vec2(p['source'], `${path}.source`), target: vec2(p['target'], `${path}.target`) };
}

function matrix(raw: unknown, path: string): Matrix2D {
  const m = record(raw, path);
  return {
    a: finite(m['a'], `${path}.a`),
    b: finite(m['b'], `${path}.b`),
    c: finite(m['c'], `${path}.c`),
    d: finite(m['d'], `${path}.d`),
    e: finite(m['e'], `${path}.e`),
    f: finite(m['f'], `${path}.f`),
  };
}

// --- bytes -------------------------------------------------------------------

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** Chunked: spreading a multi-megabyte array into one call overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Null for anything that is not base64. */
function fromBase64(data: string) {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
