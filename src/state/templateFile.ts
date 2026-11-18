/**
 * The template file: one set of tooth shapes as a JSON file.
 *
 * This is how a clinic brings its own teeth into the app. It exports a
 * template (a built-in one to start from), edits the file, and imports it.
 * An imported template lives with the case; nothing about it is app-wide.
 *
 * The file holds exactly what the fitter, the measurements and the picker
 * read: for each of the 32 teeth, keyed by FDI number, its outline, width,
 * length and incisal offset. Everything is in upper central incisor widths,
 * in the tooth's own frame (see `domain/templates/types.ts`).
 *
 * A template file is meant to be edited by hand, so reading it trusts nothing:
 * every field is checked and rebuilt, and a file that fails any check is
 * refused whole, with a message saying where and why. Writing runs the same
 * checks, so the app never exports a file it would then refuse.
 *
 * An imported template's id comes from its content, never from the file: the
 * same template always gets the same id, on any computer, and two different
 * templates never share one.
 *
 * No npm imports here: the tests run this under plain Node.
 */

import { isBuiltInTemplate, TEMPLATES } from '../domain/templates/buildTemplate.js';
import type { Template, ToothTemplate } from '../domain/templates/types.js';
import { fromFDI, isUniversal, toFDI, type Universal } from '../domain/teeth.js';
import { ownProportions, PROPORTION_LIMITS } from '../domain/templates/proportions.js';

/** Marks a JSON file as a template. Written first so it is visible at the top. */
export const TEMPLATE_FILE_FORMAT = 'smile-design-template';

/**
 * The format version this build writes, and the newest it can read. Bump it
 * whenever the file's shape changes; files with a higher version are refused.
 */
export const TEMPLATE_FILE_VERSION = 1;

/** What an imported template's id starts with. Built-in ids never do. */
export const IMPORTED_ID_PREFIX = 'custom-';

/** What the file is checked against. Sizes are in upper central incisor widths. */
export const TEMPLATE_LIMITS = {
  /** Bigger than this is not a template file: a real one is about 15 KB. */
  fileBytes: 1_000_000,
  nameChars: 60,
  descriptionChars: 200,
  width: { min: 0.2, max: 2 },
  length: { min: 0.3, max: 3 },
  /** Either way: above (positive) or below the central's incisal edge. */
  incisalOffset: 1,
  /** Any coordinate in an outline, either way from the tooth's origin. */
  coordinate: 10,
  /** Coordinate pairs in one outline. The built-in outlines have 18. */
  outlinePoints: 100,
  outlineChars: 10_000,
  /**
   * How far the drawn outline may be from what the numbers say, as a share:
   * its width against `width` and its centre against x = 0, as a share of
   * `width`; its height against `length` and its lowest point against the
   * biting edge (y = 0), as a share of `length`.
   */
  fit: 0.1,
} as const;

/** The upper central incisors (FDI), whose width is the unit of everything. */
const UPPER_CENTRALS_FDI = ['11', '21'] as const;

/** All 32 teeth, in FDI quadrant order: 11-18, 21-28, 31-38, 41-48. */
const FDI_TEETH: readonly string[] = [1, 2, 3, 4].flatMap((quadrant) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((tooth) => String(quadrant * 10 + tooth)),
);

/** One tooth as the file carries it. */
export interface TemplateFileTooth {
  width: number;
  length: number;
  incisalOffset: number;
  outline: string;
}

/** The whole file, as written. */
export interface TemplateFileJson {
  format: typeof TEMPLATE_FILE_FORMAT;
  version: number;
  name: string;
  description: string;
  /** Keyed by FDI number: "11" to "48". */
  teeth: Record<string, TemplateFileTooth>;
}

export type TemplateFileProblem =
  /** Not a template file at all: some other file was picked. */
  | 'not-a-template-file'
  /** A template file, but something in it is wrong; the message says what. */
  | 'invalid'
  /** Made for a newer version of the app than this one. */
  | 'newer-version'
  /** Exporting only: the template in memory is one a file cannot carry. */
  | 'cannot-export';

