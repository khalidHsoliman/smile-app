import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseFileName, patientSlug, reportImageFileName } from '../../src/export/fileNames.js';

const utf8 = (s: string) => new TextEncoder().encode(s).length;

test('letters from any language are kept, lowercased where the script has case', () => {
  assert.equal(patientSlug('Jane Doe'), 'jane-doe');
  assert.equal(patientSlug('José Müller'), 'josé-müller');
  assert.equal(patientSlug('محمد علي'), 'محمد-علي');
  assert.equal(patientSlug('שרה לוי'), 'שרה-לוי');
  assert.equal(patientSlug('山田 太郎'), '山田-太郎');
  assert.equal(patientSlug('Сергей Иванов'), 'сергей-иванов');
  assert.equal(patientSlug('राम शर्मा'), 'राम-शर्मा'); // vowel signs are marks: kept
  assert.equal(patientSlug('٣ محمد'), '٣-محمد'); // digits in any script too
});

test('the same name typed two ways gives the same file name', () => {
  // "é" as one character, and as "e" plus a combining accent (macOS input).
  assert.equal(patientSlug('Jos\u00e9'), patientSlug('Jose\u0301'));
});

test('spaces and punctuation become single hyphens, as before', () => {
  assert.equal(patientSlug("  O'Brien, Mary-Kate  "), 'o-brien-mary-kate');
  assert.equal(patientSlug('--x--'), 'x');
});

test('what a file name cannot hold is dropped', () => {
  // Forbidden on Windows (and / everywhere).
  assert.equal(patientSlug('A/B\\C:D*E?F"G<H>I|J'), 'a-b-c-d-e-f-g-h-i-j');
  // Control characters, e.g. a line break in a name pasted from elsewhere.
  assert.equal(patientSlug('Jane\nDoe\t\u0000'), 'jane-doe');
  // A right-to-left override would make "jane.exe" display backwards.
  assert.equal(patientSlug('Jane\u202eDoe'), 'jane-doe');
  assert.equal(patientSlug('Jane\u2066Doe\u2069'), 'jane-doe');
  // Leading dots would hide the file on macOS and Linux.
  assert.equal(patientSlug('..Jane'), 'jane');
});

test('nothing usable left gives an empty name', () => {
  for (const name of ['', '   ', '?!', '😀', '\u202e']) assert.equal(patientSlug(name), '', JSON.stringify(name));
});

test('long names are cut to fit a file name, between whole letters', () => {
  for (const letter of ['a', 'ب', '山', '𝒜']) {
    const slug = patientSlug(letter.repeat(500));
    assert.ok(utf8(slug) <= 120, `${letter}: ${utf8(slug)} bytes`);
    assert.ok(utf8(slug) > 100, `${letter}: cut far too short`);
    assert.equal(slug, letter.repeat(Array.from(slug).length), `${letter}: split a letter`);
  }
  // The whole file name stays well under the 255-byte limit.
  assert.ok(utf8(caseFileName('山'.repeat(500), new Date(2025, 0, 1))) < 255);
  // Not ending on a hyphen after the cut.
  assert.ok(!patientSlug('ab '.repeat(100)).endsWith('-'));
});

test('a cut never separates a letter from its accent or vowel sign', () => {
  // 115 bytes of "a", then श (3 bytes: 118) fits, but its virama mark (3 more:
  // 121) does not. Keeping श alone would change the letter, so both go.
  assert.equal(patientSlug('a'.repeat(115) + 'श\u094d' + 'b'), 'a'.repeat(115));
  // With room for both, both are kept.
  assert.equal(patientSlug('a'.repeat(114) + 'श\u094d' + 'b'), 'a'.repeat(114) + 'श\u094d');
});

test('report images: the name, then the label; "patient" without a name', () => {
  assert.equal(reportImageFileName('Jane Doe', 'smile-after'), 'jane-doe-smile-after.png');
  assert.equal(reportImageFileName('محمد علي', 'smile-after'), 'محمد-علي-smile-after.png');
  assert.equal(reportImageFileName('', 'smile-after'), 'patient-smile-after.png');
  assert.equal(reportImageFileName('?!', 'smile-after'), 'patient-smile-after.png');
});

test('report images: plain Latin names are named exactly as before', () => {
  // The rule ReportStep used inline until now, kept here as the reference.
  const before = (name: string, label: string) =>
    `${(name || 'patient').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patient'}-${label}.png`;
  for (const name of ['Jane Doe', '', '   ', "O'Brien, Mary-Kate", '--x--', 'Case 12']) {
    assert.equal(reportImageFileName(name, 'smile-after'), before(name, 'smile-after'), name);
  }
});

test('case file: the name, then the local date', () => {
  assert.equal(caseFileName('Jane Doe', new Date(2025, 10, 14)), 'jane-doe-2025-11-14.smilecase');
  assert.equal(caseFileName('محمد علي', new Date(2026, 10, 14)), 'محمد-علي-2026-11-14.smilecase');
  assert.equal(caseFileName('José Müller', new Date(2025, 0, 5)), 'josé-müller-2025-01-05.smilecase');
  // Late evening local time is still that local day.
  assert.equal(caseFileName('A', new Date(2025, 11, 31, 23, 59)), 'a-2025-12-31.smilecase');
});

test('case file: just the date when there is no usable name', () => {
  const day = new Date(2025, 10, 14);
  assert.equal(caseFileName('', day), '2025-11-14.smilecase');
  assert.equal(caseFileName('   ', day), '2025-11-14.smilecase');
  assert.equal(caseFileName('?!', day), '2025-11-14.smilecase');
});
