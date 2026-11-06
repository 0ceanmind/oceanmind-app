// Pitch-demo HTTP journey on an ephemeral port: status → sign-in → dive with a
// typed goal → placement via the _row answer key → goal-built lesson → Lulu
// expand → dive log → feedback → serverless self-healing (restore) → admin →
// rehearsal reset → a simulated cold start in a fresh process.
// Demo mode, instant replay; never the test mock.
process.env.OCEANMIND_DEMO = '1';
process.env.OCEANMIND_DEMO_SPEED = '0';
delete process.env.OCEANMIND_TEST_AI;
delete process.env.DATABASE_URL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { createApp } = await import('../app.js');
const { db, T } = await import('../db.js');
const {
  DEMO_COOKIE_SECRET, DEMO_PERSONA, DEMO_LATENCY_MS, DEMO_ROUTE_LATENCY_MS, DEMO_LATENCY_JITTER, DEMO_SEED_MAX_IDS, demoNextId,
} = await import('../demo/index.js');
const { DEMO_SEED_IDS } = await import('../demo/seed.js');
const { replayLatency } = await import('../aireplay.js');

const GOAL = 'I want to build an AI agent that answers my customers\' support emails';
const HERE = dirname(fileURLToPath(import.meta.url));

let server;
let base;

/** A tiny cookie-jar client, one per signed-in user. */
function client() {
  let cookie = null;
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null), cookie };
  };
}

const faisal = client();

test('start the app on an ephemeral port', async () => {
  server = createApp().listen(0);
  await new Promise((ok) => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('demo status, AI status and admin config (no auth needed for status)', async () => {
  const s = await faisal('GET', '/api/demo/status');
  assert.deepEqual(s.body, {
    demo: true, persona: DEMO_PERSONA, speed: 0,
    latency: DEMO_LATENCY_MS, routeLatency: DEMO_ROUTE_LATENCY_MS, jitter: DEMO_LATENCY_JITTER,
  });
  // one entry per model call the replay provider answers, ms at speed 1
  assert.deepEqual(Object.keys(s.body.latency).sort(), ['agent_step', 'chat', 'expand_steps', 'flow_node', 'integration_guide',
    'knowledge_map', 'lesson', 'questions', 'summary', 'topic_match', 'tutor_decide']);
  assert.ok(Object.values(s.body.latency).every((ms) => Number.isInteger(ms) && ms > 0));
  const L = s.body.latency;
  assert.deepEqual(s.body.routeLatency, {
    topicMatch: 0, topicMatchFallback: L.topic_match, createSession: L.knowledge_map + L.questions, buildLesson: L.lesson,
    tutorAnswer: L.tutor_decide, tutorExpand: L.tutor_decide + L.expand_steps, tutorRedesign: L.tutor_decide + L.lesson,
    summary: L.summary, agentStep: L.agent_step, flowNode: L.flow_node, integrationGuide: L.integration_guide, chat: L.chat,
  });

  const ai = await faisal('GET', '/api/ai/status');
  assert.deepEqual(ai.body, { configured: true, provider: 'replay', model: 'oceanmind-demo' });

  const admin = await faisal('GET', '/api/admin/config');
  assert.equal(admin.body.config.provider, 'replay');
  const entry = admin.body.providers[admin.body.config.provider];
  assert.ok(entry && entry.label && entry.keyHint && entry.defaultModel, 'Admin.jsx can read providers[config.provider].keyHint');
  assert.ok(admin.body.providers.gemini, 'the real providers are still listed');
  const ping = await faisal('POST', '/api/admin/test', { provider: 'replay' });
  assert.equal(ping.body.ok, true);

  // outside demo mode the status route still answers (never 404)
  process.env.OCEANMIND_DEMO = '0';
  try {
    assert.deepEqual((await faisal('GET', '/api/demo/status')).body, { demo: false });
  } finally {
    process.env.OCEANMIND_DEMO = '1';
  }
});

test('sign in as the seeded persona (user 1) with a cookie signed by the fixed demo secret', async () => {
  const r = await faisal('POST', '/api/auth/session', DEMO_PERSONA);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.user, { id: 1, ...DEMO_PERSONA });
  const expected = `1.${createHmac('sha256', DEMO_COOKIE_SECRET).update('1').digest('hex')}`;
  assert.equal(decodeURIComponent(r.cookie.split('=')[1]), expected, 'any instance can verify this cookie');
});

/** Everything the persona sees of the seeded history, minus the relative timestamps. */
const stripTimes = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/^(createdAt|updatedAt|created_at|updated_at)$/.test(k) ? undefined : x)));
async function historySnapshot(as) {
  const sessions = (await as('GET', '/api/sessions')).body.sessions;
  const details = [];
  for (const s of sessions) details.push((await as('GET', `/api/sessions/${s.id}`)).body);
  const projects = (await as('GET', '/api/projects')).body.projects;
  const projectDetails = [];
  for (const p of projects) projectDetails.push((await as('GET', `/api/projects/${p.id}`)).body.project);
  const { notifications } = (await as('GET', '/api/notifications')).body;
  const me = (await as('GET', '/api/auth/me')).body.user;
  return stripTimes({ me, sessions, details, projects, projectDetails, notifications });
}
let seedSnapshot;