/**
 * Every failure to read or write a template file. `message` is user-facing;
 * `detail` is the bare reason, for a message about a file that carries a
 * template (a case file).
 */
export class TemplateFileError extends Error {
  readonly problem: TemplateFileProblem;
  readonly detail: string;

  constructor(problem: TemplateFileProblem, message: string, detail: string = message) {
    super(message);
    this.name = 'TemplateFileError';
    this.problem = problem;
    this.detail = detail;
  }
}

// --- writing -----------------------------------------------------------------

/**
 * The name a template is exported under. A built-in template is written as a
 * copy -- "Natural (copy)" -- because the file is a starting point for a
 * clinic's own, and a built-in name would be refused on import. An imported
 * template keeps its name, so exporting it and importing the file again gives
 * back the same template, with the same id.
 */
export function exportName(template: Template): string {
  return isBuiltInTemplate(template.id) ? `${template.name} (copy)` : template.name;
}

/**
 * A template as file JSON, under its `exportName`.
 *
 * Throws `TemplateFileError('cannot-export')` if the result would be refused
 * on import.
 */
export function templateToJson(template: Template): TemplateFileJson {
  const teeth: Record<string, TemplateFileTooth> = {};
  for (const [key, tooth] of Object.entries(template.teeth)) {
    // Not a tooth number: left out, and the check below names what is missing.
    if (!isUniversal(Number(key))) continue;
    teeth[String(toFDI(Number(key)))] = {
      width: tooth.width,
      length: tooth.length,
      incisalOffset: tooth.incisalOffset,
      outline: tooth.outline,
    };
  }

  const json: TemplateFileJson = {
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    name: exportName(template),
    description: template.description,
    teeth,
  };

  try {
    // The same checks as importing, on exactly what is about to be written.
    checkContent(json);
  } catch (error) {
    if (error instanceof Invalid) {
      throw new TemplateFileError(
        'cannot-export',
        `This template cannot be exported: ${error.detail}. This is a bug in the app, not something you did.`,
        error.detail,
      );
    }
    throw error;
  }
  return json;
}

/** A template as a file to download. */
export function writeTemplateFile(template: Template): Blob {
  return new Blob([JSON.stringify(templateToJson(template), null, 2)], {
    type: 'application/json',
  });
}

// --- reading -----------------------------------------------------------------

const NOT_A_TEMPLATE =
  'This file is not a Smile Design tooth template. Choose a template file exported from the app.';

/** Anywhere in the text, so a hand-edited file that moved it is still recognised. */
const MARKER = new RegExp(`"format"\\s*:\\s*"${TEMPLATE_FILE_FORMAT}"`);

/**
 * Read a template file (a `File` from an input is a `Blob`).
 *
 * Resolves with the whole template or rejects with a `TemplateFileError` whose
 * message can be shown as-is. Never returns a partial template.
 */
export async function readTemplateFile(file: Blob): Promise<Template> {
  if (file.size > TEMPLATE_LIMITS.fileBytes) {
    throw new TemplateFileError(
      'not-a-template-file',
      `${NOT_A_TEMPLATE} (This file is over ${TEMPLATE_LIMITS.fileBytes / 1_000_000} MB; a template is much smaller.)`,
    );
  }
  const text = await file.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // Hand editing breaks JSON easily -- a trailing comma is enough. A file
    // with the marker is a template, so say what is wrong with it, and pass on
    // the parser's words: they say where.
    if (MARKER.test(text)) {
      const where = error instanceof Error ? ` (${error.message})` : '';
      throw new TemplateFileError(
        'invalid',
        `This template file is not valid JSON${where}. Check it for a missing or extra comma, quote or bracket.`,
      );
    }
    throw new TemplateFileError('not-a-template-file', NOT_A_TEMPLATE);
  }

  return templateFromJson(json);
}

