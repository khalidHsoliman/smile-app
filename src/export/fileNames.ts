/**
 * Names for the files the app downloads.
 *
 * Every download is named after the patient through `patientSlug`, so the
 * report images and the case file of one patient sort together in a folder.
 *
 * No npm imports: the tests run this under plain Node.
 */

import { CASE_FILE_EXTENSION } from '../state/caseFile.js';

/**
 * The most a name may take in a file name, in UTF-8 bytes.
 *
 * File systems cap a name at 255 bytes, not characters, and a letter can take
 * up to 4 (Arabic 2, Chinese 3). This leaves ample room for the date or label
 * and the extension, and still fits about 60 Arabic or 40 Chinese letters.
 */
const MAX_NAME_BYTES = 120;

/**
 * The patient's name, made safe for a file name on every system.
 *
 * Letters, their accents and vowel marks, and digits are kept, from any
 * language -- "José Müller" stays `josé-müller` and Arabic stays Arabic.
 * Everything else becomes a single hyphen: spaces and punctuation (as always),
 * the characters some system forbids (`/ \ : * ? " < > |`), control
 * characters, and the invisible direction overrides that can make a file name
 * display as something else. Lowercased, as the names always were; normalized
 * so the same name typed two ways gives the same file name.
 *
 * Empty when nothing is left -- no name, or only symbols.
 */
export function patientSlug(patientName: string): string {
  const slug = patientName
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return truncateUtf8(slug, MAX_NAME_BYTES).replace(/-+$/, '');
}

/**
 * Cut `text` to at most `maxBytes` of UTF-8, between whole characters, and
 * never between a letter and the marks that belong to it.
 */
function truncateUtf8(text: string, maxBytes: number): string {
  const chars = Array.from(text);
  const encoder = new TextEncoder();
  let bytes = 0;
  let end = 0;
  while (end < chars.length) {
    const size = encoder.encode(chars[end]).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end++;
  }
  // If the cut falls before a mark, the letter it belongs to goes as well.
  while (end > 0 && end < chars.length && /\p{M}/u.test(chars[end]!)) end--;
  return chars.slice(0, end).join('');
}

/** A report image: `jane-doe-smile-after.png`, or `patient-smile-after.png`. */
export function reportImageFileName(patientName: string, label: string): string {
  return `${patientSlug(patientName) || 'patient'}-${label}.png`;
}

/**
 * The report's measurements as a CSV file, named like the report images:
 * `jane-doe-measurements.csv`, or `patient-measurements.csv`.
 */
export function measurementsFileName(patientName: string): string {
  return `${patientSlug(patientName) || 'patient'}-measurements.csv`;
}

/** The local calendar day, `2025-11-14`. */
export function localDay(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * A case file: `jane-doe-2025-11-14.smilecase`, or `2025-11-14.smilecase`
 * without a name. The date is the local calendar day.
 */
export function caseFileName(patientName: string, date: Date): string {
  const name = patientSlug(patientName);
  return `${name ? `${name}-` : ''}${localDay(date)}${CASE_FILE_EXTENSION}`;
}
