import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dentalMidlineOffset,
  faceMeasurements,
  formatMidline,
  formatOffset,
  formatPercent,
  formatTilt,
  toothMeasurements,
  type FaceMeasurements,
  type ToothMeasurements,
  type Where,
} from '../../src/domain/measurements.js';
import type { FacialReferences } from '../../src/domain/faceFrame.js';
import { vec, type Vec2 } from '../../src/domain/geometry.js';
import { fitArches, type FitParams } from '../../src/domain/fitting.js';
import { applyEdits, editTooth, IDENTITY_EDIT } from '../../src/domain/toothEdits.js';
import { getTemplate } from '../../src/domain/templates/buildTemplate.js';

// --- helpers ------------------------------------------------------------------

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * A level face on a 1000px-wide photo, the usual way round: the patient's left
 * is at the larger image x.
 */
function levelFace(): FacialReferences {
  return {
    rightPupil: vec(400, 300),
    leftPupil: vec(600, 300),
    rightAla: vec(470, 450),
    leftAla: vec(530, 450),
    midlineTop: vec(500, 200),
    midlineBottom: vec(500, 700),
    // Image left to right, dipping at the centre like a real lip line.
    lipCurve: [vec(430, 520), vec(465, 528), vec(500, 530), vec(535, 528), vec(570, 520)],
  };
}

/** Apply `f` to every point, keeping every label. */
function mapRefs(refs: FacialReferences, f: (p: Vec2) => Vec2): FacialReferences {
  return {
    rightPupil: f(refs.rightPupil),
    leftPupil: f(refs.leftPupil),
    rightAla: f(refs.rightAla),
    leftAla: f(refs.leftAla),
    midlineTop: f(refs.midlineTop),
    midlineBottom: f(refs.midlineBottom),
    lipCurve: refs.lipCurve.map(f),
  };
}

/** The same face in a mirrored photo: labels unchanged, image x flipped. */
const mirrored = (refs: FacialReferences) => mapRefs(refs, (p) => vec(1000 - p.x, p.y));

/** Rotate the whole face about (500, 500). Positive is clockwise on screen. */
function rotated(refs: FacialReferences, degrees: number): FacialReferences {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return mapRefs(refs, (p) => {
    const x = p.x - 500;
    const y = p.y - 500;
    return vec(500 + x * c - y * s, 500 + x * s + y * c);
  });
}

function showFace(m: FaceMeasurements, where: Where = 'panel') {
  return {
    headTilt: formatTilt(m.headTilt, where),
    midlineCant: formatMidline(m.midlineCant, where),
    lipLineCant: formatTilt(m.lipLineCant, where),
  };
}

const DEFAULT_FIT: FitParams = {
  ratio: 0.8,
  scale: 1,
  smileCurve: 1,
  occlusalGap: 0,
  redProportion: 0.7,
  archWidth: 1,
};

const natural = getTemplate('natural')!;

/** Fit, then edits, as the design step does. */
function design(selected: number[], params: Partial<FitParams> = {}, edits = {}) {
  const fit = fitArches(selected, natural, { ...DEFAULT_FIT, ...params });
  return applyEdits(fit.teeth, edits);
}

function showTeeth(m: ToothMeasurements, where: Where = 'panel') {
  const side = (s: ToothMeasurements['left']) => [
    formatPercent(s.centralWidthToLength, where),
    formatPercent(s.lateralToCentral, where),
    formatPercent(s.canineToCentral, where),
  ];
  return { right: side(m.right), left: side(m.left) };
}

const ANTERIOR_SIX = [6, 7, 8, 9, 10, 11];

// --- face ---------------------------------------------------------------------

test('a level face reads 0.0 everywhere, with no side', () => {
  assert.deepEqual(showFace(faceMeasurements(levelFace())), {
    headTilt: '0.0°',
    midlineCant: '0.0°',
    lipLineCant: '0.0°',
  });
});

test('head tilt is the pupil line against the image horizontal', () => {
  const refs = levelFace();
  refs.leftPupil = vec(600, 300 + 200 * Math.tan(rad(5)));
  assert.equal(formatTilt(faceMeasurements(refs).headTilt, 'panel'), "5.0°, patient's left side lower");

  refs.leftPupil = vec(600, 300 - 200 * Math.tan(rad(2.3)));
  assert.equal(formatTilt(faceMeasurements(refs).headTilt, 'panel'), "2.3°, patient's right side lower");
});