/**
 * Check parsed file JSON and build the template from it, id and all.
 *
 * Separate from `readTemplateFile` so a template carried inside another file
 * can be checked the same way.
 */
export function templateFromJson(json: unknown): Template {
  if (!isRecord(json) || json['format'] !== TEMPLATE_FILE_FORMAT) {
    throw new TemplateFileError('not-a-template-file', NOT_A_TEMPLATE, 'is not a tooth template');
  }

  const version = json['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid('version is missing or not a whole number from 1');
  }
  if (version > TEMPLATE_FILE_VERSION) {
    throw new TemplateFileError(
      'newer-version',
      `This template was made for a newer version of Smile Design (template file version ${version}; ` +
        `this app reads up to version ${TEMPLATE_FILE_VERSION}). Update the app to use it.`,
      `is template file version ${version}, newer than this app reads`,
    );
  }

  try {
    return checkContent(json);
  } catch (error) {
    if (error instanceof Invalid) throw invalid(error.detail);
    throw error;
  }
}

/** Everything after the marker and version: what importing and exporting share. */
function checkContent(json: { name?: unknown; description?: unknown; teeth?: unknown }): Template {
  const name = text(json.name, 'name', 1, TEMPLATE_LIMITS.nameChars);
  if (TEMPLATES.some((t) => sameName(t.name, name))) {
    throw new Invalid('name', `"${name}" is the name of a built-in template; give the template a name of its own`);
  }
  const description = text(json.description, 'description', 0, TEMPLATE_LIMITS.descriptionChars);
  const teeth = readTeeth(json.teeth, 'teeth');
  checkProportions(teeth);
  return { id: contentId(name, description, teeth), name, description, teeth, sliders: 'relative' };
}

/**
 * An imported template starts the Ratio and Tooth proportion sliders at its own
 * proportions, where its teeth are drawn exactly as authored. So those must be
 * values the sliders can hold, or the template could never be shown as it is.
 */
function checkProportions(teeth: Record<Universal, ToothTemplate>): void {
  const own = ownProportions(teeth)!;
  const { ratio, redProportion } = PROPORTION_LIMITS;
  // A hair of tolerance: 1 / (1 / 0.95) is 0.9500000000000001 in floating point,
  // and a length typed to hit the end of the range must not be refused for it.
  const outside = (value: number, range: { min: number; max: number }) =>
    value < range.min - 1e-9 || value > range.max + 1e-9;
  if (outside(own.ratio, ratio)) {
    const central = teeth[fromFDI(11)]!;
    throw new Invalid(
      'teeth.11',
      `is ${central.width} wide and ${show(central.length)} long, a width:length of ${show(own.ratio)}. ` +
        `It must be between ${ratio.min} and ${ratio.max}, the range of the Ratio slider, which starts ` +
        'at this tooth\'s width:length',
    );
  }
  if (outside(own.redProportion, redProportion)) {
    throw new Invalid(
      'teeth.12.width',
      `is ${teeth[fromFDI(12)]!.width}, ${show(own.redProportion)} of the width of 11. ` +
        `It must be between ${redProportion.min} and ${redProportion.max} of it, the range of the ` +
        'Tooth proportion slider, which starts at this proportion',
    );
  }
}

function invalid(detail: string): TemplateFileError {
  return new TemplateFileError('invalid', `This template cannot be used: ${detail}.`, detail);
}

// --- the open case's imports -----------------------------------------------------

/**
 * The open case's imported templates with `template` added.
 *
 * The same template again -- same id, so same content -- changes nothing. A
 * different one under a name already in the case is refused: the picker would
 * show two templates under one name. Built-in names are refused on reading.
 */
export function withImported(imported: readonly Template[], template: Template): Template[] {
  if (imported.some((t) => t.id === template.id)) return [...imported];
  const clash = imported.find((t) => sameName(t.name, template.name));
  if (clash) {
    throw new TemplateFileError(
      'invalid',
      `This template cannot be used: a different template named "${clash.name}" is already in this case. ` +
        'Give the template in the file a name of its own.',
      `a different template named "${clash.name}" is already in this case`,
    );
  }
  return [...imported, template];
}

