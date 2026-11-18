import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORTED_ID_PREFIX,
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  TEMPLATE_LIMITS,
  TemplateFileError,
  exportName,
  readTemplateFile,
  withImported,
  templateFromJson,
  templateToJson,
  writeTemplateFile,
  type TemplateFileProblem,
} from '../../src/state/templateFile.js';
import { findTemplate, getTemplate, TEMPLATES } from '../../src/domain/templates/buildTemplate.js';
import { fitArches } from '../../src/domain/fitting.js';

// --- fixtures ------------------------------------------------------------------

const natural = getTemplate('natural')!;

/** Natural as an exported file, parsed: the starting point a clinic edits. */
const naturalJson = (): any => JSON.parse(JSON.stringify(templateToJson(natural)));

const fileOf = (json: unknown): Blob => new Blob([JSON.stringify(json, null, 2)]);

/** The exported Natural file, changed by `mutate`. */
function alteredFile(mutate: (json: any) => void): Blob {
  const json = naturalJson();
  mutate(json);
  return fileOf(json);
}

async function assertRefused(file: Blob, problem: TemplateFileProblem, mention?: string) {
  await assert.rejects(readTemplateFile(file), (error: unknown) => {
    assert.ok(error instanceof TemplateFileError, `expected a TemplateFileError, got ${String(error)}`);
    assert.equal(error.problem, problem, error.message);
    if (mention) assert.ok(error.message.includes(mention), `"${error.message}" should mention ${mention}`);
    return true;
  });
}

/** An outline with every x and y scaled, then moved, in the app's own form. */
function scaleOutline(outline: string, sx: number, sy = 1, dy = 0, dx = 0): string {
  let pair = 0;
  return outline.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) =>
    String(pair++ % 2 === 0 ? Number(n) * sx + dx : Number(n) * sy + dy),
  );
}

// --- export and import -----------------------------------------------------------

for (const builtIn of TEMPLATES) {
  test(`${builtIn.name} exports and imports back with the same teeth, as a copy`, async () => {
    const imported = await readTemplateFile(writeTemplateFile(builtIn));
    assert.equal(imported.name, `${builtIn.name} (copy)`);
    assert.equal(imported.description, builtIn.description);
    assert.deepEqual(imported.teeth, builtIn.teeth);
    assert.ok(imported.id.startsWith(IMPORTED_ID_PREFIX), imported.id);
    assert.notEqual(imported.id, builtIn.id);
  });
}

test('an imported template uses the sliders relatively; the built-in ones absolutely', async () => {
  const imported = await readTemplateFile(writeTemplateFile(natural));
  assert.equal(imported.sliders, 'relative');
  assert.equal(natural.sliders, 'absolute');
  // Natural's own shapes, imported, start at Natural's own proportions -- not
  // at the 0.80 and 0.70 the built-in Natural starts at -- so the two lay out
  // alike only where those agree: the centrals.
  const params = { ratio: 0.8, scale: 1.1, smileCurve: 1.5, occlusalGap: -4, redProportion: 0.66, archWidth: 1 };
  const copy = fitArches([6, 7, 8, 9, 10, 11], imported, params).teeth;
  const original = fitArches([6, 7, 8, 9, 10, 11], natural, params).teeth;
  assert.deepEqual(copy.filter((t) => t.universal === 8 || t.universal === 9).map((t) => [t.scaleX, t.scaleY]),
    original.filter((t) => t.universal === 8 || t.universal === 9).map((t) => [t.scaleX, t.scaleY]));
  assert.notDeepEqual(copy, original);
});

test('the file: marker first, all 32 teeth by FDI number, four fields each', async () => {
  const text = await writeTemplateFile(natural).text();
  assert.match(text, new RegExp(`^\\{\\s*"format": "${TEMPLATE_FILE_FORMAT}",\\s*"version": ${TEMPLATE_FILE_VERSION},`));

  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json), ['format', 'version', 'name', 'description', 'teeth']);
  const fdi = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((t) => String(q * 10 + t)));
  assert.deepEqual(Object.keys(json.teeth), fdi);
  for (const tooth of Object.values<any>(json.teeth)) {
    assert.deepEqual(Object.keys(tooth), ['width', 'length', 'incisalOffset', 'outline']);
  }
  // FDI 11 is the upper right central, universal 8.
  assert.equal(json.teeth['11'].outline, natural.teeth[8]!.outline);
  assert.equal(json.teeth['21'].outline, natural.teeth[9]!.outline);
  assert.equal(json.teeth['13'].width, natural.teeth[6]!.width);
  assert.equal(json.teeth['41'].outline, natural.teeth[25]!.outline);
});