test('the seeded history: logbook, projects, notification', async () => {
  // live rows are always numbered after the seed (the table ids the seed pins)
  for (const [table, max] of Object.entries(DEMO_SEED_MAX_IDS)) {
    assert.equal((await db.get(`SELECT MAX(id) AS m FROM ${table}`)).m, max, `${table}: the seed's highest id`);
  }
  seedSnapshot = await historySnapshot(faisal);

  const { sessions } = (await faisal('GET', '/api/sessions')).body;
  assert.deepEqual(sessions.map((s) => s.id), [3, 2, 1]);
  assert.deepEqual(sessions.map((s) => [s.topicId, s.zone, s.status, s.version]), [
    ['neural-networks', 'sunlight', 'closed', 1],
    ['chatbots', 'twilight', 'closed', 2],
    ['chatbots', 'sunlight', 'closed', 1],
  ]);
  const days = (ts) => (Date.now() - new Date(`${ts.replace(' ', 'T')}Z`).getTime()) / 86400000;
  assert.ok(Math.abs(days(sessions[0].createdAt) - 5) < 0.5, 'NN dive ~5 days ago');
  assert.ok(Math.abs(days(sessions[1].createdAt) - 12) < 0.5, 'rebuilt Chatbots dive ~12 days ago');

  const cb = (await faisal('GET', `/api/sessions/${DEMO_SEED_IDS.sessions.chatbotsRebuilt}`)).body.session;
  assert.equal(cb.status, 'closed');
  assert.equal(cb.rebuiltFrom, DEMO_SEED_IDS.sessions.chatbotsFirst);
  assert.ok(cb.summary.headline && cb.lesson.steps.length >= 4 && cb.goal);
  assert.ok(cb.feedback.rating >= 4);

  const { projects } = (await faisal('GET', '/api/projects')).body;
  assert.deepEqual(projects.map((p) => p.kind).sort(), ['flow', 'summary']);
  const log = projects.find((p) => p.kind === 'summary');
  assert.equal(log.name, 'Dive log · Chatbots');
  const flow = (await faisal('GET', `/api/projects/${projects.find((p) => p.kind === 'flow').id}`)).body.project;
  assert.ok(flow.data.nodes.some((n) => n.type === 'trigger') && flow.data.edges.length >= 2);

  const { notifications } = (await faisal('GET', '/api/notifications')).body;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].read, true);
  assert.equal(notifications[0].sessionId, DEMO_SEED_IDS.sessions.chatbotsRebuilt);
  assert.match(notifications[0].emailHtml, /Your new dive is ready, Faisal/);
});

let sessionId;
let lastRow;

test('dive 1: typed goal → topic → session with the goal and a _row answer key', async () => {
  const m = await faisal('POST', '/api/topics/match', { text: GOAL });
  assert.equal(m.body.match.id, 'ai-agents');

  const r = await faisal('POST', '/api/sessions', { topicId: 'ai-agents', goal: `  ${GOAL}  ` });
  assert.equal(r.status, 201);
  const { session, _row } = r.body;
  sessionId = session.id;
  assert.ok(sessionId > DEMO_SEED_IDS.sessions.neuralNetworks, 'live ids continue after the seed');
  assert.equal(session.goal, GOAL, 'goal stored trimmed');
  assert.equal(session.status, 'assessment');
  assert.ok(session.questions.every((q) => q.correctIndex === undefined), 'the learner view never leaks the key');
  assert.equal(_row.id, sessionId);
  assert.equal(_row.goal, GOAL);
  assert.equal(_row.questions.length, 6);
  assert.ok(_row.questions.every((q) => Number.isInteger(q.correctIndex)), '_row carries the shuffled key');
  lastRow = _row;
});

test('placement: 4/6 (one "no idea", one wrong) lands in the Twilight Zone at 817 m', async () => {
  const plan = ['right', 'right', 'noidea', 'right', 'wrong', 'right'];
  let last;
  for (const [i, q] of lastRow.questions.entries()) {
    const choice = plan[i] === 'noidea' ? -1 : plan[i] === 'right' ? q.correctIndex : (q.correctIndex + 1) % 4;
    last = await faisal('POST', `/api/sessions/${sessionId}/answer`, { questionId: q.id, choice });
    assert.equal(last.status, 200);
    assert.equal(last.body.correct, plan[i] === 'right');
    assert.equal(last.body._row.answered.length, i + 1, '_row reflects the write');
  }
  assert.deepEqual(last.body.summary, { scorePct: 67, zone: 'twilight', depth: 817 });
  lastRow = last.body._row;
});

test('build-lesson: the stored goal shapes the lesson', async () => {
  const r = await faisal('POST', `/api/sessions/${sessionId}/build-lesson`);
  assert.equal(r.status, 200);
  const { lesson, goal } = r.body.session;
  assert.equal(goal, GOAL);
  assert.equal(lesson.steps.length, 8);
  assert.deepEqual(lesson.steps.map((s) => s.block?.type), ['workflow-vs-agent', 'agent-loop', 'pattern-explorer', 'live-agent', 'guardrails', 'flow-builder', 'memory', 'check']);
  const check = r.body._row.lesson.steps[7].block.question;
  assert.ok(Number.isInteger(check.correctIndex) && check.options[check.correctIndex], '_row carries the check answer');

  // the same answers without a goal build a different lesson — the goal is what made it about support email
  const other = await faisal('POST', '/api/sessions', { topicId: 'ai-agents' });
  assert.equal(other.body.session.goal, null);
  for (const [i, q] of other.body._row.questions.entries()) {
    const plan = ['right', 'right', 'noidea', 'right', 'wrong', 'right'][i];
    await faisal('POST', `/api/sessions/${other.body.session.id}/answer`, { questionId: q.id, choice: plan === 'noidea' ? -1 : plan === 'right' ? q.correctIndex : (q.correctIndex + 1) % 4 });
  }
  const plain = (await faisal('POST', `/api/sessions/${other.body.session.id}/build-lesson`)).body.session.lesson;
  assert.notEqual(`${plain.title}\n${plain.intro}`, `${lesson.title}\n${lesson.intro}`, 'goal changes the lesson');
  assert.match(`${lesson.title} ${lesson.intro}`, /support|email|customer/i, 'goal-built lesson speaks to the goal');
});