test('both cants are against the pupil line, so a tilted head alone shows no cant', () => {
  // Clockwise on screen drops the image-right side: the patient's left.
  assert.deepEqual(showFace(faceMeasurements(rotated(levelFace(), 4))), {
    headTilt: "4.0°, patient's left side lower",
    midlineCant: '0.0°',
    lipLineCant: '0.0°',
  });
  assert.deepEqual(showFace(faceMeasurements(rotated(levelFace(), -7.5))), {
    headTilt: "7.5°, patient's right side lower",
    midlineCant: '0.0°',
    lipLineCant: '0.0°',
  });
});

test('a cant on a tilted head is measured from the pupil line, not the image', () => {
  const refs = levelFace();
  // Lip line: left corner 3 degrees lower than the right, across 140px.
  refs.lipCurve = [vec(430, 520), vec(500, 530), vec(570, 520 + 140 * Math.tan(rad(3)))];
  const m = faceMeasurements(rotated(refs, -2));
  assert.equal(formatTilt(m.headTilt, 'panel'), "2.0°, patient's right side lower");
  assert.equal(formatTilt(m.lipLineCant, 'panel'), "3.0°, patient's left side lower");
});

test('midline cant names the side its lower end points toward', () => {
  const refs = levelFace();
  refs.midlineBottom = vec(500 + 500 * Math.tan(rad(3)), 700);
  assert.equal(
    formatMidline(faceMeasurements(refs).midlineCant, 'panel'),
    "3.0°, lower end toward patient's left",
  );

  refs.midlineBottom = vec(500 - 500 * Math.tan(rad(1.2)), 700);
  assert.equal(
    formatMidline(faceMeasurements(refs).midlineCant, 'panel'),
    "1.2°, lower end toward patient's right",
  );
});

test('midline handles dragged past each other give the same answer', () => {
  const refs = levelFace();
  refs.midlineBottom = vec(500 + 500 * Math.tan(rad(3)), 700);
  const swapped = { ...refs, midlineTop: refs.midlineBottom, midlineBottom: refs.midlineTop };
  assert.deepEqual(showFace(faceMeasurements(swapped)), showFace(faceMeasurements(refs)));
});

test('lip line cant does not depend on the order of its points', () => {
  const refs = levelFace();
  refs.lipCurve = [vec(430, 520), vec(500, 530), vec(570, 520 + 140 * Math.tan(rad(3)))];
  const reversed = { ...refs, lipCurve: [...refs.lipCurve].reverse() };
  assert.equal(formatTilt(faceMeasurements(refs).lipLineCant, 'panel'), "3.0°, patient's left side lower");
  assert.deepEqual(showFace(faceMeasurements(reversed)), showFace(faceMeasurements(refs)));
});

