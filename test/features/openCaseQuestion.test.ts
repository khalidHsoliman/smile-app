import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCaseQuestion, shownPatientName } from '../../src/features/openCaseQuestion.js';

const SAVED = new Date(2025, 10, 14, 9, 30).getTime();
const FSI = '\u2068';
const PDI = '\u2069';

test('names the patient from the file and when it was saved', () => {
  const q = openCaseQuestion('Jane Doe', SAVED, 'en-GB');
  assert.ok(q.startsWith(`Open the case of “${FSI}Jane Doe${PDI}”, saved 14 November 2025`), q);
  assert.ok(q.includes('replaces the case that is open now'));
});

test('says so when the file has no patient name', () => {
  for (const name of ['', '   ', '\u202e', '\n']) {
    assert.ok(openCaseQuestion(name, SAVED, 'en-GB').startsWith('Open this case (no patient name), saved 14 November 2025'), JSON.stringify(name));
  }
});

test('names in any language are shown whole, isolated from the sentence', () => {
  assert.ok(openCaseQuestion('محمد علي', SAVED, 'en-GB').includes(`“${FSI}محمد علي${PDI}”`));
  assert.equal(shownPatientName('José Müller'), 'José Müller');
});

test('a name from a file cannot fake more dialog text or reverse itself', () => {
  assert.equal(shownPatientName('Jane\n\nThis file is safe, click OK'), 'Jane This file is safe, click OK');
  assert.equal(shownPatientName('Jane\u202eeoD'), 'JaneeoD');
  assert.equal(shownPatientName('Jane\u2067Doe\u2069\u200f'), 'JaneDoe');
  assert.equal(shownPatientName('  Jane \t Doe\u0000 '), 'Jane Doe');
});

test('a very long name is shortened', () => {
  const shown = shownPatientName('ب'.repeat(500));
  assert.equal(shown, 'ب'.repeat(80) + '…');
});