test('Lulu: a plain answer, then an expansion spliced in after the current step', async () => {
  const a = await faisal('POST', `/api/sessions/${sessionId}/tutor`, { messages: [{ role: 'user', content: 'Why does tone matter in a support reply?' }], stepIndex: 2 });
  assert.equal(a.status, 200);
  assert.equal(a.body.updated, null);
  assert.ok(a.body.text);
  assert.equal(a.body._row.id, sessionId);

  const e = await faisal('POST', `/api/sessions/${sessionId}/tutor`, {
    messages: [{ role: 'user', content: 'Can you walk me through routing a support email step by step?' }], stepIndex: 2,
  });
  assert.equal(e.status, 200);
  assert.equal(e.body.updated, 'expanded');
  assert.equal(e.body.addedCount, 2);
  const steps = e.body.session.lesson.steps;
  assert.equal(steps.length, 10);
  assert.deepEqual([steps[3].block.type, steps[4].block.type], ['sequence', 'simulator']);
  assert.equal(steps[5].block.type, 'live-agent', 'the rest of the lesson moved down');
});

test('dive log: summary mentions what was actually built, then feedback closes the dive', async () => {
  const s = await faisal('POST', `/api/sessions/${sessionId}/summary`);
  assert.equal(s.status, 200);
  const { summary } = s.body;
  assert.ok(summary.headline && summary.learned.length >= 3 && summary.built.length >= 2);
  assert.deepEqual(s.body._row.summary, summary, 'the summary is cached on the row');
  assert.deepEqual((await faisal('POST', `/api/sessions/${sessionId}/summary`)).body.summary, summary, 'cached, not regenerated');

  const saved = await faisal('POST', '/api/projects', { kind: 'summary', name: 'Dive log · AI Agents', topicId: 'ai-agents', sessionId, data: summary });
  assert.equal(saved.status, 201);

  const f = await faisal('POST', `/api/sessions/${sessionId}/feedback`, { rating: 5 });
  assert.equal(f.status, 200);
  assert.equal(f.body.happy, true);
  assert.equal(f.body._row.status, 'closed');
  lastRow = f.body._row;
});