test('an imported template exports under its own name and comes back as the same template', async () => {
  const imported = await readTemplateFile(alteredFile((j) => { j.name = 'Clinic A'; }));
  const again = await readTemplateFile(writeTemplateFile(imported));
  assert.equal(again.name, 'Clinic A');
  assert.equal(again.id, imported.id);
  assert.deepEqual(again, imported);
});

test('exporting a template a file could not carry is refused as a bug, not written', () => {
  const { 8: _central, ...teeth } = natural.teeth;
  assert.throws(
    () => templateToJson({ ...natural, id: 'broken', name: 'Broken', teeth }),
    (error: unknown) =>
      error instanceof TemplateFileError &&
      error.problem === 'cannot-export' &&
      error.message.includes('teeth.11 is missing'),
  );
});

// --- ids -----------------------------------------------------------------------------

test('the id comes from the content: same template, same id; any change, a new one', async () => {
  const base = await readTemplateFile(alteredFile(() => {}));
  assert.equal((await readTemplateFile(alteredFile(() => {}))).id, base.id);

  const changes: [string, (j: any) => void][] = [
    ['name', (j) => { j.name = 'Natural (edited)'; }],
    ['description', (j) => { j.description += '!'; }],
    ['a width', (j) => { j.teeth['12'].width = 0.67; }],
    ['a length', (j) => { j.teeth['12'].length = 1.2; }],
    ['an incisal offset', (j) => { j.teeth['12'].incisalOffset = 0.1; }],
    ['an outline', (j) => { j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1.02); }],
  ];
  const ids = new Set([base.id]);
  for (const [what, change] of changes) {
    const id = (await readTemplateFile(alteredFile(change))).id;
    assert.ok(!ids.has(id), `changing ${what} should change the id`);
    ids.add(id);
  }
});

test('the id ignores how the file is written: layout, field order, spacing in outlines', async () => {
  const base = await readTemplateFile(alteredFile(() => {}));

  const json = naturalJson();
  // Compact, fields reordered, and an outline with commas and repeated arguments.
  const outline = json.teeth['11'].outline as string;
  json.teeth['11'] = {
    outline: outline.replace(/ C /g, ',C').replace('M ', 'M').replaceAll(' ', ','),
    incisalOffset: json.teeth['11'].incisalOffset,
    length: json.teeth['11'].length,
    width: json.teeth['11'].width,
  };
  const reordered = { teeth: json.teeth, description: json.description, name: json.name, version: json.version, format: json.format };
  const imported = await readTemplateFile(new Blob([JSON.stringify(reordered)]));
  assert.equal(imported.id, base.id);
  assert.equal(imported.teeth[8]!.outline, natural.teeth[8]!.outline);
});

// --- what is accepted ------------------------------------------------------------------

test('outlines are rewritten in the app\'s own form', async () => {
  const imported = await readTemplateFile(alteredFile((j) => {
    // Repeated C arguments, commas, no spaces, +signs and exponents.
    j.teeth['11'].outline =
      'M-0.5,0C-0.5,0.5 -0.5,1 -0.4,1.2 0,1.3 0.2,1.3 0.4,1.2 C+0.5,1 0.5,5e-1 .5,0 Q0,-0.05-0.5,0Z';
  }));
  assert.equal(
    imported.teeth[8]!.outline,
    'M -0.5 0 C -0.5 0.5 -0.5 1 -0.4 1.2 C 0 1.3 0.2 1.3 0.4 1.2 C 0.5 1 0.5 0.5 0.5 0 Q 0 -0.05 -0.5 0 Z',
  );
});

