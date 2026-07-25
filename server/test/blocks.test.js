process.env.OCEANMIND_TEST_AI = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileExpr } from '../../client/src/lessons/blocks/mathExpr.js';
import { sanitizeBlock } from '../lib/generate.js';

test('every catalog block is offered by the generator, and every sample survives sanitising', async () => {
  const { BLOCK_CATALOG } = await import('../content/blockCatalog.js');
  const { ALL_BLOCK_TYPES } = await import('../lib/generate.js');
  const seen = new Set();
  for (const entry of BLOCK_CATALOG) {
    assert.ok(!seen.has(entry.type), `duplicate catalog entry ${entry.type}`);
    seen.add(entry.type);
    assert.ok(entry.name && entry.desc && entry.source, `${entry.type} needs name/desc/source`);
    const topics = entry.topic === 'any' ? Object.keys(ALL_BLOCK_TYPES) : [entry.topic];
    for (const t of topics) {
      assert.ok(ALL_BLOCK_TYPES[t].includes(entry.type), `${entry.type} missing from generator catalog for ${t}`);
    }
    const probeTopic = entry.topic === 'any' ? 'neural-networks' : entry.topic;
    assert.ok(sanitizeBlock(entry.sample, probeTopic), `${entry.type} sample failed sanitising`);
  }
  // and every generator-offered type is documented in the catalog
  for (const [topic, types] of Object.entries(ALL_BLOCK_TYPES)) {
    for (const t of types) assert.ok(seen.has(t), `block "${t}" (${topic}) is offered but missing from the admin catalog`);
  }
});

test('mathExpr evaluates formulas with vars and functions', () => {
  assert.equal(compileExpr('2 + 3 * 4')({}), 14);
  assert.equal(compileExpr('(y - (w*x + b))^2')({ y: 1, w: 1, x: 1, b: 0 }), 0);
  assert.equal(compileExpr('(y - (w*x + b))^2')({ y: 1, w: 0, x: 1, b: 0 }), 1);
  assert.ok(Math.abs(compileExpr('sigmoid(0)')({}) - 0.5) < 1e-9);
  assert.equal(compileExpr('max(3, 7)')({}), 7);
  assert.equal(compileExpr('relu(x)')({ x: -5 }), 0);
});

test('mathExpr rejects unsafe / malformed input', () => {
  assert.throws(() => compileExpr('alert(1)'));       // unknown function
  assert.throws(() => compileExpr('1 +'));            // trailing op
  assert.throws(() => compileExpr('a["x"]'));         // illegal chars
});

test('simulator block sanitizes to safe shape', () => {
  const ok = sanitizeBlock({
    type: 'simulator', title: 'J', expr: 'w*x + b', xVar: 'x', xRange: [-2, 2],
    vars: [{ name: 'w', min: -1, max: 1, init: 0.5 }, { name: 'bad', min: 2, max: 1 }],
  }, 'neural-networks');
  assert.equal(ok.type, 'simulator');
  assert.equal(ok.vars.length, 1); // the min>=max var is dropped
  assert.deepEqual(ok.xRange, [-2, 2]);
  // dangerous expression → dropped entirely
  assert.equal(sanitizeBlock({ type: 'simulator', expr: 'process.exit()' }, 'neural-networks'), null);
});

test('sequence + pattern-explorer + new NN blocks accepted per topic', () => {
  const seq = sanitizeBlock({ type: 'sequence', stages: [{ label: 'A', detail: 'a' }, { label: 'B', detail: 'b' }] }, 'ai-agents');
  assert.equal(seq.stages.length, 2);
  assert.equal(sanitizeBlock({ type: 'sequence', stages: [{ label: 'only one' }] }, 'ai-agents'), null);

  const pat = sanitizeBlock({ type: 'pattern-explorer', initial: 'orchestrator' }, 'ai-agents');
  assert.equal(pat.initial, 'orchestrator');
  assert.equal(sanitizeBlock({ type: 'pattern-explorer', initial: 'nope' }, 'ai-agents').initial, 'chaining');

  assert.ok(sanitizeBlock({ type: 'backprop' }, 'neural-networks'));
  assert.ok(sanitizeBlock({ type: 'perceptron' }, 'neural-networks'));
  assert.ok(sanitizeBlock({ type: 'optimizer-race' }, 'neural-networks'));
  assert.equal(sanitizeBlock({ type: 'logic-gate' }, 'neural-networks').type, 'logic-gate');
  // wrong topic rejected
  assert.equal(sanitizeBlock({ type: 'pattern-explorer' }, 'neural-networks'), null);
  assert.equal(sanitizeBlock({ type: 'backprop' }, 'chatbots'), null);
});