test('self-healing: a missing session answers DEMO_SESSION_MISSING and restores from its _row', async () => {
  await db.run(`DELETE FROM ${T.feedback} WHERE session_id = ?`, [sessionId]);
  await db.run(`DELETE FROM ${T.learning_sessions} WHERE id = ?`, [sessionId]);

  const missing = await faisal('GET', `/api/sessions/${sessionId}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'DEMO_SESSION_MISSING');
  const missingPost = await faisal('POST', `/api/sessions/${sessionId}/summary`);
  assert.equal(missingPost.body.code, 'DEMO_SESSION_MISSING');

  const restored = await faisal('POST', '/api/demo/restore', { row: lastRow });
  assert.deepEqual(restored.body, { ok: true, restored: sessionId, replaced: false });
  const back = await faisal('GET', `/api/sessions/${sessionId}`);
  assert.equal(back.status, 200);
  assert.equal(back.body.session.status, 'closed');
  assert.equal(back.body.session.goal, GOAL);
  assert.equal(back.body.session.lesson.steps.length, 10);
  assert.deepEqual(back.body._row.questions, lastRow.questions);

  // restoring again is idempotent (it replaces the caller's own row); stringified JSON columns work too
  const asStrings = { ...lastRow, lesson: JSON.stringify(lastRow.lesson) };
  assert.equal((await faisal('POST', '/api/demo/restore', { row: asStrings })).body.replaced, true);
  assert.equal((await faisal('GET', `/api/sessions/${sessionId}`)).body.session.lesson.steps.length, 10);
});

test('restore and missing-session guards', async () => {
  const other = client();
  const r = await other('POST', '/api/auth/session', { name: 'Judge', email: 'judge@example.com' });
  assert.equal(r.body.user.id, 2);
  // someone else's row
  assert.equal((await other('POST', '/api/demo/restore', { row: lastRow })).status, 403);
  // a session that exists but belongs to someone else is a plain 404 (nothing to restore)
  const notMine = await other('GET', `/api/sessions/${sessionId}`);
  assert.equal(notMine.status, 404);
  assert.equal(notMine.body.code, undefined);
  // a hijack attempt: the caller's own user_id on an id that belongs to someone else
  assert.equal((await other('POST', '/api/demo/restore', { row: { ...lastRow, user_id: 2 } })).status, 409);
  assert.equal((await faisal('POST', '/api/demo/restore', { row: { ...lastRow, status: 'hacked' } })).status, 400);
  assert.equal((await faisal('POST', '/api/demo/restore', {})).status, 400);
  // signed out
  assert.equal((await client()('POST', '/api/demo/restore', { row: lastRow })).status, 401);
});

test('projects: saving over an id this instance never saw inserts it (keeping the id)', async () => {
  const r = await faisal('POST', '/api/projects', { projectId: 987, kind: 'flow', name: 'Agent flow · Support inbox', topicId: 'ai-agents', data: { nodes: [], edges: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.projectId, 987);
  assert.equal((await faisal('GET', '/api/projects/987')).body.project.name, 'Agent flow · Support inbox');
  const again = await faisal('POST', '/api/projects', { projectId: 987, kind: 'flow', name: 'Agent flow · v2', data: { nodes: [], edges: [] } });
  assert.equal(again.body.projectId, 987);
  assert.equal((await faisal('GET', '/api/projects/987')).body.project.name, 'Agent flow · v2');
});

test('every /api/sessions/:id route answers DEMO_SESSION_MISSING for an id this instance lacks (never a 500)', async () => {
  const ghost = 424242;
  const routes = [
    ['GET', `/api/sessions/${ghost}`],
    ['POST', `/api/sessions/${ghost}/answer`, { questionId: 'q1', choice: 0 }],
    ['POST', `/api/sessions/${ghost}/answer`],
    ['POST', `/api/sessions/${ghost}/build-lesson`],
    ['POST', `/api/sessions/${ghost}/tutor`, { messages: [{ role: 'user', content: 'What is an agent?' }], stepIndex: 0 }],
    ['POST', `/api/sessions/${ghost}/tutor`, { messages: [] }],
    ['POST', `/api/sessions/${ghost}/summary`],
    ['POST', `/api/sessions/${ghost}/feedback`, { rating: 5 }],
    ['POST', `/api/sessions/${ghost}/feedback`, { rating: 'x' }],
    ['POST', `/api/sessions/${ghost}/no-such-step`],
  ];
  for (const [method, path, body] of routes) {
    const r = await faisal(method, path, body);
    assert.equal(r.status, 404, `${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    assert.deepEqual(r.body, { error: 'Session not found.', code: 'DEMO_SESSION_MISSING' }, `${method} ${path}`);
  }
  // signed out: the route's own 401 (there is nothing to heal with)
  const r401 = await client()('POST', `/api/sessions/${ghost}/tutor`, { messages: [] });
  assert.equal(r401.status, 401);
  assert.equal(r401.body.code, undefined);
  // ids that can never name a row: a plain JSON 404, never a 500
  for (const bad of ['abc', '0', '-3', '99999999999999999999']) {
    for (const [method, sub, body] of [['GET', ''], ['POST', '/summary'], ['POST', '/tutor', { messages: [{ role: 'user', content: 'hi' }] }], ['POST', '/feedback', { rating: 5 }]]) {
      const r = await faisal(method, `/api/sessions/${bad}${sub}`, body);
      assert.equal(r.status, 404, `${method} /api/sessions/${bad}${sub}`);
      assert.equal(r.body.code, undefined);
    }
  }
  // an unknown API route answers JSON as well
  const unknown = await faisal('GET', '/api/nope');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'Not found.');
});

test('self-healing on every route: the row vanishes before each call, the client restores its cached _row and retries', async () => {
  let cached = null;
  // another instance = a DB that never saw the row
  const forget = async (id) => {
    await db.run(`DELETE FROM ${T.reports} WHERE session_id = ?`, [id]);
    await db.run(`DELETE FROM ${T.feedback} WHERE session_id = ?`, [id]);
    await db.run(`DELETE FROM ${T.learning_sessions} WHERE id = ?`, [id]);
  };
  // what client/src/api.js does: cache _row, on DEMO_SESSION_MISSING restore once and retry once
  const heal = async (method, path, body) => {
    let r = await faisal(method, path, body);
    if (r.body?.code === 'DEMO_SESSION_MISSING') {
      const restored = await faisal('POST', '/api/demo/restore', { row: cached });
      assert.equal(restored.status, 200, `restore before ${path}: ${restored.body?.error}`);
      r = await faisal(method, path, body);
    }
    assert.ok(r.status === 200 || r.status === 201, `${method} ${path}: ${r.body?.error}`);
    if (r.body?._row) cached = r.body._row;
    return r;
  };

  const created = await heal('POST', '/api/sessions', { topicId: 'neural-networks', goal: 'Show me how a neural network actually learns' });
  const id = created.body.session.id;
  const run = 'rrnwwr';
  for (const [i, q] of cached.questions.entries()) {
    await forget(id);
    const choice = run[i] === 'n' ? -1 : run[i] === 'r' ? q.correctIndex : (q.correctIndex + 1) % 4;
    await heal('POST', `/api/sessions/${id}/answer`, { questionId: q.id, choice });
  }
  assert.deepEqual([cached.score, cached.zone, cached.depth], [50, 'twilight', 429]);
  await forget(id);
  assert.equal((await heal('GET', `/api/sessions/${id}`)).body.session.status, 'assessment');
  await forget(id);
  const built = await heal('POST', `/api/sessions/${id}/build-lesson`);
  assert.deepEqual(built.body.session.lesson.steps.map((s) => s.block?.type), ['neuron', 'forwardpass', 'loss-surface-3d', 'backprop', 'nn-playground', 'check']);
  await forget(id);
  const lulu = await heal('POST', `/api/sessions/${id}/tutor`, { messages: [{ role: 'user', content: 'Can you explain backprop step by step?' }], stepIndex: 2 });
  assert.equal(lulu.body.updated, 'expanded');
  await forget(id);
  const log = await heal('POST', `/api/sessions/${id}/summary`);
  assert.ok(log.body.summary.headline);
  await forget(id);
  const fb = await heal('POST', `/api/sessions/${id}/feedback`, { rating: 5 });
  assert.equal(fb.body.happy, true);
  assert.equal(cached.status, 'closed');
  assert.equal(cached.lesson.steps.length, 6 + lulu.body.addedCount);
});