test('a mirrored photo names the same sides', () => {
  const refs = rotated(levelFace(), 4);
  refs.midlineBottom = vec(refs.midlineBottom.x + 30, refs.midlineBottom.y);
  refs.lipCurve = refs.lipCurve.map((p, i) => (i === 0 ? vec(p.x, p.y + 12) : p));

  const straight = showFace(faceMeasurements(refs));
  // Sanity: every value here carries a side, so the comparison means something.
  for (const text of Object.values(straight)) assert.match(text, /patient's (left|right)/);
  assert.deepEqual(showFace(faceMeasurements(mirrored(refs))), straight);
});

test('angles are rounded to 0.1 degree, and anything that shows as 0.0 is level', () => {
  const at = (degrees: number, side: 'left' | 'right') =>
    formatTilt({ ok: true, value: { degrees, side } }, 'panel');
  assert.equal(at(2.96, 'left'), "3.0°, patient's left side lower");
  assert.equal(at(2.94, 'left'), "2.9°, patient's left side lower");
  assert.equal(at(0.04, 'right'), '0.0°');
  assert.equal(at(0.06, 'right'), "0.1°, patient's right side lower");
});

test('no references: every face row is "-"', () => {
  assert.deepEqual(showFace(faceMeasurements(null)), {
    headTilt: '- (no facial references)',
    midlineCant: '- (no facial references)',
    lipLineCant: '- (no facial references)',
  });
  assert.deepEqual(showFace(faceMeasurements(null), 'report'), {
    headTilt: '-',
    midlineCant: '-',
    lipLineCant: '-',
  });
});

test('pupils on top of each other: head tilt and both cants are "-"', () => {
  const refs = levelFace();
  refs.leftPupil = refs.rightPupil;
  assert.deepEqual(showFace(faceMeasurements(refs)), {
    headTilt: '- (pupils on top of each other)',
    midlineCant: '- (pupils on top of each other)',
    lipLineCant: '- (pupils on top of each other)',
  });
});

test('a midline with no length only loses the midline cant', () => {
  const refs = levelFace();
  refs.midlineBottom = refs.midlineTop;
  assert.deepEqual(showFace(faceMeasurements(refs)), {
    headTilt: '0.0°',
    midlineCant: '- (midline has no length)',
    lipLineCant: '0.0°',
  });
});

test('a lip line that is too short only loses the lip line cant', () => {
  const refs = levelFace();
  refs.lipCurve = [vec(500, 530)];
  assert.equal(formatTilt(faceMeasurements(refs).lipLineCant, 'panel'), '- (lip line needs two points)');

  refs.lipCurve = [vec(500, 530), vec(500, 530)];
  assert.equal(
    formatTilt(faceMeasurements(refs).lipLineCant, 'panel'),
    '- (lip line ends on top of each other)',
  );
  assert.equal(formatTilt(faceMeasurements(refs).lipLineCant, 'report'), '-');
  assert.equal(formatTilt(faceMeasurements(refs).headTilt, 'panel'), '0.0°');
});

// --- teeth --------------------------------------------------------------------

test('the default design reads 80%, 70%, 49% on both sides', () => {
  assert.deepEqual(showTeeth(toothMeasurements(design(ANTERIOR_SIX), natural)), {
    right: ['80%', '70%', '49%'],
    left: ['80%', '70%', '49%'],
  });
});

test('the numbers follow the ratio and tooth proportion sliders, not the scale', () => {
  const teeth = design(ANTERIOR_SIX, { ratio: 0.75, redProportion: 0.62, scale: 1.6 });
  assert.deepEqual(showTeeth(toothMeasurements(teeth, natural)), {
    right: ['75%', '62%', '38%'],
    left: ['75%', '62%', '38%'],
  });
});

test('the Hollywood template is measured with its own sizes', () => {
  const hollywood = getTemplate('hollywood')!;
  const teeth = fitArches(ANTERIOR_SIX, hollywood, DEFAULT_FIT).teeth;
  assert.deepEqual(showTeeth(toothMeasurements(teeth, hollywood)), {
    right: ['80%', '70%', '49%'],
    left: ['80%', '70%', '49%'],
  });
});

test('a narrow arch foreshortens the lateral and canine but not the central', () => {
  const m = toothMeasurements(design(ANTERIOR_SIX, { archWidth: 0.8 }), natural);
  assert.equal(formatPercent(m.left.centralWidthToLength, 'panel'), '80%');
  assert.ok(m.left.lateralToCentral.ok && m.left.lateralToCentral.value < 0.7);
  assert.ok(m.left.canineToCentral.ok && m.left.canineToCentral.value < 0.49);
});

test('a per-tooth edit shows on its own side only', () => {
  // Widen 21 (universal 9) by 10%: width:length 0.88, neighbours now a smaller
  // share of it -- 0.70 / 1.1 = 64%, 0.49 / 1.1 = 45%.
  const edits = editTooth({}, 9, { ...IDENTITY_EDIT, scaleX: 1.1 }, false);
  assert.deepEqual(showTeeth(toothMeasurements(design(ANTERIOR_SIX, {}, edits), natural)), {
    right: ['80%', '70%', '49%'],
    left: ['88%', '64%', '45%'],
  });
});

test('rotating a tooth does not change its numbers', () => {
  const edits = editTooth({}, 9, { ...IDENTITY_EDIT, rotation: 0.3 }, false);
  assert.deepEqual(showTeeth(toothMeasurements(design(ANTERIOR_SIX, {}, edits), natural)).left, [
    '80%',
    '70%',
    '49%',
  ]);
});

test('teeth not in the design are "-", named in FDI', () => {
  // Centrals and laterals only: no canines.
  assert.deepEqual(showTeeth(toothMeasurements(design([7, 8, 9, 10]), natural)), {
    right: ['80%', '70%', '- (13 not in the design)'],
    left: ['80%', '70%', '- (23 not in the design)'],
  });
});

test('hidden teeth do not count', () => {
  // 12 and 13 picked: 11 is laid out as a hidden anchor, so the right side has
  // no central to measure against, and the left side nothing at all.
  assert.deepEqual(showTeeth(toothMeasurements(design([6, 7]), natural)), {
    right: ['- (11 not in the design)', '- (11 not in the design)', '- (11 not in the design)'],
    left: ['- (21 not in the design)', '- (21 not in the design)', '- (21 not in the design)'],
  });
});

test('lower teeth do not count', () => {
  const m = toothMeasurements(design([22, 23, 24, 25, 26, 27]), natural);
  assert.equal(formatPercent(m.right.centralWidthToLength, 'panel'), '- (11 not in the design)');
  assert.equal(formatPercent(m.left.centralWidthToLength, 'panel'), '- (21 not in the design)');
});

test('no design: every tooth row is "-", plain in the report', () => {
  const none = ['- (no design yet)', '- (no design yet)', '- (no design yet)'];
  assert.deepEqual(showTeeth(toothMeasurements(null, natural)), { right: none, left: none });
  assert.deepEqual(showTeeth(toothMeasurements(design(ANTERIOR_SIX), undefined)), {
    right: none,
    left: none,
  });
  assert.deepEqual(showTeeth(toothMeasurements(design([7, 8, 9, 10]), natural), 'report'), {
    right: ['80%', '70%', '-'],
    left: ['80%', '70%', '-'],
  });
});

// --- dental midline -------------------------------------------------------------

/** Every tooth of a selection moved sideways by `dx` face units. */
function nudged(selected: number[], dx: number) {
  let edits = {};
  for (const u of selected) {
    edits = editTooth(edits, u, { ...IDENTITY_EDIT, offset: vec(dx, 0) }, false);
  }
  return edits;
}

const midline = (refs: FacialReferences | null, teeth: ReturnType<typeof design> | null, where: Where = 'panel') =>
  formatOffset(dentalMidlineOffset(refs, teeth, natural), where);

test('a symmetric design on the facial midline reads 0%, with no side', () => {
  assert.equal(midline(levelFace(), design(ANTERIOR_SIX)), '0%');
});

test('a design nudged sideways reads the offset as a share of a central', () => {
  // A central is 0.25 face units wide at scale 1.
  assert.equal(midline(levelFace(), design(ANTERIOR_SIX, {}, nudged(ANTERIOR_SIX, 0.0225))), "9%, toward patient's left");
  assert.equal(midline(levelFace(), design(ANTERIOR_SIX, {}, nudged(ANTERIOR_SIX, -0.05))), "20%, toward patient's right");
  // The same face-unit nudge at twice the scale is half the share of a central.
  assert.equal(
    midline(levelFace(), design(ANTERIOR_SIX, { scale: 2 }, nudged(ANTERIOR_SIX, 0.05))),
    "10%, toward patient's left",
  );
});

test('centrals edited differently move the midline between their inner edges', () => {
  // 21 widened 20% about its own incisal midpoint: its inner edge moves 0.025
  // toward the patient's right, the midpoint half that, against an average
  // central of 0.275 -- 0.0125 / 0.275 = 4.5%.
  const edits = editTooth({}, 9, { ...IDENTITY_EDIT, scaleX: 1.2 }, false);
  const m = dentalMidlineOffset(levelFace(), design(ANTERIOR_SIX, {}, edits), natural);
  assert.ok(m.ok);
  assert.ok(Math.abs(m.value.fraction - 0.0125 / 0.275) < 1e-9);
  assert.equal(formatOffset(m, 'panel'), "5%, toward patient's right");
});

test('rotating a central does not move the midline point', () => {
  const edits = editTooth({}, 9, { ...IDENTITY_EDIT, rotation: 0.3 }, false);
  assert.equal(midline(levelFace(), design(ANTERIOR_SIX, {}, edits)), '0%');
});

test('a tilted head moves the design with it: no offset appears', () => {
  const teeth = design(ANTERIOR_SIX, {}, nudged(ANTERIOR_SIX, 0.0225));
  assert.equal(midline(rotated(levelFace(), 6), design(ANTERIOR_SIX)), '0%');
  assert.equal(midline(rotated(levelFace(), 6), teeth), "9%, toward patient's left");
  assert.equal(midline(rotated(levelFace(), -6), teeth), "9%, toward patient's left");
});

test('against a canted facial midline, the offset is along the pupil line at the biting edge height', () => {
  const refs = levelFace();
  refs.midlineBottom = vec(500 + 500 * Math.tan(rad(10)), 700);
  const teeth = design(ANTERIOR_SIX);
  const m = dentalMidlineOffset(refs, teeth, natural);

  // The design's origin is on the midline at the lip line; its biting edge
  // sits `drop` face units lower, where the canted midline has moved
  // drop x tan(10 deg) toward the patient's left. Measured square to the
  // midline instead, it would be cos(10 deg) = 1.5% smaller.
  const drop = (teeth.find((t) => t.universal === 8)!.position.y + teeth.find((t) => t.universal === 9)!.position.y) / 2;
  assert.ok(m.ok);
  assert.ok(Math.abs(m.value.fraction - (drop * Math.tan(rad(10))) / 0.25) < 1e-9);
  assert.equal(m.value.side, 'right');
});

test('a mirrored photo names the side by the handles', () => {
  // Toward the patient's left is image right here, image left once mirrored.
  const toLeft = design(ANTERIOR_SIX, {}, nudged(ANTERIOR_SIX, 0.0225));
  const toImageLeft = design(ANTERIOR_SIX, {}, nudged(ANTERIOR_SIX, -0.0225));
  assert.equal(midline(levelFace(), toLeft), "9%, toward patient's left");
  assert.equal(midline(mirrored(levelFace()), toImageLeft), "9%, toward patient's left");
  assert.equal(midline(mirrored(levelFace()), toLeft), "9%, toward patient's right");
});

test('midline offset rounds to whole percents, and 0% names no side', () => {
  const at = (fraction: number) => formatOffset({ ok: true, value: { fraction, side: 'left' } }, 'panel');
  assert.equal(at(0.004), '0%');
  assert.equal(at(0.006), "1%, toward patient's left");
  assert.equal(at(0.094), "9%, toward patient's left");
  assert.equal(at(0.096), "10%, toward patient's left");
});

test('both centrals must be shown', () => {
  // 21 hidden: laid out as an anchor for 22 but not selected.
  assert.equal(midline(levelFace(), design([7, 8, 10])), '- (21 not in the design)');
  // 11 not in the run at all.
  assert.equal(midline(levelFace(), design([9, 10])), '- (11 not in the design)');
  assert.equal(midline(levelFace(), design([9, 10]), 'report'), '-');
  assert.equal(midline(levelFace(), design([24, 25])), '- (11 not in the design)');
});

test('no design or no references: "-"', () => {
  assert.equal(midline(levelFace(), null), '- (no design yet)');
  assert.equal(formatOffset(dentalMidlineOffset(levelFace(), design(ANTERIOR_SIX), undefined), 'panel'), '- (no design yet)');
  assert.equal(midline(null, design(ANTERIOR_SIX)), '- (no facial references)');
  assert.equal(midline(null, design(ANTERIOR_SIX), 'report'), '-');
});

test('references the design cannot be placed against: "-" with the reason', () => {
  const teeth = design(ANTERIOR_SIX);
  const broken = (change: (refs: FacialReferences) => void) => {
    const refs = levelFace();
    change(refs);
    return midline(refs, teeth);
  };
  assert.equal(broken((r) => (r.leftPupil = r.rightPupil)), '- (pupils on top of each other)');
  assert.equal(broken((r) => (r.midlineBottom = r.midlineTop)), '- (midline has no length)');
  assert.equal(broken((r) => (r.leftAla = r.rightAla)), '- (nasal wings on top of each other)');
  assert.equal(broken((r) => (r.lipCurve = [vec(500, 530)])), '- (lip line needs two points)');
  assert.equal(
    broken((r) => {
      r.midlineTop = vec(400, 500);
      r.midlineBottom = vec(600, 500);
    }),
    '- (midline runs along the pupil line)',
  );
});
