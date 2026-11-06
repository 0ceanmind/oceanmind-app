import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, T, demoReset } from './db.js';
import { setUserCookie, clearUserCookie, getUser, requireUser } from './auth.js';
import { TOPICS, ZONES, getTopic } from './content/topics.js';
import { BLOCK_CATALOG } from './content/blockCatalog.js';
import { zoneForScore, depthForScore, midZoneDepth } from './lib/scoring.js';
import { matchTopic } from './lib/topicMatch.js';
import { aiIsConfigured, maskedConfig, setAiConfig, testConfig, aiChat, aiJson, PROVIDERS } from './ai.js';
import { compileKnowledgeMap, generateQuestions, generateLesson, generateSummary, aiTopicMatch, tutorDecide, generateExpansionSteps } from './lib/generate.js';
import { AGENT_TOOLS, runTool } from './lib/agentTools.js';
import { runFlow, validateFlow } from './lib/flowRun.js';
import { rebuildEmailHtml } from './emailTemplate.js';
import { isDemoMode, DEMO_PERSONA, DEMO_USER_ID, DEMO_SEED_MAX_IDS, REPLAY_PROVIDER, demoSpeed, demoStatus, demoNextId } from './demo/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const FEEDBACK_REASONS = ['Too easy', 'Too hard', 'Repetitive', 'Wrong topic', 'Wasn’t helpful'];

// ---------------------------------------------------------------- helpers

/** A path/body id that can name a row: a positive safe integer, else null. */
function rowId(v) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function sessionRow(id) {
  if (!rowId(id)) return undefined; // 'abc', 1e20, -1 … are never a session (and never reach the driver)
  return db.get(
    `SELECT s.*, u.name AS user_name, u.email AS user_email
     FROM ${T.learning_sessions} s JOIN ${T.users} u ON u.id = s.user_id
     WHERE s.id = ?`,
    [id]
  );
}

const parse = (v, fallback) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