test('restore refuses other users\' rows and rows the routes could not run on', async () => {
  const judge = client();
  assert.equal((await judge('POST', '/api/auth/session', { name: 'Judge', email: 'judge@example.com' })).body.user.id, 2);
  const mine = lastRow; // the persona's closed Dive 1 (restored earlier)
  // never someone else's row, in any disguise
  assert.equal((await judge('POST', '/api/demo/restore', { row: mine })).status, 403);
  assert.equal((await judge('POST', '/api/demo/restore', { row: { ...mine, user_id: undefined } })).status, 403);
  assert.equal((await judge('POST', '/api/demo/restore', { row: { ...mine, user_id: '1' } })).status, 403);
  assert.equal((await judge('POST', '/api/demo/restore', { row: { ...mine, user_id: 2 } })).status, 409, 'the id is the persona\'s');
  for (const seededId of Object.values(DEMO_SEED_IDS.sessions)) {
    assert.equal((await judge('POST', '/api/demo/restore', { row: { ...mine, id: seededId, user_id: 2 } })).status, 409, `seeded id ${seededId}`);
  }
  assert.equal((await judge('GET', `/api/sessions/${mine.id}`)).body.session, undefined, 'still not the judge\'s');
  // rows the routes could not run on are refused up front
  const bad = (patch) => faisal('POST', '/api/demo/restore', { row: { ...mine, ...patch } });
  for (const [patch, why] of [
    [{ lesson: '{not json' }, 'unparseable JSON column'],
    [{ lesson: { title: 'x', steps: 'nope' } }, 'lesson without a steps array'],
    [{ lesson: null }, 'a closed dive without its lesson'],
    [{ status: 'assessment', questions: [{ text: 'no id' }] }, 'questions without ids'],
    [{ answered: { not: 'an array' } }, 'answered must be an array'],
    [{ zone: 'abyss' }, 'unknown zone'],
    [{ depth: 'deep' }, 'depth must be an integer'],
    [{ id: 1e20 }, 'id beyond a safe integer'],
    [{ id: 'x' }, 'id not a number'],
    [{ topic_id: 'cooking' }, 'unknown topic'],
  ]) {
    assert.equal((await bad(patch)).status, 400, why);
  }
  // a null in a NOT NULL column falls back to its default instead of failing the insert
  await db.run(`DELETE FROM ${T.feedback} WHERE session_id = ?`, [mine.id]);
  await db.run(`DELETE FROM ${T.learning_sessions} WHERE id = ?`, [mine.id]);
  const r = await bad({ version: null, created_at: null, updated_at: null });
  assert.equal(r.status, 200, r.body?.error);
  const back = (await faisal('GET', `/api/sessions/${mine.id}`)).body.session;
  assert.equal(back.version, 1);
  assert.ok(back.createdAt);
});

test('speed is the replay latency multiplier: each model call waits latency[task] × speed (± jitter)', async () => {
  const prev = process.env.OCEANMIND_DEMO_SPEED;
  try {
    process.env.OCEANMIND_DEMO_SPEED = '2';
    for (const [task, ms] of Object.entries(DEMO_LATENCY_MS)) {
      for (let i = 0; i < 25; i++) {
        const v = replayLatency(task);
        assert.ok(v >= Math.floor(ms * 2 * (1 - DEMO_LATENCY_JITTER)) && v <= Math.ceil(ms * 2 * (1 + DEMO_LATENCY_JITTER)), `${task}: ${v} ms`);
      }
      assert.equal(replayLatency(task, { retry: true }), 0, 'aiJson retries answer instantly');
    }
    process.env.OCEANMIND_DEMO_SPEED = '0';
    assert.equal(replayLatency('lesson'), 0, '0 = instant');
    for (const junk of ['-1', 'fast', '']) {
      process.env.OCEANMIND_DEMO_SPEED = junk;
      assert.equal((await faisal('GET', '/api/demo/status')).body.speed, 1, `"${junk}" falls back to 1`);
    }

    // a real request waits its routeLatency × speed
    process.env.OCEANMIND_DEMO_SPEED = '0.25';
    const status = (await faisal('GET', '/api/demo/status')).body;
    assert.equal(status.speed, 0.25);
    const timed = async (method, path, body, route) => {
      const t0 = performance.now();
      const r = await faisal(method, path, body);
      const took = performance.now() - t0;
      assert.ok(r.status < 300, r.body?.error);
      const budget = status.routeLatency[route] * status.speed;
      assert.ok(took >= budget * (1 - status.jitter) - 5, `${route}: ${Math.round(took)} ms ≥ ${budget} ms − jitter`);
      assert.ok(took <= budget * (1 + status.jitter) + 750, `${route}: ${Math.round(took)} ms ≈ ${budget} ms`);
      return r;
    };
    const dive = await timed('POST', '/api/sessions', { topicId: 'chatbots' }, 'createSession');
    await timed('POST', '/api/topics/match', { text: GOAL }, 'topicMatch');
    await timed('POST', '/api/ai/chat', { system: 'Be brief.', messages: [{ role: 'user', content: 'hello' }] }, 'chat');
    assert.ok(dive.body.session.id);
  } finally {
    process.env.OCEANMIND_DEMO_SPEED = prev;
  }
});

