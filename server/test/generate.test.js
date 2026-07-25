process.env.OCEANMIND_TEST_AI = '1'; // mock provider — exercises the real pipeline deterministically

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../ai.js';
import { topChunks, loadResource } from '../lib/retrieval.js';
import { compileKnowledgeMap, generateQuestions, generateLesson, generateSummary, tutorDecide, generateExpansionSteps } from '../lib/generate.js';
import { getTopic } from '../content/topics.js';
import { runTool } from '../lib/agentTools.js';
import { runFlow } from '../lib/flowRun.js';

test('extractJson handles fences, prose, and nested braces', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go: {"a":{"b":[1,2]},"c":"x}y"} hope that helps'), { a: { b: [1, 2] }, c: 'x}y' });
  assert.deepEqual(extractJson('[1,2,3]'), [1, 2, 3]);
  assert.throws(() => extractJson('no json here'));
});

test('resource files load and retrieval returns relevant chunks', () => {
  for (const id of ['neural-networks', 'ai-agents', 'chatbots']) {
    const chunks = loadResource(id);
    assert.ok(chunks && chunks.length > 3, `${id} should have chunks`);
  }
  const hit = topChunks('neural-networks', 'gradient descent learning rate', 2000);
  assert.ok(hit.toLowerCase().includes('gradient'), 'should retrieve gradient-related text');
  assert.ok(hit.length <= 2400, 'respects the char budget');
});

test('pipeline: knowledge map → questions → lesson (via mock provider)', async () => {
  const topic = getTopic('neural-networks');
  const km = await compileKnowledgeMap(topic);
  assert.ok(km.mustKnow.length >= 3 && km.needToKnow.length >= 2);

  const qs = await generateQuestions(topic, km);
  assert.equal(qs.length, 6);
  for (const q of qs) {
    assert.ok(q.id && q.text && q.options.length === 4);
    assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
    assert.ok(q.options[q.correctIndex], 'shuffle preserved the correct option');
    assert.ok(q.explanation);
  }

  const answered = qs.map((q, i) => ({
    questionId: q.id, concept: q.concept, correct: i < 2, noIdea: i === 5,
    chosenText: q.options[0], correctText: q.options[q.correctIndex],
  }));
  const lesson = await generateLesson(topic, { zone: 'twilight', scorePct: 33, answered, knowledgeMap: km });
  assert.ok(lesson.title && lesson.intro);
  assert.ok(lesson.steps.length >= 4);
  const interactive = lesson.steps.filter((s) => s.block && s.block.type !== 'check');
  assert.ok(interactive.length >= Math.ceil(lesson.steps.length / 2), 'interactive-first: half the steps carry blocks');
  const check = lesson.steps.find((s) => s.block?.type === 'check');
  assert.ok(check.block.question.options.length >= 3 && Number.isInteger(check.block.question.correctIndex));
});

test('tutor agent: answer, expand, and redesign decisions execute', async () => {
  const topic = getTopic('ai-agents');
  const km = await compileKnowledgeMap(topic);
  const lesson = await generateLesson(topic, { zone: 'twilight', scorePct: 50, answered: [], knowledgeMap: km });

  const a = await tutorDecide(topic, lesson, 0, [{ role: 'user', content: 'what is a tool?' }]);
  assert.equal(a.action, 'answer');

  const e = await tutorDecide(topic, lesson, 0, [{ role: 'user', content: 'can you clarify this step by step?' }]);
  assert.equal(e.action, 'expand');
  const steps = await generateExpansionSteps(topic, 'twilight', e.about, lesson.steps[0]);
  assert.ok(steps.length >= 1 && steps.length <= 3);
  assert.ok(steps.every((s) => s.title && s.body));

  const r = await tutorDecide(topic, lesson, 0, [{ role: 'user', content: 'I want to build a marketing agent for my company' }]);
  assert.equal(r.action, 'redesign');
  const rebuilt = await generateLesson(topic, { zone: 'twilight', scorePct: 50, answered: [], knowledgeMap: km, userGoal: r.goal });
  assert.ok(rebuilt.steps.some((s) => s.block?.type === 'flow-builder' && s.block.template === 'marketing'), 'redesigned lesson uses the marketing flow template');
});

