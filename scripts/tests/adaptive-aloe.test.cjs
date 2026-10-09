/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the shipped frame policy with deterministic clocks. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AdaptiveAloeQuality } = require('../../lib/viewer/adaptive-aloe.ts');
function fixture() {
  const records = new Map(), writes = [];
  const policy = new AdaptiveAloeQuality({ read: key => records.get(key), write(key, value) { records.set(key, value); writes.push(value); } });
  policy.configure(500, 700, 60);
  return { policy, records, writes };
}
function qualifyWhite(policy) {
  for (let now = 0; now <= 2100; now += 1000 / 60) policy.frame(now, 2, true);
  assert.equal(policy.quality, 'eligible');
}
function qualifyFull(policy) {
  qualifyWhite(policy);
  assert.equal(policy.beginProbe(3000, true, false), true);
  for (let now = 3000; policy.probing && now < 3700; now += 1000 / 60) { policy.checkDeadline(now); policy.frame(now, 3, false); }
  assert.equal(policy.quality, 'full');
}

test('first load stays white and stable white cadence never starts an exposed or interactive trial', () => {
  const { policy, writes } = fixture();
  assert.equal(policy.quality, 'white'); assert.equal(policy.needsBackdrop, false);
  qualifyWhite(policy);
  assert.equal(policy.needsBackdrop, false);
  assert.equal(policy.beginProbe(3000, false, false), false);
  assert.equal(policy.beginProbe(3000, true, true), false);
  policy.advance(10, true); assert.equal(policy.mix, 0); assert.equal(writes.length, 0);
});

test('actual full workload must pass a bounded hidden trial before a quiet fade can reveal it', () => {
  const { policy, writes } = fixture(); qualifyFull(policy);
  assert.deepEqual(writes, ['full']); assert.equal(policy.mix, 0);
  policy.advance(.35, true); assert.ok(Math.abs(policy.mix - .5) < 1e-10);
  policy.advance(5, false); assert.ok(Math.abs(policy.mix - .5) < 1e-10, 'Dragging/transitioning cannot advance the fade');
  policy.advance(.35, true); assert.equal(policy.mix, 1);
  policy.enter(); assert.equal(policy.mix, 0); assert.equal(policy.quality, 'full');
});

test('sustained slow white frames settle on the lightweight mode without a full trial', () => {
  const { policy, writes } = fixture();
  for (let now = 0; now < 2500; now += 1000 / 30) policy.frame(now, 3, true);
  assert.equal(policy.quality, 'white'); assert.deepEqual(writes, ['white']);
  assert.equal(policy.beginProbe(3000, true, false), false);
  for (let now = 4000; now < 7000; now += 1000 / 60) policy.frame(now, 1, true);
  assert.equal(policy.quality, 'white'); assert.deepEqual(writes, ['white'], 'No repeated benchmark toggling');
});

test('slow trial or too much CPU submission remains white even on a previously stable baseline', () => {
  for (const [gap, cost] of [[1000 / 30, 3], [1000 / 60, 22]]) {
    const { policy } = fixture(); qualifyWhite(policy); policy.beginProbe(3000, true, false);
    for (let now = 3000; policy.probing && now < 3800; now += gap) { policy.checkDeadline(now); policy.frame(now, cost, false); }
    assert.equal(policy.quality, 'white'); assert.equal(policy.mix, 0); assert.equal(policy.needsBackdrop, false);
  }
});

test('a suspended or cancelled trial cannot leave an unbounded hidden gap or qualify full', () => {
  const { policy } = fixture(); qualifyWhite(policy); policy.beginProbe(3000, true, false);
  policy.checkDeadline(3800); assert.equal(policy.quality, 'white'); assert.equal(policy.reason, 'trial-timeout');
  const second = fixture().policy; qualifyWhite(second); second.beginProbe(3000, true, false); second.cancelProbe();
  assert.equal(second.quality, 'white'); assert.equal(second.reason, 'trial-cancelled');
});

test('loading, hidden-tab and paused gaps do not count as device slowdown', () => {
  const { policy } = fixture();
  policy.frame(0, 1, true); policy.frame(20000, 500, false); policy.resetCadence();
  for (let now = 40000; now <= 42200; now += 1000 / 60) policy.frame(now, 2, true);
  assert.equal(policy.quality, 'eligible');
});

test('sustained real full slowdown queues one downgrade and waits for interaction to finish', () => {
  const { policy, writes } = fixture(); qualifyFull(policy); policy.advance(1, true);
  for (let now = 5000; now < 7500; now += 1000 / 30) policy.frame(now, 3, true);
  policy.advance(3, false); assert.equal(policy.quality, 'full'); assert.equal(policy.mix, 1);
  policy.advance(.3, true); assert.ok(policy.mix > 0 && policy.mix < 1);
  policy.advance(.3, true); assert.equal(policy.quality, 'white'); assert.equal(policy.mix, 0);
  assert.deepEqual(writes, ['full', 'white']); assert.equal(policy.beginProbe(10000, true, false), false);
});

test('session decisions reuse matching workloads and never classify a larger buffer from a smaller one', () => {
  const { policy } = fixture(); qualifyFull(policy);
  policy.configure(1200, 1000, 60); assert.equal(policy.quality, 'white'); assert.equal(policy.needsBackdrop, false);
  policy.configure(500, 700, 60); assert.equal(policy.quality, 'full'); assert.equal(policy.mix, 0);
  policy.configure(500, 700, 30); assert.equal(policy.quality, 'white', 'FPS policy is part of the workload key');
});