test('M followed by more pairs draws lines, as SVG does', async () => {
  const imported = await readTemplateFile(alteredFile((j) => {
    j.teeth['11'].outline = 'M -0.5 0 0.5 0 0.5 1.25 -0.5 1.25 Z';
  }));
  assert.equal(imported.teeth[8]!.outline, 'M -0.5 0 L 0.5 0 L 0.5 1.25 L -0.5 1.25 Z');
});

test('unknown fields are dropped, not refused', async () => {
  const imported = await readTemplateFile(alteredFile((j) => {
    j.author = 'Dr Smith';
    j.teeth['11'].colour = '#fff';
  }));
  assert.deepEqual(Object.keys(imported).sort(), ['description', 'id', 'name', 'sliders', 'teeth']);
  assert.deepEqual(Object.keys(imported.teeth[8]!).sort(), ['incisalOffset', 'length', 'outline', 'universal', 'width']);
  assert.equal(imported.id, (await readTemplateFile(alteredFile(() => {}))).id);
});

test('name and description are trimmed; the description may be empty', async () => {
  const imported = await readTemplateFile(alteredFile((j) => {
    j.name = '  Clinic A  ';
    j.description = '   ';
  }));
  assert.equal(imported.name, 'Clinic A');
  assert.equal(imported.description, '');
});

test('names in any script are kept, up to the limit', async () => {
  for (const name of ['Clínica Müller', 'عيادة الابتسامة', '笑顔クリニック', 'x'.repeat(TEMPLATE_LIMITS.nameChars)]) {
    const imported = await readTemplateFile(alteredFile((j) => { j.name = name; }));
    assert.equal(imported.name, name);
  }
});

test('a name that contains a built-in name is fine; only the name itself is taken', async () => {
  const imported = await readTemplateFile(alteredFile((j) => { j.name = 'Natural plus'; }));
  assert.equal(imported.name, 'Natural plus');
});

test('only the upper centrals must be exactly 1 wide', async () => {
  const imported = await readTemplateFile(alteredFile((j) => {
    for (const fdi of ['31', '41']) {
      j.teeth[fdi].width = 0.62;
      j.teeth[fdi].outline = scaleOutline(j.teeth[fdi].outline, 0.62);
    }
  }));
  assert.equal(imported.teeth[24]!.width, 0.62);
  assert.equal(imported.teeth[25]!.width, 0.62);
});

test('an outline a little off its numbers is accepted', async () => {
  await readTemplateFile(alteredFile((j) => {
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1.08);
    j.teeth['22'].outline = scaleOutline(j.teeth['22'].outline, 1, 1.08);
    j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 1, 1, 0, 0.08);
    // Lowest point 8% of the canine's length below the biting edge.
    j.teeth['13'].outline = scaleOutline(j.teeth['13'].outline, 1, 1, -0.08 * j.teeth['13'].length);
  }));
});

test('proportions at the very ends of the sliders are accepted; 21 and 22 are not consulted', async () => {
  for (const [length, lateral] of [[1 / 0.55, 0.55], [1 / 0.95, 0.85]] as const) {
    const imported = await readTemplateFile(alteredFile((j) => {
      j.teeth['11'].length = length;
      j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 1, length / 1.25);
      j.teeth['12'].width = lateral;
      j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, lateral / 0.66);
      // The left side may differ; only 11 and 12 set where the sliders start.
      j.teeth['22'].width = 0.5;
      j.teeth['22'].outline = scaleOutline(j.teeth['22'].outline, 0.5 / 0.66);
    }));
    assert.equal(imported.teeth[8]!.length, length);
  }
});

test('templateFromJson checks an already parsed template the same way', () => {
  assert.equal(templateFromJson(naturalJson()).name, 'Natural (copy)');
  assert.throws(
    () => templateFromJson({ ...naturalJson(), name: 'Hollywood' }),
    (error: unknown) => error instanceof TemplateFileError && error.problem === 'invalid',
  );
});

// --- what is refused --------------------------------------------------------------------