test('dive-log summary generates in the right shape', async () => {
  const topic = getTopic('neural-networks');
  const km = await compileKnowledgeMap(topic);
  const lesson = await generateLesson(topic, { zone: 'sunlight', scorePct: 20, answered: [], knowledgeMap: km });
  const s = await generateSummary(topic, { zone: 'sunlight', scorePct: 20, answered: [], lesson });
  assert.ok(s.headline);
  for (const k of ['learned', 'built', 'nextSteps']) assert.ok(Array.isArray(s[k]) && s[k].length >= 2, k);
});

test('sanitizeBlock repairs malformed blocks instead of failing the lesson', async () => {
  const { sanitizeBlock } = await import('../lib/generate.js');
  // the exact reported failure: chart with too many / broken series
  const bad = {
    type: 'chart', kind: 'area',
    series: [
      { name: 'a', points: [['1', '2'], [3, 4]] },        // string numbers → coerced
      { name: 'b', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }, // object points → coerced
      { name: 'c', points: [[1, 'oops']] },                // broken → dropped
      { name: 'd', points: [[1, 1], [2, 2]] },
      { name: 'e', points: [[1, 1], [2, 2]] },
      { name: 'f', points: [[1, 1], [2, 2]] },             // >4 series → clamped
    ],
  };
  const fixed = sanitizeBlock(bad, 'neural-networks');
  assert.ok(fixed && fixed.kind === 'line' && fixed.series.length === 4);
  assert.deepEqual(fixed.series[0].points, [[1, 2], [3, 4]]);
  // hopeless chart → dropped (null), not an exception
  assert.equal(sanitizeBlock({ type: 'chart', series: [] }, 'neural-networks'), null);
  // wrong-topic block → dropped
  assert.equal(sanitizeBlock({ type: 'neuron' }, 'chatbots'), null);
  // diagram with dangling edges → edges filtered, nodes kept
  const dg = sanitizeBlock({ type: 'diagram', nodes: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }], edges: [{ from: 1, to: 2 }, { from: 9, to: 1 }] }, 'ai-agents');
  assert.equal(dg.edges.length, 1);
});

test('flow runner executes a real flow and rejects cycles', async () => {
  const nodes = [
    { id: 'a', type: 'trigger', config: { label: 'In' } },
    { id: 'b', type: 'tool', config: { label: 'Calc', tool: 'calculator' } },
    { id: 'c', type: 'output', config: { label: 'Out' } },
  ];
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const r = await runFlow(nodes, edges, '3*(4+1)');
  assert.equal(r.error, null);
  assert.equal(r.trace.length, 3);
  assert.match(r.trace[1].output, /= 15/);
  assert.match(r.trace[2].output, /= 15/, 'output node collects upstream result');

  const cyc = await runFlow(nodes, [...edges, { from: 'c', to: 'a' }], 'x');
  assert.ok(cyc.error && /loop/i.test(cyc.error));

  const noTrigger = await runFlow(nodes.slice(1), [{ from: 'b', to: 'c' }], 'x');
  assert.ok(noTrigger.error && /Trigger/i.test(noTrigger.error));
});

test('agent tools really execute', () => {
  const ctx = { topicId: 'ai-agents', notes: [] };
  assert.match(runTool('calculator', '2+2*10', ctx), /= 22$/);
  assert.match(runTool('calculator', 'delete everything', ctx), /error/i);
  assert.match(runTool('notes', 'remember the budget', ctx), /Saved note #1/);
  assert.equal(ctx.notes.length, 1);
  const search = runTool('docsearch', 'agent tools', ctx);
  assert.ok(search.includes('passages') || search.includes('No passages'));
  assert.match(runTool('nonsense-tool', '', ctx), /Unknown tool/);
});