// --- checking ----------------------------------------------------------------
//
// Each reader takes an unknown value and returns a freshly built, typed copy,
// or throws `Invalid` naming where the problem is, as a path into the file
// ("teeth.11.width"). Building copies is what keeps unknown fields out.

/** A failed check. Internal: mapped to 'invalid'. */
class Invalid extends Error {
  readonly detail: string;
  constructor(path: string, problem: string) {
    super(`${path} ${problem}`);
    this.detail = `${path} ${problem}`;
  }
}

function readTeeth(raw: unknown, path: string): Record<Universal, ToothTemplate> {
  const t = record(raw, path);

  for (const key of Object.keys(t)) {
    if (!FDI_TEETH.includes(key)) {
      throw new Invalid(`${path}.${key}`, 'is not an FDI tooth number (11-18, 21-28, 31-38, 41-48)');
    }
  }

  const teeth: Record<Universal, ToothTemplate> = {};
  for (const fdi of FDI_TEETH) {
    if (t[fdi] === undefined) {
      throw new Invalid(`${path}.${fdi}`, 'is missing: a template needs all 32 teeth');
    }
    const universal = fromFDI(Number(fdi));
    teeth[universal] = readTooth(t[fdi], `${path}.${fdi}`, universal, fdi);
  }
  return teeth;
}

function readTooth(raw: unknown, path: string, universal: Universal, fdi: string): ToothTemplate {
  const t = record(raw, path);
  const width = ranged(t['width'], `${path}.width`, TEMPLATE_LIMITS.width.min, TEMPLATE_LIMITS.width.max);
  const length = ranged(t['length'], `${path}.length`, TEMPLATE_LIMITS.length.min, TEMPLATE_LIMITS.length.max);
  const incisalOffset = ranged(
    t['incisalOffset'],
    `${path}.incisalOffset`,
    -TEMPLATE_LIMITS.incisalOffset,
    TEMPLATE_LIMITS.incisalOffset,
  );

  // The unit everything else is measured in: the fitter scales the set to the
  // face by it, and the RED proportion assumes it.
  if ((UPPER_CENTRALS_FDI as readonly string[]).includes(fdi) && width !== 1) {
    throw new Invalid(
      `${path}.width`,
      `is ${width} but must be exactly 1: every size in a template is measured in upper central incisor widths`,
    );
  }

  const { outline, bounds } = readOutline(t['outline'], `${path}.outline`);

  /*
   * The numbers must describe the drawing. The fitter spaces the teeth by
   * `width` and centres each on its slot, but draws the outline, so a
   * mismatch in width or an off-centre outline overlaps neighbours or leaves
   * gaps. The measurements report `length`, so an outline of another height
   * would be measured wrong. And the outline hangs from y = 0, the biting
   * edge the smile curve is laid along, so an outline that floats above it
   * or hangs below leaves the tooth off the curve.
   */
  const fit = TEMPLATE_LIMITS.fit;
  const drawnWidth = bounds.maxX - bounds.minX;
  if (Math.abs(drawnWidth - width) > fit * width) {
    throw new Invalid(
      `${path}.outline`,
      `is ${show(drawnWidth)} wide, more than ${percent(fit)} off the tooth's width of ${width}`,
    );
  }
  const centre = (bounds.minX + bounds.maxX) / 2;
  if (Math.abs(centre) > fit * width) {
    throw new Invalid(
      `${path}.outline`,
      `is centred at x = ${show(centre)}, but a tooth is drawn centred on x = 0 ` +
        `(allowed: within ${percent(fit)} of the tooth's width, ${show(fit * width)})`,
    );
  }
  const drawnHeight = bounds.maxY - bounds.minY;
  if (Math.abs(drawnHeight - length) > fit * length) {
    throw new Invalid(
      `${path}.outline`,
      `is ${show(drawnHeight)} high, more than ${percent(fit)} off the tooth's length of ${length}`,
    );
  }
  if (Math.abs(bounds.minY) > fit * length) {
    throw new Invalid(
      `${path}.outline`,
      `has its lowest point at y = ${show(bounds.minY)}, but the biting edge is y = 0 ` +
        `(allowed: within ${percent(fit)} of the tooth's length, ${show(fit * length)})`,
    );
  }

  return { universal, outline, width, length, incisalOffset };
}

