/**
 * A fingerprint of every fit of the built-in templates over a grid of all six
 * sliders and a range of tooth selections: what Natural and Hollywood draw.
 *
 * The expected value in `templateProportions.test.ts` was computed by the app
 * before imported templates could use the sliders relatively, so a change to
 * how the built-in templates draw, at any slider value, fails the test. Takes
 * the functions it fingerprints as arguments, so it can run against any
 * version of them.
 *
 * Not a test file itself: `npm test` runs `*.test.ts` only.
 */

import { createHash } from 'node:crypto';

type Fit = (selected: number[], template: never, params: Record<string, number>) => unknown;

const SELECTIONS = [
  [6, 7, 8, 9, 10, 11],
  [8],
  [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
  [22, 23, 24, 25, 26, 27],
  [3, 14, 19, 30],
];

const GRID = {
  ratio: [0.55, 0.7, 0.8, 0.877, 0.95],
  redProportion: [0.55, 0.62, 0.66, 0.7, 0.72, 0.85],
  archWidth: [0.75, 1, 1.25],
  scale: [0.3, 1.37],
  smileCurve: [-3, 1],
  occlusalGap: [-60, 45],
};

/** Exact: -0 is told apart from 0. */
const exact = (value: unknown) =>
  JSON.stringify(value, (_key, n) => (typeof n === 'number' && Object.is(n, -0) ? '-0' : n));

export function builtInFitsFingerprint(
  fitArches: Fit,
  getTemplate: (id: string) => unknown,
): string {
  const hash = createHash('sha256');
  for (const id of ['natural', 'hollywood']) {
    const template = getTemplate(id) as never;
    for (const selected of SELECTIONS) {
      for (const ratio of GRID.ratio) for (const redProportion of GRID.redProportion)
        for (const archWidth of GRID.archWidth) for (const scale of GRID.scale)
          for (const smileCurve of GRID.smileCurve) for (const occlusalGap of GRID.occlusalGap) {
            const params = { ratio, redProportion, archWidth, scale, smileCurve, occlusalGap };
            hash.update(exact(fitArches(selected, template, params)));
          }
    }
  }
  return hash.digest('hex');
}
