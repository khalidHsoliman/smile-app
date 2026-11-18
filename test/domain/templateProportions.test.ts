import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTRAL_WIDTH_IN_FACE_UNITS, fitArches, type FitParams } from '../../src/domain/fitting.js';
import { getTemplate } from '../../src/domain/templates/buildTemplate.js';
import {
  BUILT_IN_START,
  ownProportions,
  startingProportions,
} from '../../src/domain/templates/proportions.js';
import type { Template } from '../../src/domain/templates/types.js';
import { fromFDI, toFDI } from '../../src/domain/teeth.js';
import { templateFromJson, templateToJson } from '../../src/state/templateFile.js';
import { builtInFitsFingerprint } from './builtInFits.js';

// --- fixtures ------------------------------------------------------------------

const natural = getTemplate('natural')!;
const hollywood = getTemplate('hollywood')!;

/** Every x (and y) in an outline scaled, in the app's own form. */
function scaleOutline(outline: string, sx: number, sy = 1): string {
  let pair = 0;
  return outline.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) =>
    String(pair++ % 2 === 0 ? Number(n) * sx : Number(n) * sy),
  );
}

/** A template imported from a built-in one's file, with `change` made to the file first. */
function imported(base: Template, name: string, change: (teeth: any) => void = () => {}): Template {
  const json: any = templateToJson(base);
  change(json.teeth);
  return templateFromJson({ ...json, name });
}

/** Resize one tooth in a file: its numbers and its outline together. */
const resize = (teeth: any, fdi: string, width: number, length: number) => {
  const t = teeth[fdi];
  t.outline = scaleOutline(t.outline, width / t.width, length / t.length);
  t.width = width;
  t.length = length;
};

const ALL = Array.from({ length: 32 }, (_, i) => i + 1);