test('a file that is not a template is refused as such', async () => {
  await assertRefused(new Blob(['hello']), 'not-a-template-file');
  await assertRefused(new Blob(['']), 'not-a-template-file');
  await assertRefused(fileOf({}), 'not-a-template-file');
  await assertRefused(fileOf([naturalJson()]), 'not-a-template-file');
  await assertRefused(fileOf(null), 'not-a-template-file');
  await assertRefused(fileOf({ format: 'smile-design-case', version: 2, case: {} }), 'not-a-template-file');
});

test('a file over the size limit is refused without being read', async () => {
  const big = new Blob([' '.repeat(TEMPLATE_LIMITS.fileBytes + 1)]);
  await assertRefused(big, 'not-a-template-file', '1 MB');
});

test('a template broken as JSON says so, with where the parser stopped', async () => {
  const text = JSON.stringify(naturalJson(), null, 2);
  // A trailing comma: the classic hand-editing slip.
  const broken = text.replace(/"version": 1,/, '"version": 1,,');
  await assertRefused(new Blob([broken]), 'invalid', 'not valid JSON (');
  await assertRefused(new Blob([text.slice(0, text.length / 2)]), 'invalid', 'not valid JSON');
});

test('a template from a newer version of the app asks for an update', async () => {
  await assertRefused(
    alteredFile((j) => { j.version = TEMPLATE_FILE_VERSION + 1; }),
    'newer-version',
    'Update the app',
  );
});

const longOutline = (): string => {
  const points = Array.from({ length: TEMPLATE_LIMITS.outlinePoints }, (_, i) => {
    const t = (i / TEMPLATE_LIMITS.outlinePoints) * 2 * Math.PI;
    return `${(0.5 * Math.sin(t)).toFixed(4)} ${(0.6 - 0.6 * Math.cos(t)).toFixed(4)}`;
  });
  return `M ${points[0]} L ${points.slice(1).join(' ')} L 0 0.01 Z`;
};