test('reset: every rehearsal starts from the seeded Logbook, Projects and Notifications', async () => {
  const judge = client();
  await judge('POST', '/api/auth/session', { name: 'Judge', email: 'judge@example.com' });
  const judgeDive = (await judge('POST', '/api/sessions', { topicId: 'chatbots' })).body.session.id;
  await judge('POST', '/api/projects', { kind: 'flow', name: 'Judge flow', data: { nodes: [], edges: [] } });

  // the persona leaves traces everywhere: a new name, extra dives and projects, a rebuild report
  await faisal('POST', '/api/auth/session', { name: 'Faisal (rehearsal)', email: DEMO_PERSONA.email });
  const sad = (await faisal('POST', '/api/sessions', { topicId: 'chatbots' })).body;
  for (const q of sad._row.questions) await faisal('POST', `/api/sessions/${sad.session.id}/answer`, { questionId: q.id, choice: -1 });
  await faisal('POST', `/api/sessions/${sad.session.id}/build-lesson`);
  assert.equal((await faisal('POST', `/api/sessions/${sad.session.id}/feedback`, { rating: 2, reasons: ['Too hard'] })).body.happy, false);
  await faisal('POST', '/api/projects', { projectId: DEMO_SEED_IDS.projects.agentFlow, kind: 'flow', name: 'renamed', data: {} });
  assert.notDeepEqual(await historySnapshot(faisal), seedSnapshot);

  const r = await faisal('POST', '/api/demo/reset');
  assert.equal(r.status, 200, r.body?.error);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.userId, 1);
  assert.equal(r.body.seeded, true);
  assert.ok(r.body.wiped.sessions >= 7 && r.body.wiped.projects >= 3 && r.body.wiped.reports >= 2, JSON.stringify(r.body.wiped));
  assert.deepEqual(await historySnapshot(faisal), seedSnapshot, 'identical to a cold start (timestamps aside)');
  const { sessions } = (await faisal('GET', '/api/sessions')).body;
  const days = (ts) => (Date.now() - new Date(`${ts.replace(' ', 'T')}Z`).getTime()) / 86400000;
  assert.ok(Math.abs(days(sessions[0].createdAt) - 5) < 0.5 && Math.abs(days(sessions[1].createdAt) - 12) < 0.5, 'relative timestamps');
  const reports = (await faisal('GET', '/api/support/reports')).body.reports;
  assert.deepEqual(reports.filter((x) => x.userEmail === DEMO_PERSONA.email).map((x) => [x.id, x.status]), [[1, 'resolved']]);

  // the judge's rows survive the persona's reset
  assert.equal((await judge('GET', `/api/sessions/${judgeDive}`)).status, 200);
  const next = (await faisal('POST', '/api/sessions', { topicId: 'ai-agents', goal: GOAL })).body.session.id;
  assert.equal(next, judgeDive + 1, 'live ids continue after every row still on the instance');

  // the judge's reset wipes only the judge (no seeded history for anyone else)
  const j = await judge('POST', '/api/demo/reset');
  assert.deepEqual([j.body.userId, j.body.seeded, j.body.wiped.sessions, j.body.wiped.projects], [2, false, 1, 1]);
  assert.deepEqual((await judge('GET', '/api/sessions')).body.sessions, []);
  assert.deepEqual((await judge('GET', '/api/projects')).body.projects, []);
  assert.deepEqual((await faisal('GET', '/api/sessions')).body.sessions.map((s) => s.id), [next, 3, 2, 1]);

  // signed out means the persona (the director may press r r on the sign-in screen)
  const anon = await client()('POST', '/api/demo/reset');
  assert.deepEqual([anon.status, anon.body.userId, anon.body.seeded], [200, 1, true]);
  assert.deepEqual(await historySnapshot(faisal), seedSnapshot);

  // with the instance back to its seed, the first live rows number exactly as after a cold start
  const first = (await faisal('POST', '/api/sessions', { topicId: 'ai-agents', goal: GOAL })).body;
  assert.equal(first.session.id, DEMO_SEED_MAX_IDS.om_learning_sessions + 1);
  assert.equal((await faisal('POST', '/api/projects', { kind: 'flow', name: 'x', data: {} })).body.projectId, DEMO_SEED_MAX_IDS.om_projects + 1);

  // outside demo mode there is no reset
  process.env.OCEANMIND_DEMO = '0';
  try {
    assert.equal((await faisal('POST', '/api/demo/reset')).status, 404);
  } finally {
    process.env.OCEANMIND_DEMO = '1';
  }
});

test('demoNextId: never a seeded id; sequential locally, time-based on serverless', async () => {
  const fake = (maxId) => ({ get: async () => ({ maxId }) });
  const S = T.learning_sessions;
  assert.equal(await demoNextId(fake(null), S), DEMO_SEED_MAX_IDS[S] + 1, 'an instance whose seed failed still skips the seeded ids');
  assert.equal(await demoNextId(fake(1), T.projects), DEMO_SEED_MAX_IDS[T.projects] + 1);
  assert.equal(await demoNextId(fake(3), S), 4);
  assert.equal(await demoNextId(fake(40), S), 41);
  for (const [table, max] of Object.entries(DEMO_SEED_MAX_IDS)) assert.ok((await demoNextId(fake(0), table)) > max, table);
  process.env.OCEANMIND_DEMO_UNIQUE_IDS = '1';
  try {
    const ids = [];
    for (let i = 0; i < 200; i++) ids.push(await demoNextId(fake(null), S));
    assert.ok(ids.every((id) => Number.isSafeInteger(id) && id > 100_000), 'time-based');
    assert.ok(new Set(ids).size > 50, 'a random tail spreads same-second picks');
    assert.equal(await demoNextId(fake(9_000_000_000_000), S), 9_000_000_000_001, 'never below max + 1');
  } finally {
    delete process.env.OCEANMIND_DEMO_UNIQUE_IDS;
  }
});

