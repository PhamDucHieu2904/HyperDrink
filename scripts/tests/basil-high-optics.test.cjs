/* Run with: node scripts/tests/basil-high-optics.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Pure optical math is tested without a graphics context. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../register-admin-typescript.cjs');
const { basilHighFresnel, basilHighLiquidParameters } = require('../../lib/viewer/basil-high-optics.ts');
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('High dielectric interfaces conserve normal-incidence Fresnel and obey total internal reflection', () => {
  for (const [etaI, etaT] of [[1, 1.52], [1.52, 1.333], [1.333, 1]]) {
    near(basilHighFresnel(1, etaI, etaT), ((etaI - etaT) / (etaI + etaT)) ** 2);
    near(basilHighFresnel(1, etaI, etaT), basilHighFresnel(1, etaT, etaI));
  }
  assert.equal(basilHighFresnel(.5, 1.52, 1), 1);
  assert.equal(basilHighFresnel(.4, 1.333, 1), 1);
  for (const cosine of [0, .1, .25, .5, .75, 1]) {
    const reflectance = basilHighFresnel(cosine, 1, 1.52);
    assert.ok(Number.isFinite(reflectance) && reflectance >= 0 && reflectance <= 1);
  }
});

test('High extinction uses the source sRGB water channels and preserves UI default density', () => {
  const water = basilHighLiquidParameters([0, .77808976, 1], 1, 1, 1, .6, .606);
  assert.deepEqual(water.absorption, [7.5, 7.5 * (1 - .77808976), 0]);
  near(water.seedDepth, 1.1 * .606);
  assert.equal(water.spread, 0);
  assert.deepEqual(basilHighLiquidParameters([0, .77808976, 1], 1), water, 'The default helper uses the active BasilWater material, not the Strawberry preset');
  const edited = basilHighLiquidParameters([0, .77808976, 1], 1, .5, 2, .6, .606);
  assert.deepEqual(edited, water);
});

test('High clear-water controls remove colored extinction and distance veil together', () => {
  for (const [turbidity, opacity] of [[0, 1], [1, 0], [-2, 1]]) {
    const water = basilHighLiquidParameters([.6, .02, .03], .2, turbidity, opacity, .6, .606);
    assert.ok(water.absorption.every(channel => channel === 0));
    assert.equal(water.seedDepth, 0);
    assert.ok(water.spread > 0);
  }
  const clipped = basilHighLiquidParameters([-.5, 2, .5], -1, 4, 5, 4, 2);
  assert.deepEqual(clipped.absorption, [67.5, 0, 33.75]);
  near(clipped.seedDepth, 16.2);
  near(clipped.spread, .015);
});

test('High blur changes angular transmission independently of saturation and visibility', () => {
  const sharp = basilHighLiquidParameters([.72, .03, .11], 1);
  const soft = basilHighLiquidParameters([.72, .03, .11], .5);
  assert.deepEqual(soft.absorption, sharp.absorption);
  assert.equal(soft.seedDepth, sharp.seedDepth);
  near(soft.spread, .015 * .5 ** 1.5);
});