const refusals: [string, (json: any) => void, string][] = [
  ['version missing', (j) => { delete j.version; }, 'version'],
  ['version not a whole number', (j) => { j.version = 1.5; }, 'version'],
  ['version as text', (j) => { j.version = '1'; }, 'version'],
  ['version 0', (j) => { j.version = 0; }, 'version'],

  ['name missing', (j) => { delete j.name; }, 'name is missing'],
  ['name not text', (j) => { j.name = 7; }, 'name is missing or not text'],
  ['name empty', (j) => { j.name = '   '; }, 'name is empty'],
  ['name too long', (j) => { j.name = 'x'.repeat(TEMPLATE_LIMITS.nameChars + 1); }, 'name is longer than 60'],
  ['name with a line break', (j) => { j.name = 'Clinic\nA'; }, 'name contains'],
  ['name with a tab', (j) => { j.name = 'Clinic\tA'; }, 'name contains'],
  ['name with a direction override', (j) => { j.name = 'Clinic \u202eA'; }, 'name contains'],
  ['name of a built-in', (j) => { j.name = 'Natural'; }, '"Natural" is the name of a built-in'],
  ['name of a built-in, other case and spaces', (j) => { j.name = '  HOLLYWOOD '; }, 'built-in'],

  ['description missing', (j) => { delete j.description; }, 'description is missing'],
  ['description too long', (j) => { j.description = 'x'.repeat(TEMPLATE_LIMITS.descriptionChars + 1); }, 'description is longer than 200'],
  ['description with a control character', (j) => { j.description = 'a\u0007b'; }, 'description contains'],

  ['teeth missing', (j) => { delete j.teeth; }, 'teeth is missing'],
  ['teeth a list', (j) => { j.teeth = Object.values(j.teeth); }, 'teeth is missing or not an object'],
  ['a tooth missing', (j) => { delete j.teeth['23']; }, 'teeth.23 is missing: a template needs all 32 teeth'],
  ['a lower tooth missing', (j) => { delete j.teeth['48']; }, 'teeth.48 is missing'],
  ['a universal number as a key', (j) => { j.teeth['9'] = j.teeth['21']; }, 'teeth.9 is not an FDI tooth number'],
  ['a tooth that does not exist', (j) => { j.teeth['19'] = j.teeth['18']; }, 'teeth.19 is not an FDI tooth number'],
  ['a deciduous tooth', (j) => { j.teeth['51'] = j.teeth['11']; }, 'teeth.51'],
  ['a tooth not an object', (j) => { j.teeth['12'] = 'lateral'; }, 'teeth.12 is missing or not an object'],

  ['width missing', (j) => { delete j.teeth['12'].width; }, 'teeth.12.width is missing'],
  ['width as text', (j) => { j.teeth['12'].width = '0.66'; }, 'teeth.12.width is missing or not a number'],
  ['width too small', (j) => { j.teeth['12'].width = 0.1; }, 'teeth.12.width is 0.1, not between 0.2 and 2'],
  ['width too large', (j) => { j.teeth['12'].width = 2.5; }, 'teeth.12.width'],
  ['length missing', (j) => { delete j.teeth['12'].length; }, 'teeth.12.length'],
  ['length too small', (j) => { j.teeth['12'].length = 0.2; }, 'teeth.12.length is 0.2, not between 0.3 and 3'],
  ['length too large', (j) => { j.teeth['12'].length = 3.5; }, 'teeth.12.length'],
  ['incisal offset missing', (j) => { delete j.teeth['12'].incisalOffset; }, 'teeth.12.incisalOffset'],
  ['incisal offset too high', (j) => { j.teeth['12'].incisalOffset = 1.5; }, 'teeth.12.incisalOffset is 1.5, not between -1 and 1'],
  ['incisal offset too low', (j) => { j.teeth['12'].incisalOffset = -1.5; }, 'teeth.12.incisalOffset'],

  ['upper right central not 1 wide', (j) => {
    j.teeth['11'].width = 0.95;
    j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 0.95);
  }, 'teeth.11.width is 0.95 but must be exactly 1'],
  ['upper left central not 1 wide', (j) => { j.teeth['21'].width = 1.01; }, 'teeth.21.width is 1.01 but must be exactly 1'],

  ['outline missing', (j) => { delete j.teeth['12'].outline; }, 'teeth.12.outline is missing'],
  ['outline empty', (j) => { j.teeth['12'].outline = ''; }, 'teeth.12.outline must start with M'],
  ['outline not starting with M', (j) => { j.teeth['12'].outline = 'L 0 0 L 1 0 Z'; }, 'must start with M'],
  ['outline not closed', (j) => { j.teeth['12'].outline = j.teeth['12'].outline.replace(/ Z$/, ''); }, 'must end with Z'],
  ['outline with a relative command', (j) => { j.teeth['12'].outline = j.teeth['12'].outline.replace('C', 'c'); }, 'uses "c"'],
  ['outline with a relative move', (j) => { j.teeth['12'].outline = j.teeth['12'].outline.replace('M', 'm'); }, 'uses "m"'],
  ['outline with H', (j) => { j.teeth['12'].outline = 'M -0.33 0 H 0.33 L 0 1.2 Z'; }, 'uses "H"'],
  ['outline with V', (j) => { j.teeth['12'].outline = 'M -0.33 0 V 1.2 L 0.33 0 Z'; }, 'uses "V"'],
  ['outline with an arc', (j) => { j.teeth['12'].outline = 'M -0.33 0 A 0.33 0.33 0 0 1 0.33 0 Z'; }, 'uses "A"'],
  ['outline with S', (j) => { j.teeth['12'].outline = 'M -0.33 0 S 0 1 0.33 0 Z'; }, 'uses "S"'],
  ['outline with a stray character', (j) => { j.teeth['12'].outline = 'M -0.33 0 L 0.33 0 L 0 1.2; Z'; }, 'has ";"'],
  ['outline with a second shape', (j) => {
    j.teeth['12'].outline = j.teeth['12'].outline.replace(/ Z$/, ' M 0 0 L 0.1 0.1 Z');
  }, 'second M'],
  ['outline continuing after Z', (j) => { j.teeth['12'].outline += ' L 0 0'; }, 'nothing may follow Z'],
  ['outline with numbers after Z', (j) => { j.teeth['12'].outline += ' 0 0'; }, 'numbers after Z'],
  ['outline with a short curve', (j) => { j.teeth['12'].outline = 'M -0.33 0 C 0 1 0.33 Z'; }, 'has a C without its 6 numbers'],
  ['outline with a half pair', (j) => { j.teeth['12'].outline = 'M -0.33 0 L 0.33 Z'; }, 'has a L without its 2 numbers'],
  ['outline with too many points', (j) => { j.teeth['12'].outline = longOutline(); }, 'more than 100 points'],
  ['outline too long', (j) => { j.teeth['12'].outline = `M 0 0${' '.repeat(TEMPLATE_LIMITS.outlineChars)} L 1 1 Z`; }, 'longer than 10000 characters'],
  ['outline far out', (j) => { j.teeth['12'].outline = 'M -0.33 0 L 0.33 0 L 0 11 Z'; }, 'coordinate (11) outside -10 to 10'],
  ['outline with an infinite number', (j) => { j.teeth['12'].outline = 'M -0.33 0 L 0.33 0 L 0 1e999 Z'; }, 'coordinate (Infinity)'],

  ['outline much wider than its width', (j) => {
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1.15);
  }, 'teeth.12.outline is 0.759 wide, more than 10% off the tooth\'s width of 0.66'],
  ['outline much narrower than its width', (j) => {
    j.teeth['33'].outline = scaleOutline(j.teeth['33'].outline, 0.85);
  }, 'teeth.33.outline is 0.493 wide'],
  ['outline in other units', (j) => {
    // Drawn in millimetres rather than central widths.
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 8.5, 8.5);
  }, 'teeth.12.outline'],
  ['outline floating above the biting edge', (j) => {
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1, 1, 0.3);
  }, 'teeth.12.outline has its lowest point at y = 0.267, but the biting edge is y = 0'],
  ['outline hanging below the biting edge', (j) => {
    j.teeth['22'].outline = scaleOutline(j.teeth['22'].outline, 1, 1, -0.2);
  }, 'teeth.22.outline has its lowest point'],
  // Measured along the curves, not only at their ends: both end on the width.
  ['outline whose curve bulges past its width', (j) => {
    j.teeth['12'].outline = 'M -0.33 0 C -0.6 0.4 -0.6 0.8 -0.33 1.2 L 0.33 1.2 L 0.33 0 Z';
  }, 'teeth.12.outline is 0.863 wide'],
  ['outline whose edge curve dips below the biting edge', (j) => {
    j.teeth['12'].outline = 'M -0.33 0 L -0.33 1 L 0.33 1 L 0.33 0 Q 0 -0.4 -0.33 0 Z';
  }, 'teeth.12.outline has its lowest point at y = -0.2'],
  ['outline much taller than its length', (j) => {
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1, 1.15);
  }, 'teeth.12.outline is 1.402 high, more than 10% off the tooth\'s length of 1.21'],
  ['outline much shorter than its length', (j) => {
    j.teeth['43'].outline = scaleOutline(j.teeth['43'].outline, 1, 0.85);
  }, 'teeth.43.outline is 1.057 high'],
  ['outline drawn flat', (j) => {
    j.teeth['12'].outline = 'M -0.33 0 L 0 0 L 0.33 0 Z';
  }, 'teeth.12.outline is 0 high'],
  ['outline off centre', (j) => {
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 1, 1, 0, 0.1);
  }, 'teeth.12.outline is centred at x = 0.1, but a tooth is drawn centred on x = 0 (allowed: within 10% of the tooth\'s width, 0.066)'],
  ['outline drawn from 0 to its width rather than around 0', (j) => {
    j.teeth['22'].outline = scaleOutline(j.teeth['22'].outline, 1, 1, 0, 0.33);
  }, 'teeth.22.outline is centred at x = 0.33'],
  // The template's own proportions are where the sliders start, so they must be in range.
  ['a central too long for the Ratio slider', (j) => {
    j.teeth['11'].length = 1.9;
    j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 1, 1.9 / 1.25);
  }, 'teeth.11 is 1 wide and 1.9 long, a width:length of 0.526. It must be between 0.55 and 0.95, the range of the Ratio slider, which starts at this tooth\'s width:length'],
  ['a central too short for the Ratio slider', (j) => {
    j.teeth['11'].length = 1;
    j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 1, 1 / 1.25);
  }, 'teeth.11 is 1 wide and 1 long, a width:length of 1'],
  ['a lateral too narrow for the Tooth proportion slider', (j) => {
    j.teeth['12'].width = 0.5;
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 0.5 / 0.66);
  }, 'teeth.12.width is 0.5, 0.5 of the width of 11. It must be between 0.55 and 0.85 of it, the range of the Tooth proportion slider, which starts at this proportion'],
  ['a lateral too wide for the Tooth proportion slider', (j) => {
    j.teeth['12'].width = 0.9;
    j.teeth['12'].outline = scaleOutline(j.teeth['12'].outline, 0.9 / 0.66);
  }, 'teeth.12.width is 0.9, 0.9 of the width of 11'],
  ['outline drawn upside down', (j) => {
    j.teeth['11'].outline = scaleOutline(j.teeth['11'].outline, 1, -1);
  }, 'teeth.11.outline has its lowest point'],
];