test('cold start: a fresh process (another serverless instance) accepts the same cookie and shows the seeded history', async () => {
  const { cookie } = await faisal('GET', '/api/auth/me');
  assert.ok(cookie, 'the persona cookie');
  const row = lastRow; // Dive 1 as the client cached it (this instance has since been reset)
  const script = `
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const { cookie, row } = JSON.parse(raw);
    const { createApp } = await import(${JSON.stringify(new URL('../app.js', import.meta.url).href)});
    const server = createApp().listen(0);
    await new Promise((ok) => server.once('listening', ok));
    const base = 'http://127.0.0.1:' + server.address().port;
    const call = async (method, path, body, withCookie = true) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const out = {};
    out.me = await call('GET', '/api/auth/me');
    out.sessions = (await call('GET', '/api/sessions')).body;
    out.projects = (await call('GET', '/api/projects')).body;
    out.notifications = (await call('GET', '/api/notifications')).body;
    out.seeded = [];
    for (const s of out.sessions.sessions) out.seeded.push((await call('GET', '/api/sessions/' + s.id)).body);
    out.missing = await call('GET', '/api/sessions/' + row.id);
    out.restore = await call('POST', '/api/demo/restore', { row });
    const back = await call('GET', '/api/sessions/' + row.id);
    out.back = { status: back.status, steps: back.body?.session?.lesson?.steps?.length, goal: back.body?.session?.goal };
    out.logbook = (await call('GET', '/api/sessions')).body.sessions.map((s) => s.id);
    out.created = [];
    for (const topicId of ['neural-networks', 'chatbots', 'ai-agents']) out.created.push((await call('POST', '/api/sessions', { topicId })).body.session.id);
    out.projectId = (await call('POST', '/api/projects', { kind: 'flow', name: 'x', data: {} })).body.projectId;
    out.judge = (await call('POST', '/api/auth/session', { name: 'Judge', email: 'judge@example.com' }, false)).body.user.id;
    server.close();
    console.log(JSON.stringify(out));
  `;
  const env = { ...process.env, OCEANMIND_DEMO: '1', OCEANMIND_DEMO_SPEED: '0', OCEANMIND_DEMO_UNIQUE_IDS: '1' };
  for (const k of ['COOKIE_SECRET', 'DATABASE_URL', 'OCEANMIND_TEST_AI', 'VERCEL']) delete env[k];
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env, cwd: HERE });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.end(JSON.stringify({ cookie, row }));
  const code = await new Promise((ok) => child.on('close', ok));
  assert.equal(code, 0, stderr);
  const out = JSON.parse(stdout.trim().split('\n').pop());

  assert.equal(out.me.status, 200, 'the cookie from this process verifies in the fresh one');
  assert.deepEqual(out.me.body.user, { id: 1, ...DEMO_PERSONA });
  assert.deepEqual(stripTimes(out.sessions.sessions), seedSnapshot.sessions, 'Logbook: the seeded history');
  assert.deepEqual(stripTimes(out.seeded), seedSnapshot.details, 'every seeded dive, identical');
  assert.deepEqual(stripTimes(out.projects.projects), seedSnapshot.projects, 'Projects: the seeded builds');
  assert.deepEqual(stripTimes(out.notifications.notifications), seedSnapshot.notifications, 'Notifications: the read rebuild email');

  // a live dive from the other instance heals through its _row
  assert.deepEqual([out.missing.status, out.missing.body.code], [404, 'DEMO_SESSION_MISSING']);
  assert.deepEqual(out.restore.body, { ok: true, restored: row.id, replaced: false });
  assert.deepEqual(out.back, { status: 200, steps: row.lesson.steps.length, goal: row.goal });
  assert.deepEqual(out.logbook, [row.id, 3, 2, 1]);

  // serverless ids: time-based, above the seed and the restored row, increasing, never a seeded id
  assert.ok(out.created.every((id) => id > 100_000 && id > row.id), JSON.stringify(out.created));
  assert.ok(out.created[0] < out.created[1] && out.created[1] < out.created[2]);
  assert.ok(out.projectId > 100_000);
  assert.ok(out.judge > 100_000, 'another person on that instance never gets user id 2 (a cookie from elsewhere cannot name them)');
});

test('stop the app', () => {
  server.close();
});