/** Serialize a session for its owner, shaped by status. */
async function sessionForLearner(s) {
  const topic = getTopic(s.topic_id);
  const answered = parse(s.answered, []);
  const out = {
    id: s.id, topicId: s.topic_id, topicTitle: topic.title, topicIcon: topic.icon,
    version: s.version, status: s.status, zone: s.zone, depth: s.depth, score: s.score,
    rebuiltFrom: s.rebuilt_from, supportNote: s.support_note, createdAt: s.created_at,
    knowledgeMap: parse(s.knowledge_map, null), zones: ZONES, goal: s.goal ?? null,
  };
  if (s.status === 'assessment') {
    const questions = parse(s.questions, []);
    out.questions = questions.map((q) => ({ id: q.id, concept: q.concept, text: q.text, options: q.options }));
    out.answered = answered.map((a) => ({
      questionId: a.questionId, choice: a.choice, correct: a.correct,
      correctIndex: a.correctIndex, explanation: a.explanation,
    }));
  } else if (s.status !== 'compiling') {
    out.lesson = parse(s.lesson, null);
    out.summary = parse(s.summary, null);
    out.answered = answered.map((a) => ({ concept: a.concept, correct: a.correct, noIdea: a.noIdea }));
    out.widget = topic.widget;
    out.widgetConfig = s.zone ? topic.widgetConfig[s.zone] : null;
    const fb = await db.get(`SELECT rating, reasons, note FROM ${T.feedback} WHERE session_id = ? ORDER BY id DESC`, [s.id]);
    if (fb) out.feedback = { rating: fb.rating, reasons: parse(fb.reasons, []), note: fb.note };
  }
  return out;
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function requireAi(_req, res, next) {
  try {
    if (!(await aiIsConfigured())) {
      return res.status(503).json({ error: 'No AI model is connected yet. Open Admin → Model and add an API key.', code: 'AI_NOT_CONFIGURED' });
    }
    next();
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------- demo mode helpers

// Serverless self-healing: each instance holds its own in-memory DB, so session
// responses carry the raw row (`_row`) and the client can put it back on an
// instance that never saw it (POST /api/demo/restore).
const SESSION_JSON_COLS = ['knowledge_map', 'questions', 'answered', 'lesson', 'summary', 'assessment_answers', 'concept_scores'];
const SESSION_RESTORE_COLS = ['user_id', 'topic_id', 'version', 'status', 'score', 'depth', 'zone', 'rebuilt_from', 'support_note', 'goal',
  'created_at', 'updated_at', ...SESSION_JSON_COLS];
const SESSION_STATUSES = ['assessment', 'compiling', 'lesson', 'closed', 'awaiting_rebuild'];
const SESSION_NOT_NULL = ['user_id', 'topic_id', 'version', 'status', 'created_at', 'updated_at'];

/**
 * INSERT returning { id }. In demo mode the id is always pinned (demoNextId):
 * above every seeded id, so a re-seed can never collide with a live row, and
 * time-based on serverless, so two instances don't hand out the same id.
 */
async function insertRow(table, cols, values) {
  const pinned = isDemoMode();
  const allCols = pinned ? ['id', ...cols] : cols;
  const allValues = pinned ? [await demoNextId(db, table), ...values] : values;
  return db.insert(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`, allValues);
}

/** The om_learning_sessions row as stored, with its JSON columns parsed (answer keys included). */
async function rawSessionRow(id) {
  const row = await db.get(`SELECT * FROM ${T.learning_sessions} WHERE id = ?`, [id]);
  if (!row) return null;
  const out = { ...row };
  for (const k of SESSION_JSON_COLS) out[k] = parse(row[k], null);
  return out;
}

const missingSession = (res) => res.status(404).json({ error: 'Session not found.', code: 'DEMO_SESSION_MISSING' });

/**
 * Demo only, mounted on /api/sessions:
 *  - /api/sessions/:id[/*] for a signed-in caller whose id this instance has
 *    never seen answers 404 DEMO_SESSION_MISSING before any route runs, so every
 *    route (answer, build-lesson, tutor, summary, feedback, GET …) heals the
 *    same way whatever it validates first. Signed-out callers fall through to
 *    the route's 401.
 *  - success bodies get `_row` (read after the handler's writes), and a 404 for
 *    a row that vanished mid-request gets the code too. A session that exists
 *    but belongs to someone else stays a plain 404.
 * Normal mode passes straight through.
 */
async function demoSessionRows(req, res, next) {
  if (!isDemoMode()) return next();
  const rawId = /^\/(\d+)(?:\/|$)/.exec(req.path)?.[1];
  const pathId = rawId ? rowId(rawId) : null;
  try {
    if (pathId && (await getUser(req)) && !(await db.get(`SELECT id FROM ${T.learning_sessions} WHERE id = ?`, [pathId]))) {
      return missingSession(res);
    }
  } catch (e) {
    return next(e);
  }
  const send = res.json.bind(res);
  res.json = (body) => {
    const id = pathId ?? (rowId(body?.session?.id));
    if (!id || !body || typeof body !== 'object' || Array.isArray(body)) return send(body);
    (async () => {
      if (res.statusCode === 404) {
        if (!pathId || body.code) return send(body);
        const exists = await db.get(`SELECT id FROM ${T.learning_sessions} WHERE id = ?`, [id]);
        return send(exists ? body : { ...body, code: 'DEMO_SESSION_MISSING' });
      }
      if (res.statusCode >= 400) return send(body);
      const row = await rawSessionRow(id);
      return send(row ? { ...body, _row: row } : body);
    })().catch(() => send(body));
    return res;
  };
  next();
}

/** A restored JSON column: parsed objects pass through, strings are parsed (INVALID_JSON when they don't parse). */
const INVALID_JSON = Symbol('invalid json');
const parseColumn = (v) => {
  if (v === undefined || v === null || typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return INVALID_JSON; }
};

/** The JSON shape each session column must have for the routes to run on a restored row. */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const RESTORE_SHAPES = {
  knowledge_map: isObj,
  questions: (v) => Array.isArray(v) && v.every((q) => isObj(q) && typeof q.id === 'string' && Array.isArray(q.options)),
  answered: (v) => Array.isArray(v) && v.every(isObj),
  lesson: (v) => isObj(v) && Array.isArray(v.steps) && v.steps.every(isObj),
  summary: isObj,
  assessment_answers: () => true,
  concept_scores: () => true,
};

/**
 * Check a `_row` before it is written back: JSON columns must parse into the
 * shapes the routes read, and the columns the row's status relies on must be
 * there. Returns an error message, or null. `values` are the parsed columns.
 */
function restoreProblem(row, values) {
  for (const c of SESSION_JSON_COLS) {
    if (values[c] === undefined || values[c] === null) continue;
    if (values[c] === INVALID_JSON) return `Column ${c} is not valid JSON.`;
    if (!RESTORE_SHAPES[c](values[c])) return `Column ${c} has the wrong shape.`;
  }
  for (const c of ['version', 'depth']) {
    if (row[c] != null && !Number.isSafeInteger(Number(row[c]))) return `Column ${c} must be an integer.`;
  }
  if (row.score != null && !Number.isFinite(Number(row.score))) return 'Column score must be a number.';
  if (row.zone != null && !ZONES[row.zone]) return 'Unknown zone.';
  if (row.status === 'assessment' && !values.questions) return 'An assessment needs its questions.';
  if (['lesson', 'closed', 'awaiting_rebuild'].includes(row.status) && !values.lesson) return 'A finished dive needs its lesson.';
  return null;
}

// ---------------------------------------------------------------- app

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // ----- auth -----

  app.post('/api/auth/session', asyncRoute(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (name.length < 1 || name.length > 80) return res.status(400).json({ error: 'Please tell us your name (max 80 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That doesn’t look like a valid email address.' });
    let user = await db.get(`SELECT id, name, email FROM ${T.users} WHERE email = ?`, [email]);
    if (user) {
      if (user.name !== name) {
        await db.run(`UPDATE ${T.users} SET name = ? WHERE id = ?`, [name, user.id]);
        user = { ...user, name };
      }
    } else {
      // demo on serverless: a unique id, so a cookie minted on one instance never names another person on the next
      const r = await insertRow(T.users, ['name', 'email'], [name, email]);
      user = { id: r.id, name, email };
    }
    await setUserCookie(res, user.id);
    res.json({ user });
  }));

  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user });
  }));

  app.post('/api/auth/logout', (_req, res) => {
    clearUserCookie(res);
    res.json({ ok: true });
  });

  // ----- pitch demo -----

  /**
   * Demo: `speed` is the replay latency multiplier (OCEANMIND_DEMO_SPEED): each
   * scripted model reply waits latency[task] × speed ms (± jitter), so a request
   * waits about routeLatency[route] × speed. 0 = instant. Tables are ms at speed 1.
   */
  app.get('/api/demo/status', (_req, res) => {
    if (!isDemoMode()) return res.json({ demo: false });
    res.json(demoStatus());
  });

  /**
   * Demo only: start a rehearsal from the seeded state. Wipes every row the
   * caller created on this instance; for the persona (or a signed-out caller,
   * which means the persona) the deterministic history is written back, so the
   * Logbook, Projects and Notifications read exactly as after a cold start.
   * Other users just get a clean slate. Only this instance is reset.
   */
  app.post('/api/demo/reset', asyncRoute(async (req, res) => {
    if (!isDemoMode()) return res.status(404).json({ error: 'Not found.' });
    const user = await getUser(req);
    const result = await demoReset(user?.id ?? DEMO_USER_ID);
    res.json({ ok: true, ...result });
  }));

  /** Demo only: put a session row back on an instance that never saw it (same id, whitelisted columns). */
  app.post('/api/demo/restore', requireUser, asyncRoute(async (req, res) => {
    if (!isDemoMode()) return res.status(404).json({ error: 'Not found.' });
    const row = req.body?.row;
    const id = rowId(row?.id);
    if (!isObj(row) || !id) return res.status(400).json({ error: 'Nothing to restore.' });
    // only ever the caller's own rows: the row must name the caller, and the id must be free or already theirs
    if (rowId(row.user_id) !== req.user.id) return res.status(403).json({ error: 'That session belongs to someone else.' });
    if (!getTopic(String(row.topic_id))) return res.status(400).json({ error: 'Unknown topic.' });
    if (!SESSION_STATUSES.includes(row.status)) return res.status(400).json({ error: 'Unknown session status.' });
    const parsed = Object.fromEntries(SESSION_JSON_COLS.map((c) => [c, parseColumn(row[c])]));
    const problem = restoreProblem(row, parsed);
    if (problem) return res.status(400).json({ error: problem });
    const existing = await db.get(`SELECT user_id FROM ${T.learning_sessions} WHERE id = ?`, [id]);
    // seeded ids belong to the persona, even on an instance whose seed is missing (a re-seed must never collide)
    const seeded = id <= DEMO_SEED_MAX_IDS[T.learning_sessions] && req.user.id !== DEMO_USER_ID;
    if ((existing && existing.user_id !== req.user.id) || seeded) return res.status(409).json({ error: 'That session id is taken.' });
    // a null in a NOT NULL column falls back to its default (insert) or keeps the stored value (replace)
    const cols = SESSION_RESTORE_COLS.filter((c) => row[c] !== undefined && !(row[c] === null && SESSION_NOT_NULL.includes(c)));
    const values = cols.map((c) => {
      const v = row[c];
      if (c === 'user_id') return req.user.id;
      if (SESSION_JSON_COLS.includes(c)) return v === null || typeof v === 'string' ? v : JSON.stringify(v);
      return v === null || typeof v === 'number' || typeof v === 'string' ? v : String(v);
    });
    if (existing) {
      await db.run(`UPDATE ${T.learning_sessions} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
    } else {
      await db.run(
        `INSERT INTO ${T.learning_sessions} (id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
        [id, ...values]
      );
    }
    res.json({ ok: true, restored: id, replaced: Boolean(existing) });
  }));

  // ----- AI status + admin config -----

  app.get('/api/ai/status', asyncRoute(async (_req, res) => {
    const cfg = await maskedConfig();
    res.json({ configured: Boolean(cfg), provider: cfg?.provider ?? null, model: cfg?.model ?? null });
  }));

  app.get('/api/admin/config', asyncRoute(async (_req, res) => {
    // demo: list the active replay provider too, so the admin page can render it
    const providers = isDemoMode() ? { ...PROVIDERS, replay: REPLAY_PROVIDER } : PROVIDERS;
    res.json({ config: await maskedConfig(), providers });
  }));

  app.post('/api/admin/test', asyncRoute(async (req, res) => {
    const { provider, apiKey, model } = req.body ?? {};
    const result = await testConfig({ provider, apiKey, model: model || PROVIDERS[provider]?.defaultModel });
    res.json(result);
  }));

  app.get('/api/admin/library', (_req, res) => {
    res.json({ blocks: BLOCK_CATALOG, topics: TOPICS.map((t) => ({ id: t.id, title: t.title })) });
  });

  app.post('/api/admin/config', asyncRoute(async (req, res) => {
    const { provider, apiKey, model } = req.body ?? {};
    const cfg = await setAiConfig({ provider, apiKey, model });
    res.json({ ok: true, config: { provider: cfg.provider, model: cfg.model } });
  }));

  // ----- topics -----

  app.get('/api/topics', (_req, res) => {
    res.json({
      topics: TOPICS.map((t) => ({ id: t.id, title: t.title, icon: t.icon, tagline: t.tagline })),
      zones: ZONES,
    });
  });

  app.post('/api/topics/match', requireUser, asyncRoute(async (req, res) => {
    const text = String(req.body?.text ?? '').trim().slice(0, 300);
    if (!text) return res.status(400).json({ error: 'Tell us what you’d like to learn.' });
    let topicId = matchTopic(text);
    if (!topicId && (await aiIsConfigured())) {
      try { topicId = await aiTopicMatch(text, TOPICS); } catch { /* keyword fallback */ }
    }
    const topic = topicId ? getTopic(topicId) : null;
    res.json({ match: topic ? { id: topic.id, title: topic.title, tagline: topic.tagline } : null });
  }));

  // ----- learning sessions -----

  app.use('/api/sessions', demoSessionRows);

  app.post('/api/sessions', requireUser, requireAi, asyncRoute(async (req, res) => {
    const topic = getTopic(String(req.body?.topicId ?? ''));
    if (!topic) return res.status(400).json({ error: 'Unknown topic.' });
    // the learner's own words from the home screen, kept for the lesson and the dive log
    const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim().slice(0, 300) : '';
    const knowledgeMap = await compileKnowledgeMap(topic);
    const questions = await generateQuestions(topic, knowledgeMap);
    const r = await insertRow(T.learning_sessions,
      ['user_id', 'topic_id', 'status', 'knowledge_map', 'questions', 'answered', 'goal'],
      [req.user.id, topic.id, 'assessment', JSON.stringify(knowledgeMap), JSON.stringify(questions), '[]', goal || null]
    );
    res.status(201).json({ session: await sessionForLearner(await sessionRow(r.id)) });
  }));

  app.get('/api/sessions', requireUser, asyncRoute(async (req, res) => {
    const rows = await db.all(
      `SELECT s.*, u.name AS user_name, u.email AS user_email
       FROM ${T.learning_sessions} s JOIN ${T.users} u ON u.id = s.user_id
       WHERE s.user_id = ? ORDER BY s.id DESC`,
      [req.user.id]
    );
    res.json({
      sessions: rows.map((s) => {
        const t = getTopic(s.topic_id);
        return {
          id: s.id, topicId: s.topic_id, topicTitle: t.title, topicIcon: t.icon,
          version: s.version, status: s.status, zone: s.zone, depth: s.depth, createdAt: s.created_at,
        };
      }),
    });
  }));

  app.get('/api/sessions/:id', requireUser, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    res.json({ session: await sessionForLearner(s) });
  }));

  app.post('/api/sessions/:id/answer', requireUser, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    if (s.status !== 'assessment') return res.status(409).json({ error: 'This session’s assessment is already complete.' });

    const questions = parse(s.questions, []);
    const answered = parse(s.answered, []);
    const q = questions.find((x) => x.id === String(req.body?.questionId ?? ''));
    if (!q) return res.status(400).json({ error: 'Unknown question.' });
    if (answered.some((a) => a.questionId === q.id)) {
      return res.status(409).json({ error: 'You already answered that one — no take-backs on a placement quiz 🙂' });
    }
    const choice = req.body?.choice;
    const noIdea = choice === -1;
    if (!noIdea && (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length)) {
      return res.status(400).json({ error: 'Invalid choice.' });
    }
    const correct = !noIdea && choice === q.correctIndex;
    answered.push({
      questionId: q.id, concept: q.concept, text: q.text, choice, noIdea, correct,
      chosenText: noIdea ? 'I don’t have any idea' : q.options[choice],
      correctText: q.options[q.correctIndex], correctIndex: q.correctIndex, explanation: q.explanation,
    });

    const done = answered.length === questions.length;
    let summary = null;
    if (done) {
      const scorePct = Math.round((answered.filter((a) => a.correct).length / questions.length) * 100);
      const zone = zoneForScore(scorePct);
      const depth = depthForScore(scorePct);
      await db.run(
        `UPDATE ${T.learning_sessions} SET answered = ?, score = ?, zone = ?, depth = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(answered), scorePct, zone, depth, s.id]
      );
      summary = { scorePct, zone, depth };
    } else {
      await db.run(`UPDATE ${T.learning_sessions} SET answered = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(answered), s.id]);
    }
    res.json({ correct, correctIndex: q.correctIndex, explanation: q.explanation, answeredCount: answered.length, total: questions.length, done, summary });
  }));

  app.post('/api/sessions/:id/build-lesson', requireUser, requireAi, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    if (s.status === 'lesson') return res.json({ session: await sessionForLearner(s) });
    if (s.status !== 'assessment') return res.status(409).json({ error: 'This session can’t build a lesson right now.' });
    const questions = parse(s.questions, []);
    const answered = parse(s.answered, []);
    if (answered.length !== questions.length) return res.status(409).json({ error: 'Finish the depth check first — some questions are unanswered.' });
    const topic = getTopic(s.topic_id);
    const lesson = await generateLesson(topic, { zone: s.zone, scorePct: s.score, answered, knowledgeMap: parse(s.knowledge_map, null), userGoal: s.goal || undefined });
    await db.run(`UPDATE ${T.learning_sessions} SET lesson = ?, status = 'lesson', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(lesson), s.id]);
    res.json({ session: await sessionForLearner(await sessionRow(s.id)) });
  }));

  app.post('/api/sessions/:id/tutor', requireUser, requireAi, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
    if (messages.length === 0) return res.status(400).json({ error: 'Ask something first.' });
    for (const m of messages) {
      if (!['user', 'assistant'].includes(m?.role) || typeof m?.content !== 'string') return res.status(400).json({ error: 'Invalid message format.' });
      m.content = m.content.slice(0, 2000);
    }
    const topic = getTopic(s.topic_id);
    const lesson = parse(s.lesson, null);
    const stepIndex = Number.isInteger(req.body?.stepIndex) ? Math.max(0, req.body.stepIndex) : 0;
    if (!lesson) return res.status(409).json({ error: 'The guide is available once your lesson is built.' });

    const decision = await tutorDecide(topic, lesson, stepIndex, messages);

    if (decision.action === 'expand') {
      const newSteps = await generateExpansionSteps(topic, s.zone, decision.about, lesson, stepIndex, { goal: s.goal || null });
      lesson.steps.splice(stepIndex + 1, 0, ...newSteps);
      await db.run(`UPDATE ${T.learning_sessions} SET lesson = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(lesson), s.id]);
      return res.json({ text: decision.reply, updated: 'expanded', addedCount: newSteps.length, session: await sessionForLearner(await sessionRow(s.id)) });
    }
    if (decision.action === 'redesign') {
      // the redesign keeps its own (freshly stated) goal rather than the stored one
      const rebuilt = await generateLesson(topic, { zone: s.zone, scorePct: s.score, answered: parse(s.answered, []), knowledgeMap: parse(s.knowledge_map, null), userGoal: decision.goal, redesign: true });
      await db.run(`UPDATE ${T.learning_sessions} SET lesson = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(rebuilt), s.id]);
      return res.json({ text: decision.reply, updated: 'redesigned', session: await sessionForLearner(await sessionRow(s.id)) });
    }
    res.json({ text: decision.reply, updated: null });
  }));

  app.post('/api/sessions/:id/summary', requireUser, requireAi, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    if (s.status !== 'lesson' && s.status !== 'closed') return res.status(409).json({ error: 'The dive log is written once the lesson is finished.' });
    const existing = parse(s.summary, null);
    if (existing) return res.json({ summary: existing });
    const summary = await generateSummary(getTopic(s.topic_id), { zone: s.zone, scorePct: s.score, answered: parse(s.answered, []), lesson: parse(s.lesson, null), goal: s.goal || null });
    await db.run(`UPDATE ${T.learning_sessions} SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(summary), s.id]);
    res.json({ summary });
  }));

  app.post('/api/sessions/:id/feedback', requireUser, asyncRoute(async (req, res) => {
    const s = await sessionRow(Number(req.params.id));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found.' });
    if (s.status !== 'lesson') return res.status(409).json({ error: 'Feedback can only be given after the lesson.' });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    const happy = rating >= 4;
    let reasons = [];
    let note = '';
    if (!happy) {
      reasons = Array.isArray(req.body?.reasons) ? req.body.reasons.filter((r) => FEEDBACK_REASONS.includes(r)) : [];
      note = String(req.body?.note ?? '').trim().slice(0, 2000);
      if (reasons.length === 0 && !note) return res.status(400).json({ error: 'Please pick a reason or tell us what went wrong, so we can fix it.' });
    }
    const fb = await insertRow(T.feedback, ['session_id', 'rating', 'reasons', 'note'], [s.id, rating, JSON.stringify(reasons), note]);
    if (happy) {
      await db.run(`UPDATE ${T.learning_sessions} SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [s.id]);
      return res.json({ happy: true });
    }
    await db.run(`UPDATE ${T.learning_sessions} SET status = 'awaiting_rebuild', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [s.id]);
    await insertRow(T.reports, ['session_id', 'feedback_id'], [s.id, fb.id]);
    res.json({ happy: false });
  }));

  // ----- live agent widget -----

  app.post('/api/agent/step', requireUser, requireAi, asyncRoute(async (req, res) => {
    const topic = getTopic(String(req.body?.topicId ?? '')) ?? getTopic('ai-agents');
    const goal = String(req.body?.goal ?? '').trim().slice(0, 300);
    if (!goal) return res.status(400).json({ error: 'The agent needs a goal.' });
    const toolIds = (Array.isArray(req.body?.tools) ? req.body.tools : []).filter((t) => AGENT_TOOLS[t]);
    if (toolIds.length === 0) return res.status(400).json({ error: 'Pick at least one tool for the agent.' });
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-20);
    const notes = history.filter((h) => h.observation?.startsWith('Saved note')).map((h) => h.observation);
    const toolDocs = toolIds.map((t) => `- "${t}": ${AGENT_TOOLS[t].description}`).join('\n');
    const historyText = history
      .map((h, i) => `STEP ${i + 1}\nTHOUGHT: ${h.thought}\n${h.action ? `ACTION: ${h.action.tool}(${h.action.input})\nOBSERVATION: ${h.observation}` : ''}`)
      .join('\n');
    const decision = await aiJson(
      `You are a careful AI agent in a teaching demo. You pursue the goal step by step using ONLY the listed tools. Think briefly, act concretely. TASK: agent_step`,
      `GOAL: ${goal}\n\nAVAILABLE TOOLS:\n${toolDocs}\n\nHISTORY SO FAR:\n${historyText || '(none — this is your first step)'}\n\nDecide your NEXT step. Return JSON, one of:\n{"thought":"...","done":false,"action":{"tool":"<tool id>","input":"..."}}\n{"thought":"...","done":true,"final":"your complete answer/result for the goal"}\nRules: max ${history.length >= 10 ? 'ZERO more tool steps — you MUST finish now with done:true' : `${12 - history.length} more steps`}; never invent tool results; finish as soon as you can.`,
      (j) => {
        if (typeof j?.thought !== 'string') return 'needs thought';
        if (j?.done === true) return typeof j.final === 'string' && j.final ? null : 'done needs final';
        if (!j?.action?.tool || typeof j.action.input === 'undefined') return 'needs action {tool, input}';
        return null;
      },
      { maxTokens: 1500 }
    );
    if (decision.done) return res.json({ thought: decision.thought, done: true, final: decision.final });
    const observation = runTool(decision.action.tool, decision.action.input, { topicId: topic.id, notes });
    res.json({ thought: decision.thought, done: false, action: decision.action, observation });
  }));

  app.post('/api/flow/run', requireUser, requireAi, asyncRoute(async (req, res) => {
    const { nodes, edges, input } = req.body ?? {};
    res.json(await runFlow(nodes, edges, String(input ?? '').slice(0, 2000)));
  }));

  app.post('/api/flow/guide', requireUser, requireAi, asyncRoute(async (req, res) => {
    const { nodes, edges } = req.body ?? {};
    const problem = validateFlow(nodes ?? [], edges ?? []);
    if (problem) return res.status(400).json({ error: problem });
    const desc = nodes.map((n) => `- ${n.id} (${n.type}): "${n.config?.label}"${n.config?.prompt ? ` prompt: ${n.config.prompt.slice(0, 120)}` : ''}${n.config?.tool ? ` tool: ${n.config.tool}` : ''}`).join('\n');
    const wires = edges.map((e) => `${e.from} → ${e.to}`).join(', ');
    const text = await aiChat(
      'You write concise, practical integration guides for developers. Use **bold** for key terms and "- " bullet lists. No JSON, no code fences longer than 10 lines.',
      [{ role: 'user', content: `TASK: integration_guide\nA user built this agent flow in OceanMind (a visual builder) and downloaded it as JSON:\n${desc}\nWires: ${wires}\n\nWrite a short guide (under 300 words) on merging it into their own product: 1) what each step maps to in code, 2) how to run LLM steps with any provider API, 3) how to wire the JSON into a simple runner loop, 4) how to test the connections end-to-end.` }],
      { maxTokens: 2000 }
    );
    res.json({ text });
  }));

  app.get('/api/agent/tools', (_req, res) => {
    res.json({ tools: Object.entries(AGENT_TOOLS).map(([id, t]) => ({ id, name: t.name, icon: t.icon, description: t.description })) });
  });

  app.post('/api/ai/chat', requireUser, requireAi, asyncRoute(async (req, res) => {
    const system = String(req.body?.system ?? '').slice(0, 4000);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
    if (messages.length === 0) return res.status(400).json({ error: 'Messages are required.' });
    for (const m of messages) {
      if (!['user', 'assistant'].includes(m?.role) || typeof m?.content !== 'string') return res.status(400).json({ error: 'Invalid message format.' });
      m.content = m.content.slice(0, 4000);
    }
    res.json({ text: await aiChat(system, messages, { maxTokens: 1200 }) });
  }));

  // ----- support -----

  app.get('/api/support/reports', asyncRoute(async (_req, res) => {
    const rows = await db.all(
      `SELECT r.id, r.status, r.created_at, r.resolved_at, f.rating, f.reasons, f.note,
              s.id AS session_id, s.topic_id, s.zone, s.depth, s.version,
              u.name AS user_name, u.email AS user_email
       FROM ${T.reports} r
       JOIN ${T.feedback} f ON f.id = r.feedback_id
       JOIN ${T.learning_sessions} s ON s.id = r.session_id
       JOIN ${T.users} u ON u.id = s.user_id
       ORDER BY (r.status = 'new') DESC, r.id DESC`
    );
    res.json({
      reports: rows.map((r) => ({
        id: r.id, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at,
        rating: r.rating, reasons: parse(r.reasons, []), note: r.note,
        sessionId: r.session_id, topicTitle: getTopic(r.topic_id).title,
        zone: r.zone, depth: r.depth, version: r.version, userName: r.user_name, userEmail: r.user_email,
      })),
    });
  }));

  app.get('/api/support/reports/:id', asyncRoute(async (req, res) => {
    const r = await db.get(`SELECT * FROM ${T.reports} WHERE id = ?`, [Number(req.params.id)]);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const s = await sessionRow(r.session_id);
    const topic = getTopic(s.topic_id);
    const fb = await db.get(`SELECT * FROM ${T.feedback} WHERE id = ?`, [r.feedback_id]);
    const answered = parse(s.answered, []);
    res.json({
      report: { id: r.id, status: r.status, supportNote: r.support_note, correctedZone: r.corrected_zone, createdAt: r.created_at, resolvedAt: r.resolved_at },
      user: { name: s.user_name, email: s.user_email },
      session: { id: s.id, topicId: s.topic_id, topicTitle: topic.title, version: s.version, score: s.score, zone: s.zone, depth: s.depth, createdAt: s.created_at, lessonTitle: parse(s.lesson, null)?.title ?? null },
      assessmentDetail: answered.map((a) => ({ questionId: a.questionId, concept: a.concept, text: a.text, chosen: a.chosenText, correctAnswer: a.correctText, isCorrect: a.correct, noIdea: a.noIdea, explanation: a.explanation })),
      feedback: { rating: fb.rating, reasons: parse(fb.reasons, []), note: fb.note },
      zones: ZONES,
    });
  }));

  app.post('/api/support/reports/:id/resolve', requireAi, asyncRoute(async (req, res) => {
    const r = await db.get(`SELECT * FROM ${T.reports} WHERE id = ?`, [Number(req.params.id)]);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (r.status !== 'new') return res.status(409).json({ error: 'This report is already resolved.' });
    const zone = String(req.body?.zone ?? '');
    if (!ZONES[zone]) return res.status(400).json({ error: 'Pick a valid depth zone.' });
    const note = String(req.body?.note ?? '').trim().slice(0, 1000);
    const s = await sessionRow(r.session_id);
    const topic = getTopic(s.topic_id);
    const fb = await db.get(`SELECT * FROM ${T.feedback} WHERE id = ?`, [r.feedback_id]);
    const depth = midZoneDepth(zone);
    const lesson = await generateLesson(topic, {
      zone, scorePct: s.score, answered: parse(s.answered, []), knowledgeMap: parse(s.knowledge_map, null),
      supportNote: note, previousFeedback: `rated ${fb.rating}/5, reasons: ${parse(fb.reasons, []).join(', ') || '—'}${fb.note ? `, note: "${fb.note}"` : ''}`,
      userGoal: s.goal || undefined,
    });
    const created = await insertRow(T.learning_sessions,
      ['user_id', 'topic_id', 'version', 'status', 'score', 'depth', 'zone', 'knowledge_map', 'answered', 'lesson', 'rebuilt_from', 'support_note', 'goal'],
      [s.user_id, s.topic_id, s.version + 1, 'lesson', s.score, depth, zone, s.knowledge_map, s.answered, JSON.stringify(lesson), s.id, note, s.goal ?? null]
    );
    await db.run(`UPDATE ${T.learning_sessions} SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [s.id]);
    await db.run(`UPDATE ${T.reports} SET status = 'resolved', support_note = ?, corrected_zone = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, [note, zone, r.id]);
    const emailHtml = rebuildEmailHtml({ userName: s.user_name, topicTitle: topic.title, zone, depth, supportNote: note });
    await insertRow(T.notifications, ['user_id', 'session_id', 'title', 'body', 'email_html'],
      [s.user_id, created.id, `Your rebuilt ${topic.title} lesson is ready`,
        `Our support team recalibrated your dive to the ${ZONES[zone].label} (${depth.toLocaleString()} m) and the agent rebuilt your lesson from scratch. It’s waiting for you.`, emailHtml]
    );
    res.json({ ok: true, newSessionId: created.id });
  }));

  // ----- projects -----

  app.post('/api/projects', requireUser, asyncRoute(async (req, res) => {
    const kind = String(req.body?.kind ?? '').slice(0, 40) || 'flow';
    const name = String(req.body?.name ?? '').trim().slice(0, 120) || 'Untitled build';
    const data = req.body?.data;
    if (data === undefined) return res.status(400).json({ error: 'Nothing to save.' });
    const serialized = JSON.stringify(data);
    if (serialized.length > 200000) return res.status(400).json({ error: 'That build is too large to save.' });
    const topicId = typeof req.body?.topicId === 'string' ? req.body.topicId : null;
    const sessionId = Number.isInteger(req.body?.sessionId) ? req.body.sessionId : null;
    const projectId = rowId(req.body?.projectId);
    const cols = ['user_id', 'session_id', 'topic_id', 'kind', 'name', 'data'];
    const values = [req.user.id, sessionId, topicId, kind, name, serialized];
    if (projectId) {
      const owned = await db.get(`SELECT id FROM ${T.projects} WHERE id = ? AND user_id = ?`, [projectId, req.user.id]);
      if (!owned && isDemoMode()) {
        // demo: this instance never saw the project — save it again, keeping its id when free
        const taken = projectId <= DEMO_SEED_MAX_IDS[T.projects] || (await db.get(`SELECT id FROM ${T.projects} WHERE id = ?`, [projectId]));
        const r = taken
          ? await insertRow(T.projects, cols, values)
          : await db.insert(`INSERT INTO ${T.projects} (id, ${cols.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [projectId, ...values]);
        return res.json({ ok: true, projectId: r.id });
      }
      if (!owned) return res.status(404).json({ error: 'Project not found.' });
      await db.run(`UPDATE ${T.projects} SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [name, serialized, projectId]);
      return res.json({ ok: true, projectId });
    }
    const r = await insertRow(T.projects, cols, values);
    res.status(201).json({ ok: true, projectId: r.id });
  }));

  app.get('/api/projects', requireUser, asyncRoute(async (req, res) => {
    const rows = await db.all(`SELECT id, session_id, topic_id, kind, name, created_at, updated_at FROM ${T.projects} WHERE user_id = ? ORDER BY updated_at DESC`, [req.user.id]);
    res.json({
      projects: rows.map((p) => ({
        id: p.id, sessionId: p.session_id, topicId: p.topic_id, kind: p.kind, name: p.name,
        topicTitle: p.topic_id ? getTopic(p.topic_id)?.title ?? null : null, createdAt: p.created_at, updatedAt: p.updated_at,
      })),
    });
  }));

  app.get('/api/projects/:id', requireUser, asyncRoute(async (req, res) => {
    const p = await db.get(`SELECT * FROM ${T.projects} WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id]);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project: { id: p.id, kind: p.kind, name: p.name, topicId: p.topic_id, topicTitle: p.topic_id ? getTopic(p.topic_id)?.title ?? null : null, data: parse(p.data, null), createdAt: p.created_at, updatedAt: p.updated_at } });
  }));

  app.delete('/api/projects/:id', requireUser, asyncRoute(async (req, res) => {
    const r = await db.run(`DELETE FROM ${T.projects} WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json({ ok: true });
  }));

  // ----- notifications -----

  app.get('/api/notifications', requireUser, asyncRoute(async (req, res) => {
    const rows = await db.all(`SELECT * FROM ${T.notifications} WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [req.user.id]);
    res.json({
      notifications: rows.map((n) => ({ id: n.id, sessionId: n.session_id, title: n.title, body: n.body, emailHtml: n.email_html, read: Boolean(Number(n.read)), createdAt: n.created_at })),
    });
  }));

  app.post('/api/notifications/:id/read', requireUser, asyncRoute(async (req, res) => {
    const r = await db.run(`UPDATE ${T.notifications} SET read = 1 WHERE id = ? AND user_id = ?`, [Number(req.params.id), req.user.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ ok: true });
  }));

  // ----- static client + errors -----

  // an unknown API route answers JSON (the client always parses JSON), never the SPA or an HTML page
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  const dist = join(__dirname, '..', 'client', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.status(200).send('OceanMind API is running.'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error('[server]', err, err.upstream ?? '');
    res.status(status).json({ error: err.message || 'Something went wrong on our side.' });
  });

  return app;
}

export async function startServer() {
  const app = createApp();
  app.listen(PORT, async () => {
    console.log(`OceanMind server listening on http://localhost:${PORT} (db: ${db.driver})`);
    if (isDemoMode()) console.log(`Pitch demo mode: scripted replay provider, seeded in-memory DB, persona ${DEMO_PERSONA.email} (speed ×${demoSpeed()})`);
    const cfg = await maskedConfig().catch(() => null);
    console.log(cfg ? `AI model: connected (${cfg.provider} · ${cfg.model})` : 'AI model: NOT CONFIGURED — open /#/admin to connect a key');
  });
}
