/**
 * Pitch-demo mode switches. Demo mode is opt-in (OCEANMIND_DEMO=1): the model
 * is replaced by the scripted replay provider (server/aireplay.js), the DB is
 * an in-memory SQLite seeded on every cold start (server/demo/seed.js), and
 * the cookie secret is a fixed constant so a cookie stays valid on every
 * serverless instance. Nothing here imports the DB, so db.js can import it.
 */
import { randomInt } from 'node:crypto';

export function isDemoMode() {
  return process.env.OCEANMIND_DEMO === '1';
}

/** The seeded learner the auto-pilot signs in as. Always user id 1. */
export const DEMO_PERSONA = { name: 'Faisal', email: 'faisal@oceanmind.demo' };
export const DEMO_USER_ID = 1;

/** Fixed on purpose: every instance must accept every other instance's cookie. */
export const DEMO_COOKIE_SECRET = 'oceanmind-pitch-demo · cookie secret · v1';

// ------------------------------------------------------------------ replay latency

/**
 * How long the scripted "model" thinks before each reply, in ms at speed 1,
 * per model call (task). A reply waits `DEMO_LATENCY_MS[task] × speed`, with
 * ±DEMO_LATENCY_JITTER random spread; aiJson retries answer instantly.
 */
export const DEMO_LATENCY_MS = Object.freeze({
  topic_match: 300, knowledge_map: 900, questions: 800, lesson: 1600, tutor_decide: 650, expand_steps: 1100,
  summary: 900, agent_step: 550, flow_node: 600, integration_guide: 900, chat: 650,
});
export const DEMO_LATENCY_JITTER = 0.15;

/**
 * The same budget per HTTP request (ms at speed 1): the sum of the model calls
 * each route makes, so a view can size an in-flight checklist without knowing
 * the pipeline. A request takes about `DEMO_ROUTE_LATENCY_MS[route] × speed`
 * plus a few ms of real work.
 */
export const DEMO_ROUTE_LATENCY_MS = Object.freeze({
  topicMatch: 0, // POST /api/topics/match — the keyword matcher answers the story goals; a miss costs topic_match
  topicMatchFallback: DEMO_LATENCY_MS.topic_match,
  createSession: DEMO_LATENCY_MS.knowledge_map + DEMO_LATENCY_MS.questions, // POST /api/sessions
  buildLesson: DEMO_LATENCY_MS.lesson, // POST /api/sessions/:id/build-lesson
  tutorAnswer: DEMO_LATENCY_MS.tutor_decide, // POST /api/sessions/:id/tutor → updated: null
  tutorExpand: DEMO_LATENCY_MS.tutor_decide + DEMO_LATENCY_MS.expand_steps, // → updated: 'expanded'
  tutorRedesign: DEMO_LATENCY_MS.tutor_decide + DEMO_LATENCY_MS.lesson, // → updated: 'redesigned'
  summary: DEMO_LATENCY_MS.summary, // POST /api/sessions/:id/summary (first call; later calls are cached, instant)
  agentStep: DEMO_LATENCY_MS.agent_step, // POST /api/agent/step, each step
  flowNode: DEMO_LATENCY_MS.flow_node, // POST /api/flow/run costs this per LLM node (trigger/tool/output nodes are instant)
  integrationGuide: DEMO_LATENCY_MS.integration_guide, // POST /api/flow/guide
  chat: DEMO_LATENCY_MS.chat, // POST /api/ai/chat
});

/**
 * Replay latency multiplier (OCEANMIND_DEMO_SPEED; default 1, 0 = instant,
 * 0.5 = twice as fast, 2 = twice as slow). It scales the server-side
 * "thinking" time only; the director's presenter tempo (+/-) is separate.
 */
export function demoSpeed() {
  const raw = process.env.OCEANMIND_DEMO_SPEED;
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** GET /api/demo/status body in demo mode. */
export function demoStatus() {
  return {
    demo: true,
    persona: DEMO_PERSONA,
    speed: demoSpeed(),
    latency: DEMO_LATENCY_MS,
    routeLatency: DEMO_ROUTE_LATENCY_MS,
    jitter: DEMO_LATENCY_JITTER,
  };
}

/** Provider entry the admin page lists while the replay provider is active. */
export const REPLAY_PROVIDER = {
  label: 'Demo replay',
  defaultModel: 'oceanmind-demo',
  keyHint: 'Demo mode — scripted replay, no key needed',
};

// ------------------------------------------------------------------ row ids

/**
 * Highest id the seed pins per table (server/demo/seed.js). Live rows always
 * get a larger id, so a re-seed (cold start or POST /api/demo/reset) can
 * never collide with them.
 */
export const DEMO_SEED_MAX_IDS = Object.freeze({
  om_users: 1, om_learning_sessions: 3, om_feedback: 3, om_reports: 1, om_notifications: 1, om_projects: 2,
});

/**
 * On serverless (several instances, each with its own in-memory DB) new rows
 * get time-based ids so two instances never hand out the same id for
 * different rows. Locally the ids stay small and sequential.
 */
export function demoWantsUniqueIds() {
  return isDemoMode() && (Boolean(process.env.VERCEL) || process.env.OCEANMIND_DEMO_UNIQUE_IDS === '1');
}

const ID_EPOCH_MS = Date.UTC(2026, 8, 1);

/**
 * Next id for `table`: max(existing)+1 and above every seeded id; on serverless
 * at least (seconds since 2026-09-01) × 100 + a random 0-99, so two instances
 * (or two users) creating rows in the same second almost never pick the same
 * id. Always a safe integer.
 */
export async function demoNextId(db, table) {
  const row = await db.get(`SELECT MAX(id) AS maxId FROM ${table}`);
  const next = Math.max(Number(row?.maxId ?? 0) + 1, (DEMO_SEED_MAX_IDS[table] ?? 0) + 1);
  if (!demoWantsUniqueIds()) return next;
  const timeBased = Math.floor((Date.now() - ID_EPOCH_MS) / 1000) * 100 + randomInt(100);
  return Math.max(next, timeBased);
}