test('normal mode is untouched: no demo routes, no _row, sequential ids, the support rebuild still writes its rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'om-normal-'));
  const script = `
    const { createApp } = await import(${JSON.stringify(new URL('../app.js', import.meta.url).href)});
    const server = createApp().listen(0);
    await new Promise((ok) => server.once('listening', ok));
    const base = 'http://127.0.0.1:' + server.address().port;
    let cookie = null;
    const call = async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const out = {};
    out.status = (await call('GET', '/api/demo/status')).body;
    out.resetSignedOut = (await call('POST', '/api/demo/reset')).status;
    out.user = (await call('POST', '/api/auth/session', { name: 'Ada', email: 'ada@example.com' })).body.user;
    out.resetSignedIn = (await call('POST', '/api/demo/reset')).status;
    out.restore = (await call('POST', '/api/demo/restore', { row: { id: 9 } })).status;
    const created = await call('POST', '/api/sessions', { topicId: 'chatbots', goal: '  a bot for my bakery  ' });
    out.created = { status: created.status, id: created.body.session.id, goal: created.body.session.goal, hasRow: '_row' in created.body };
    const id = created.body.session.id;
    for (const q of created.body.session.questions) await call('POST', '/api/sessions/' + id + '/answer', { questionId: q.id, choice: 1 });
    const built = await call('POST', '/api/sessions/' + id + '/build-lesson');
    out.built = { status: built.status, hasRow: '_row' in built.body, steps: built.body.session.lesson.steps.length };
    out.missing = (await call('GET', '/api/sessions/99999')).body;
    out.badId = (await call('GET', '/api/sessions/abc')).status;
    out.unknownApi = (await call('GET', '/api/nope')).body;
    out.feedback = (await call('POST', '/api/sessions/' + id + '/feedback', { rating: 2, reasons: ['Too easy'] })).body;
    const reports = (await call('GET', '/api/support/reports')).body.reports;
    out.reports = reports.map((r) => [r.id, r.status, r.sessionId]);
    out.resolve = (await call('POST', '/api/support/reports/' + reports[0].id + '/resolve', { zone: 'twilight', note: 'Deeper please' })).body;
    out.notifications = (await call('GET', '/api/notifications')).body.notifications.map((n) => [n.id, n.sessionId, n.read]);
    out.rebuilt = (await call('GET', '/api/sessions/' + out.resolve.newSessionId)).body.session;
    out.rebuilt = { version: out.rebuilt.version, goal: out.rebuilt.goal, status: out.rebuilt.status };
    out.project = await call('POST', '/api/projects', { kind: 'flow', name: 'Mine', data: { nodes: [], edges: [] } });
    out.projectMissing = (await call('POST', '/api/projects', { projectId: 987, kind: 'flow', name: 'x', data: {} })).status;
    server.close();
    console.log(JSON.stringify(out));
  `;
  const env = { ...process.env, OCEANMIND_TEST_AI: '1', OCEANMIND_DB_FILE: join(dir, 'normal.db') };
  for (const k of ['OCEANMIND_DEMO', 'OCEANMIND_DEMO_SPEED', 'OCEANMIND_DEMO_UNIQUE_IDS', 'DATABASE_URL', 'VERCEL']) delete env[k];
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env, cwd: HERE });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((ok) => child.on('close', ok));
  rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 0, stderr);
  const out = JSON.parse(stdout.trim().split('\n').pop());

  assert.deepEqual(out.status, { demo: false });
  assert.deepEqual([out.resetSignedOut, out.resetSignedIn, out.restore], [404, 404, 404], 'no demo routes outside demo mode');
  assert.deepEqual(out.user, { id: 1, name: 'Ada', email: 'ada@example.com' }, 'ids start at 1: nothing is seeded');
  assert.deepEqual(out.created, { status: 201, id: 1, goal: 'a bot for my bakery', hasRow: false });
  assert.deepEqual(out.built, { status: 200, hasRow: false, steps: out.built.steps });
  assert.deepEqual(out.missing, { error: 'Session not found.' }, 'a plain 404, no demo code');
  assert.equal(out.badId, 404);
  assert.deepEqual(out.unknownApi, { error: 'Not found.' });
  assert.deepEqual(out.feedback, { happy: false });
  assert.deepEqual(out.reports, [[1, 'new', 1]]);
  assert.deepEqual(out.resolve, { ok: true, newSessionId: 2 });
  assert.deepEqual(out.notifications, [[1, 2, false]]);
  assert.deepEqual(out.rebuilt, { version: 2, goal: 'a bot for my bakery', status: 'lesson' });
  assert.deepEqual([out.project.status, out.project.body.projectId], [201, 1]);
  assert.equal(out.projectMissing, 404, 'saving over an unknown project is still a 404 outside demo mode');
});

test('goal column migration: an existing SQLite DB without it gets the column (normal mode)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'om-migrate-'));
  const file = join(dir, 'old.db');
  const script = `
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(process.env.OCEANMIND_DB_FILE);
    old.exec("CREATE TABLE om_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    old.exec("CREATE TABLE om_learning_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, topic_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'assessment', score REAL, depth INTEGER, zone TEXT, assessment_answers TEXT, concept_scores TEXT, knowledge_map TEXT, questions TEXT, answered TEXT, lesson TEXT, summary TEXT, rebuilt_from INTEGER, support_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    old.exec("INSERT INTO om_users (name, email) VALUES ('A', 'a@b.co'); INSERT INTO om_learning_sessions (user_id, topic_id) VALUES (1, 'chatbots')");
    old.close();
    const { db } = await import(${JSON.stringify(new URL('../db.js', import.meta.url).href)});
    const cols = (await db.all("PRAGMA table_info(om_learning_sessions)")).map((c) => c.name);
    const row = await db.get("SELECT id, goal FROM om_learning_sessions");
    console.log(JSON.stringify({ driver: db.driver, hasGoal: cols.includes('goal'), row }));
  `;
  const env = { ...process.env, OCEANMIND_DB_FILE: file };
  delete env.OCEANMIND_DEMO;
  delete env.DATABASE_URL;
  const out = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env, cwd: HERE, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop()), { driver: 'sqlite', hasGoal: true, row: { id: 1, goal: null } });
});
