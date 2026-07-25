import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMLP, predict, trainEpoch, accuracy, makeDataset } from '../../client/src/lessons/mlp.js';

// deterministic PRNG for reproducible tests
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('predict outputs a probability', () => {
  const net = createMLP([4], mulberry32(1));
  const p = predict(net, [0.3, -0.2]);
  assert.ok(p > 0 && p < 1);
});

test('training reduces loss and reaches high accuracy on blobs', () => {
  const rand = mulberry32(7);
  const net = createMLP([4], rand);
  const data = makeDataset('blobs', 120, rand);
  const first = trainEpoch(net, data, 0.05, rand);
  let last = first;
  for (let e = 0; e < 60; e++) last = trainEpoch(net, data, 0.05, rand);
  assert.ok(last < first, `loss should drop (${first} → ${last})`);
  assert.ok(accuracy(net, data) > 0.9, `accuracy ${accuracy(net, data)} should exceed 0.9`);
});

test('datasets have both classes and stay in bounds', () => {
  for (const kind of ['blobs', 'circle', 'spiral']) {
    const data = makeDataset(kind, 80, mulberry32(3));
    assert.equal(data.length, 80);
    assert.ok(data.some((d) => d.y === 0) && data.some((d) => d.y === 1));
    for (const { x } of data) {
      assert.ok(Math.abs(x[0]) <= 1.3 && Math.abs(x[1]) <= 1.3);
    }
  }
});