for (const [what, mutate, mention] of refusals) {
  test(`refused, saying why: ${what}`, async () => {
    await assertRefused(alteredFile(mutate), 'invalid', mention);
  });
}

test('a refusal message reads as a sentence the clinician can act on', async () => {
  await assert.rejects(
    readTemplateFile(alteredFile((j) => { delete j.teeth['23']; })),
    { message: 'This template cannot be used: teeth.23 is missing: a template needs all 32 teeth.' },
  );
});

// --- the open case's imports, and the lookup ------------------------------------------------

const named = (name: string, base = 'natural') =>
  templateFromJson({ ...templateToJson(getTemplate(base)!), name });

test('importing adds a template to the case; the same one again changes nothing', () => {
  const a = named('Clinic A');
  const b = named('Clinic B');
  const one = withImported([], a);
  assert.deepEqual(one, [a]);
  assert.deepEqual(withImported(one, b), [a, b]);
  // The same content read again has the same id, so it is the same template.
  assert.deepEqual(withImported([a, b], named('Clinic A')), [a, b]);
});

test('a different template under a name already in the case is refused', () => {
  const a = named('Clinic A');
  for (const clash of [named('Clinic A', 'hollywood'), named('  clinic a ', 'hollywood')]) {
    assert.throws(
      () => withImported([a], clash),
      (error: unknown) =>
        error instanceof TemplateFileError &&
        error.problem === 'invalid' &&
        error.message.includes('a different template named "Clinic A" is already in this case'),
    );
  }
});