// --- outlines ------------------------------------------------------------------

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Numbers each command takes; the commands an outline may use. */
const ARGUMENTS: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

const SEPARATORS = /[\s,]*/y;
const COMMAND = /[A-Za-z]/y;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Samples per curve when measuring an outline: ample for a 10% tolerance. */
const CURVE_SAMPLES = 64;

/**
 * Check an outline and rewrite it in the app's own form.
 *
 * One closed shape, in absolute `M`, `L`, `C`, `Q` and `Z`: the design's
 * bounding box reads an outline's numbers as x,y pairs, which relative
 * commands, `H`/`V` and arcs would silently break. Repeated arguments after a
 * command are accepted, as SVG allows, and so are commas.
 *
 * The outline is written back out with explicit commands and single spaces,
 * as the built-in outlines are, so the same shape always reads the same --
 * which is what lets the id come from the content.
 */
function readOutline(raw: unknown, path: string): { outline: string; bounds: Bounds } {
  const d = string(raw, path);
  if (d.length > TEMPLATE_LIMITS.outlineChars) {
    throw new Invalid(path, `is longer than ${TEMPLATE_LIMITS.outlineChars} characters`);
  }

  const tokens = tokenize(d, path);
  if (tokens[0] !== 'M') throw new Invalid(path, 'must start with M');

  const segments: { command: string; numbers: number[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++] as string;
    if (segments.at(-1)?.command === 'Z') {
      throw new Invalid(path, 'must be one closed shape: nothing may follow Z');
    }
    if (command === 'M' && segments.length > 0) {
      throw new Invalid(path, 'must be one closed shape: it has a second M');
    }
    const count = ARGUMENTS[command]!;
    if (count === 0) {
      if (typeof tokens[i] === 'number') throw new Invalid(path, 'has numbers after Z');
      segments.push({ command, numbers: [] });
      continue;
    }
    // A command followed by several sets of numbers repeats; after M, as L.
    let repeated = command;
    do {
      const numbers = tokens.slice(i, i + count);
      if (numbers.length < count || numbers.some((n) => typeof n !== 'number')) {
        throw new Invalid(path, `has a ${command} without its ${count} numbers`);
      }
      segments.push({ command: repeated, numbers: numbers as number[] });
      i += count;
      if (repeated === 'M') repeated = 'L';
    } while (typeof tokens[i] === 'number');
  }
  if (segments.at(-1)?.command !== 'Z') {
    throw new Invalid(path, 'must end with Z: the outline must be a closed shape');
  }

  const numbers = segments.flatMap((s) => s.numbers);
  if (numbers.length / 2 > TEMPLATE_LIMITS.outlinePoints) {
    throw new Invalid(path, `has more than ${TEMPLATE_LIMITS.outlinePoints} points`);
  }
  for (const n of numbers) {
    if (!Number.isFinite(n) || Math.abs(n) > TEMPLATE_LIMITS.coordinate) {
      throw new Invalid(path, `has a coordinate (${n}) outside -${TEMPLATE_LIMITS.coordinate} to ${TEMPLATE_LIMITS.coordinate}`);
    }
  }

  const outline = segments
    .map(({ command, numbers: n }) => (n.length > 0 ? `${command} ${n.join(' ')}` : command))
    .join(' ');
  return { outline, bounds: boundsOf(segments) };
}