/** Each placed tooth's drawn width and length, in template units. */
function drawn(template: Template, params: FitParams, selected = ALL) {
  const cw = CENTRAL_WIDTH_IN_FACE_UNITS * params.scale;
  return new Map(
    fitArches(selected, template, params).teeth.map((p) => {
      const t = template.teeth[p.universal]!;
      return [p.universal, { width: (t.width * Math.abs(p.scaleX)) / cw, length: (t.length * Math.abs(p.scaleY)) / cw }];
    }),
  );
}

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${what}: ${actual} vs ${expected}`);

const params = (template: Template, other: Partial<FitParams> = {}): FitParams => ({
  scale: 1, smileCurve: 1, occlusalGap: 0, archWidth: 1, ...startingProportions(template), ...other,
});

/** Templates a clinic might import, each awkward in its own way. */
const CLINIC_TEMPLATES: [string, Template][] = [
  ['a copy of Natural', imported(natural, 'Natural copy')],
  ['a copy of Hollywood', imported(hollywood, 'Hollywood copy')],
  ['long centrals', imported(natural, 'Long centrals', (t) => { resize(t, '11', 1, 1.5); resize(t, '21', 1, 1.5); })],
  ['narrow lower centrals', imported(natural, 'Narrow lower', (t) => { resize(t, '31', 0.62, 1.1); resize(t, '41', 0.62, 1.1); })],
  ['asymmetric', imported(natural, 'Asymmetric', (t) => { resize(t, '21', 1, 1.3); resize(t, '22', 0.7, 1.18); resize(t, '23', 0.62, 1.3); })],
  ['premolars wider than the canines', imported(natural, 'Wide premolars', (t) => {
    for (const fdi of ['14', '24', '34', '44']) resize(t, fdi, 0.61, 1.15);
  })],
];

// --- the built-in templates ------------------------------------------------------

test('Natural and Hollywood draw exactly what they drew before, at any slider values', () => {
  // Computed by the app before imported templates used the sliders relatively;
  // see builtInFits.ts.
  assert.equal(
    builtInFitsFingerprint(fitArches as never, getTemplate),
    '1b234ccf85f3143759a4991a7838c8f5f610a02ee6be991f00ab793f8a3881b9',
  );
});

test('the built-in templates start at 0.80 and 0.70, whatever their own proportions', () => {
  assert.deepEqual(startingProportions(natural), { ratio: 0.8, redProportion: 0.7 });
  assert.deepEqual(startingProportions(hollywood), BUILT_IN_START);
  // Hollywood's own central is squarer; the slider still starts at 0.80.
  assert.ok(ownProportions(hollywood.teeth)!.ratio > 0.87);
});

// --- imported templates ----------------------------------------------------------

test('an imported template starts at its own proportions, from 11 and 12', () => {
  const long = CLINIC_TEMPLATES.find(([what]) => what === 'long centrals')![1];
  assert.deepEqual(startingProportions(long), { ratio: 1 / 1.5, redProportion: 0.66 });
  const copy = CLINIC_TEMPLATES[1]![1];
  assert.deepEqual(startingProportions(copy), { ratio: 1 / 1.14, redProportion: 0.72 });
});

for (const [what, template] of CLINIC_TEMPLATES) {
  test(`at its starting values, every tooth is drawn exactly as authored: ${what}`, () => {
    for (const other of [{}, { scale: 2.3 }, { scale: 0.4, smileCurve: -4, occlusalGap: 60 }]) {
      const sizes = drawn(template, params(template, other));
      assert.equal(sizes.size, 32);
      for (const [universal, size] of sizes) {
        const t = template.teeth[universal]!;
        close(size.width, t.width, `${toFDI(universal)} width`);
        close(size.length, t.length, `${toFDI(universal)} length`);
      }
    }
  });
}

test('the narrow lower centrals problem is gone: lower laterals keep their own width', () => {
  const narrow = CLINIC_TEMPLATES.find(([what]) => what === 'narrow lower centrals')![1];
  const sizes = drawn(narrow, params(narrow));
  close(sizes.get(fromFDI(31))!.width, 0.62, '31');
  // Under the built-in rule this came out at 0.62, clamped to the central.
  close(sizes.get(fromFDI(32))!.width, 0.66, '32');
  close(sizes.get(fromFDI(33))!.width, 0.58, '33');
});

test('long centrals no longer shorten the other teeth', () => {
  const long = CLINIC_TEMPLATES.find(([what]) => what === 'long centrals')![1];
  const sizes = drawn(long, params(long));
  close(sizes.get(fromFDI(11))!.length, 1.5, '11');
  close(sizes.get(fromFDI(12))!.length, 1.21, '12');
  close(sizes.get(fromFDI(13))!.length, 1.26, '13');
});

test('Ratio moves every length from the template\'s own, and no width', () => {
  for (const [what, template] of CLINIC_TEMPLATES) {
    const start = startingProportions(template);
    const base = drawn(template, params(template));
    for (const ratio of [0.55, 0.7, 0.95]) {
      const moved = drawn(template, params(template, { ratio }));
      for (const [universal, size] of moved) {
        const before = base.get(universal)!;
        close(size.width, before.width, `${what} ${toFDI(universal)} width`);
        close(size.length, before.length * (start.ratio / ratio), `${what} ${toFDI(universal)} length`);
      }
      // The Ratio is the upper central's width:length, as the panel measures it.
      const central = moved.get(fromFDI(11))!;
      close(central.width / central.length, ratio, `${what} 11 width:length`);
    }
  }
});

test('Tooth proportion scales the template\'s own laterals by its change and canines by its square', () => {
  for (const [what, template] of CLINIC_TEMPLATES) {
    const start = startingProportions(template).redProportion;
    for (const red of [0.55, 0.62, 0.85]) {
      const factor = red / start;
      const sizes = drawn(template, params(template, { redProportion: red }), [6, 7, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27]);
      for (const [universal, size] of sizes) {
        const fdi = toFDI(universal);
        const position = fdi % 10;
        let expected = template.teeth[universal]!.width * factor ** (position - 1);
        // Raised, the canine grows faster than the lateral; one the template
        // draws narrower than its lateral is held to the lateral's width.
        if (position === 3) {
          const lateral = template.teeth[fromFDI(fdi - 1)]!;
          if (template.teeth[universal]!.width <= lateral.width) expected = Math.min(expected, lateral.width * factor);
        }
        close(size.width, expected, `${what} ${fdi} at ${red}`);
        close(size.length, template.teeth[universal]!.length, `${what} ${fdi} length at ${red}`);
      }
      // So the lateral is the slider's share of the central, as the panel shows.
      close(sizes.get(fromFDI(12))!.width / sizes.get(fromFDI(11))!.width, red, `${what} 12/11 at ${red}`);
    }
  }
});

test('a back tooth is kept from outgrowing a narrowed canine, unless the template draws it wider', () => {
  const copy = CLINIC_TEMPLATES[0]![1];
  // Narrowed canines: 0.58 x (0.55/0.66)^2 = 0.403. The premolar, authored
  // narrower than the canine, is held to it.
  const sizes = drawn(copy, params(copy, { redProportion: 0.55 }));
  close(sizes.get(fromFDI(13))!.width, 0.58 * (0.55 / 0.66) ** 2, '13');
  close(sizes.get(fromFDI(14))!.width, sizes.get(fromFDI(13))!.width, '14 held to 13');

  // Premolars the clinic drew wider than its canines are its choice, and kept.
  const wide = CLINIC_TEMPLATES.find(([what]) => what === 'premolars wider than the canines')![1];
  const wideSizes = drawn(wide, params(wide, { redProportion: 0.55 }));
  close(wideSizes.get(fromFDI(14))!.width, 0.61, '14 as authored');
});

test('raising Tooth proportion far enough holds a canine to its lateral, as the built-in rule does', () => {
  const copy = CLINIC_TEMPLATES[0]![1];
  const sizes = drawn(copy, params(copy, { redProportion: 0.85 }));
  close(sizes.get(fromFDI(12))!.width, 0.85, '12');
  // 0.58 x (0.85/0.66)^2 = 0.962 would be wider than the lateral.
  close(sizes.get(fromFDI(13))!.width, 0.85, '13 held to 12');
});