test('importing does not change the list it was given', () => {
  const list = [named('Clinic A')];
  withImported(list, named('Clinic B'));
  assert.equal(list.length, 1);
});

test('findTemplate finds built-in and imported templates, and nothing else', () => {
  const a = named('Clinic A');
  assert.equal(findTemplate('natural', []), getTemplate('natural'));
  assert.equal(findTemplate('hollywood', [a]), getTemplate('hollywood'));
  assert.equal(findTemplate(a.id, [a]), a);
  assert.equal(findTemplate(a.id, []), undefined);
  assert.equal(findTemplate('porcelain', [a]), undefined);
  assert.equal(findTemplate(null, [a]), undefined);
});

test('an imported id can never be taken for a built-in one', () => {
  for (const builtIn of TEMPLATES) assert.ok(!builtIn.id.startsWith(IMPORTED_ID_PREFIX));
});

test('a refusal carries its bare reason for messages about other files', async () => {
  await assert.rejects(readTemplateFile(alteredFile((j) => { delete j.teeth['23']; })), {
    detail: 'teeth.23 is missing: a template needs all 32 teeth',
  });
  assert.throws(() => templateFromJson('x'), { detail: 'is not a tooth template' });
  assert.throws(() => templateFromJson({ ...naturalJson(), version: 9 }), {
    detail: 'is template file version 9, newer than this app reads',
  });
});

test('the export name: a copy for a built-in template, the name itself for an imported one', () => {
  assert.equal(exportName(getTemplate('natural')!), 'Natural (copy)');
  assert.equal(exportName(getTemplate('hollywood')!), 'Hollywood (copy)');
  const imported = named('Clinic A');
  assert.equal(exportName(imported), 'Clinic A');
  assert.equal(templateToJson(imported).name, exportName(imported));
});
