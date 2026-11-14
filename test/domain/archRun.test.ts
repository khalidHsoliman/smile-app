import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArchRun, resolveArchRuns } from '../../src/domain/archRun.js';

test('a selection containing a central stays as picked', () => {
  assert.deepEqual(resolveArchRun([7, 8, 9, 10], 'upper'), {
    run: [7, 8, 9, 10],
    auxiliary: [],
  });
});

test('a gap inside the selection is filled with hidden teeth', () => {
  assert.deepEqual(resolveArchRun([6, 8, 11], 'upper'), {
    run: [6, 7, 8, 9, 10, 11],
    auxiliary: [7, 9, 10],
  });
});

test('a selection without a central is widened to the nearer central', () => {
  // Upper right laterals/canine only: the anchor is 8.
  assert.deepEqual(resolveArchRun([6, 7], 'upper'), { run: [6, 7, 8], auxiliary: [8] });
  // Upper left only: the anchor is 9.
  assert.deepEqual(resolveArchRun([11], 'upper'), { run: [9, 10, 11], auxiliary: [9, 10] });
  // Lower arch uses its own centrals, 24 and 25.
  assert.deepEqual(resolveArchRun([22], 'lower'), { run: [22, 23, 24], auxiliary: [23, 24] });
});

test('no teeth in an arch gives an empty run, not a lone anchor', () => {
  assert.deepEqual(resolveArchRun([], 'upper'), { run: [], auxiliary: [] });
  assert.deepEqual(resolveArchRun([8, 9], 'lower'), { run: [], auxiliary: [] });
});

test('duplicates and unsorted input are tolerated', () => {
  assert.deepEqual(resolveArchRun([9, 8, 9], 'upper'), { run: [8, 9], auxiliary: [] });
});

test('resolveArchRuns splits a mixed selection by arch', () => {
  const runs = resolveArchRuns([8, 9, 24, 25]);
  assert.deepEqual(runs.upper.run, [8, 9]);
  assert.deepEqual(runs.lower.run, [24, 25]);
});
