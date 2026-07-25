import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneForScore, depthForScore, midZoneDepth } from '../lib/scoring.js';

test('zone boundaries follow the spec', () => {
  assert.equal(zoneForScore(0), 'sunlight');
  assert.equal(zoneForScore(39), 'sunlight');
  assert.equal(zoneForScore(40), 'twilight');
  assert.equal(zoneForScore(74), 'twilight');
  assert.equal(zoneForScore(75), 'midnight');
  assert.equal(zoneForScore(100), 'midnight');
});

test('depth mapping lands inside the right zone ranges', () => {
  assert.equal(depthForScore(0), 40);
  assert.ok(depthForScore(39) < 200);
  assert.equal(depthForScore(40), 200);
  const d55 = depthForScore(55); // spec example: 55% → ~520 m
  assert.ok(d55 > 500 && d55 < 560, `55% gave ${d55}`);
  assert.equal(depthForScore(75), 1000);
  assert.equal(depthForScore(100), 4000);
});

test('midZoneDepth returns a depth inside the zone', () => {
  assert.ok(midZoneDepth('sunlight') > 0 && midZoneDepth('sunlight') < 200);
  assert.ok(midZoneDepth('twilight') >= 200 && midZoneDepth('twilight') < 1000);
  assert.ok(midZoneDepth('midnight') >= 1000 && midZoneDepth('midnight') <= 4000);
});