function tokenize(d: string, path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  let at = 0;
  const match = (pattern: RegExp): string | null => {
    pattern.lastIndex = at;
    const found = pattern.exec(d);
    if (!found) return null;
    at = pattern.lastIndex;
    return found[0];
  };

  for (;;) {
    match(SEPARATORS);
    if (at >= d.length) return tokens;
    const number = match(NUMBER);
    if (number !== null) {
      tokens.push(Number(number));
      continue;
    }
    const command = match(COMMAND);
    if (command !== null && Object.hasOwn(ARGUMENTS, command)) {
      tokens.push(command);
      continue;
    }
    if (command !== null) {
      throw new Invalid(
        path,
        `uses "${command}": only the absolute commands M, L, C, Q and Z are allowed ` +
          '(no lowercase relative commands, H, V, S, T or A)',
      );
    }
    throw new Invalid(path, `has "${d[at]}" where a command or number should be`);
  }
}

/** The drawn extent of an outline: lines by their ends, curves sampled. */
function boundsOf(segments: readonly { command: string; numbers: number[] }[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
  };

  let x = 0;
  let y = 0;
  for (const { command, numbers: n } of segments) {
    if (command === 'C') {
      const [x1, y1, x2, y2, x3, y3] = n as [number, number, number, number, number, number];
      for (let k = 1; k <= CURVE_SAMPLES; k++) {
        const t = k / CURVE_SAMPLES;
        const u = 1 - t;
        add(
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
    } else if (command === 'Q') {
      const [x1, y1, x2, y2] = n as [number, number, number, number];
      for (let k = 1; k <= CURVE_SAMPLES; k++) {
        const t = k / CURVE_SAMPLES;
        const u = 1 - t;
        add(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2);
      }
      x = x2;
      y = y2;
    } else if (command === 'M' || command === 'L') {
      [x, y] = n as [number, number];
      add(x, y);
    }
    // Z draws back to the start, which is already counted.
  }
  return b;
}

// --- the id ----------------------------------------------------------------------

/**
 * An imported template's id: a hash of everything the file says.
 *
 * Computed from the checked, rewritten template, so formatting, spacing and
 * field order in the file make no difference, while any change to a name, a
 * number or a shape gives a different id. FNV-1a, 64 bits: this tells templates
 * apart, it does not protect anything.
 */
function contentId(name: string, description: string, teeth: Record<Universal, ToothTemplate>): string {
  const canonical = JSON.stringify([
    name,
    description,
    FDI_TEETH.map((fdi) => {
      const t = teeth[fromFDI(Number(fdi))]!;
      return [fdi, t.width, t.length, t.incisalOffset, t.outline];
    }),
  ]);

  const MASK = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & MASK;
  }
  return IMPORTED_ID_PREFIX + hash.toString(16).padStart(16, '0');
}

// --- small checkers ------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new Invalid(path, 'is missing or not an object');
  return raw;
}

function string(raw: unknown, path: string): string {
  if (typeof raw !== 'string') throw new Invalid(path, 'is missing or not text');
  return raw;
}

function ranged(raw: unknown, path: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Invalid(path, 'is missing or not a number');
  }
  if (raw < min || raw > max) throw new Invalid(path, `is ${raw}, not between ${min} and ${max}`);
  return raw;
}

/**
 * Invisible characters that would make a name show as something else: control
 * characters, and the direction embeddings, overrides and isolates.
 */
const HIDDEN = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

/** Text shown in the picker: trimmed, `min`-`max` characters, nothing hidden. */
function text(raw: unknown, path: string, min: number, max: number): string {
  const value = string(raw, path).trim();
  if (HIDDEN.test(value)) {
    throw new Invalid(path, 'contains a line break, tab or other hidden character');
  }
  const chars = Array.from(value).length;
  if (chars < min) throw new Invalid(path, 'is empty');
  if (chars > max) throw new Invalid(path, `is longer than ${max} characters`);
  return value;
}

function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.normalize('NFC').trim().toLowerCase();
  return key(a) === key(b);
}

/** A number as a message shows it. */
const show = (n: number): string => String(Math.round(n * 1000) / 1000);

const percent = (share: number): string => `${Math.round(share * 100)}%`;
