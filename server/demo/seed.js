/**
 * Deterministic pitch-demo history, written into the in-memory demo DB on every
 * cold start (db.js calls seedDemo once, right after the schema). Past dives
 * are built from the same replay corpus and the same step validator as a live
 * dive, in exactly the JSON shapes the routes store, so the Logbook, Projects
 * and Notifications read like real use. Timestamps are relative to "now".
 *
 * The persona's story so far:
 *   - ~13 days ago: a Chatbots dive (Sunlight), rated 2/5 "Too easy" → support
 *     recalibrated it to Twilight and the agent rebuilt it (v2, ~12 days ago,
 *     completed, dive log saved to Projects, the rebuild email is read).
 *   - ~9 days ago: a draft agent flow saved to Projects.
 *   - ~5 days ago: a Neural Networks dive (Sunlight, completed) — so the live
 *     Neural Networks dive reads as a return visit going deeper.
 */
import { validateSteps } from '../lib/generate.js';
import { getTopic, ZONES } from '../content/topics.js';
import { depthForScore, midZoneDepth } from '../lib/scoring.js';
import { rebuildEmailHtml } from '../emailTemplate.js';
import { DEMO_PERSONA, DEMO_USER_ID } from './index.js';

/** Ids the seed pins (live rows continue after them). */
export const DEMO_SEED_IDS = {
  userId: DEMO_USER_ID,
  sessions: { chatbotsFirst: 1, chatbotsRebuilt: 2, neuralNetworks: 3 },
  projects: { chatbotsDiveLog: 1, agentFlow: 2 },
  notifications: { chatbotsRebuilt: 1 },
};

const CHATBOTS_GOAL = 'I want a chatbot that answers the questions my customers keep asking';
const CHATBOTS_FEEDBACK = { rating: 2, reasons: ['Too easy'], note: 'I already know how intents work. I wanted to see the rule bot next to a real LLM bot.' };
const CHATBOTS_SUPPORT_NOTE = 'You clearly know intents already, so we rebuilt this at Twilight depth: the live LLM comparison, fallbacks, and where rule bots break.';

/** A seeded quiz run: 'right' | 'wrong' | 'noidea' per question, in the stored answered[] shape. */
function answerAll(questions, pattern) {
  return questions.map((q, i) => {
    const kind = pattern[i] ?? 'wrong';
    const noIdea = kind === 'noidea';
    const choice = noIdea ? -1 : kind === 'right' ? q.correctIndex : (q.correctIndex + 1) % q.options.length;
    return {
      questionId: q.id, concept: q.concept, text: q.text, choice, noIdea, correct: kind === 'right',
      chosenText: noIdea ? 'I don’t have any idea' : q.options[choice],
      correctText: q.options[q.correctIndex], correctIndex: q.correctIndex, explanation: q.explanation,
    };
  });
}

const scoreOf = (answered) => Math.round((answered.filter((a) => a.correct).length / answered.length) * 100);

/** Knowledge map + questions exactly as POST /api/sessions stores them (ids q1..q6; unshuffled so the seed is stable). */
function assessment(corpus) {
  return {
    knowledgeMap: structuredClone(corpus.knowledgeMap),
    questions: corpus.questions.map((q, i) => ({ id: `q${i + 1}`, ...structuredClone(q) })),
  };
}

/** The lesson the pipeline would build for this learner, validated like generateLesson does. */
function lessonFor(corpus, topicId, answered, { zone, scorePct, goal = null, supportNote = null, previousFeedback = null }) {
  const lesson = structuredClone(corpus.lesson({
    zone, scorePct,
    known: answered.filter((a) => a.correct).map((a) => a.concept),
    missed: answered.filter((a) => !a.correct).map((a) => a.concept),
    noIdea: answered.filter((a) => a.noIdea).map((a) => a.concept),
    goal, supportNote, previousFeedback, redesign: false,
  }));
  if (typeof lesson?.title !== 'string' || typeof lesson?.intro !== 'string') throw new Error(`${topicId} ${zone} lesson needs a title and intro`);
  const problem = validateSteps(lesson.steps, topicId, { min: 4, max: 9 });
  if (problem) throw new Error(`${topicId} ${zone} lesson: ${problem}`);
  return lesson;
}

/** The dive log generateSummary would write, checked against its validator rules. */
function summaryFor(corpus, topicId, lesson, answered, { zone, scorePct, goal = null }) {
  const summary = structuredClone(corpus.summary({
    zone, scorePct,
    missed: answered.filter((a) => !a.correct).map((a) => a.concept),
    steps: lesson.steps.map((s) => ({ title: s.title, blockType: s.block?.type ?? null })),
    goal,
  }));
  const ok = typeof summary?.headline === 'string' && summary.headline && summary.headline.length <= 120
    && ['learned', 'built', 'nextSteps'].every((k) => Array.isArray(summary[k]) && summary[k].length >= 2 && summary[k].length <= 5
      && summary[k].every((x) => typeof x === 'string' && x && x.length <= 140));
  if (!ok) throw new Error(`${topicId} ${zone} summary does not match the dive-log shape`);
  return summary;
}

const ago = (hours) => `-${hours} hours`;
const at = `datetime('now', ?)`;

function insertSession(raw, T, s) {
  raw.run(
    `INSERT INTO ${T.learning_sessions}
       (id, user_id, topic_id, version, status, score, depth, zone, knowledge_map, questions, answered, lesson, summary,
        rebuilt_from, support_note, goal, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${at}, ${at})`,
    [s.id, DEMO_USER_ID, s.topicId, s.version ?? 1, s.status, s.score, s.depth, s.zone,
      JSON.stringify(s.knowledgeMap), s.questions ? JSON.stringify(s.questions) : null, JSON.stringify(s.answered),
      JSON.stringify(s.lesson), s.summary ? JSON.stringify(s.summary) : null,
      s.rebuiltFrom ?? null, s.supportNote ?? null, s.goal ?? null, ago(s.createdH), ago(s.updatedH)]
  );
}

function insertFeedback(raw, T, { id, sessionId, rating, reasons = [], note = '', hoursAgo }) {
  raw.run(`INSERT INTO ${T.feedback} (id, session_id, rating, reasons, note, created_at) VALUES (?, ?, ?, ?, ?, ${at})`,
    [id, sessionId, rating, JSON.stringify(reasons), note, ago(hoursAgo)]);
}

function seedHistory(raw, T, getCorpus) {
  const ids = DEMO_SEED_IDS.sessions;

  // ---- Chatbots, first attempt: Sunlight, rated "Too easy"
  const cb = getCorpus('chatbots');
  const cbAssess = assessment(cb);
  const cbAnswered = answerAll(cbAssess.questions, ['right', 'right', 'wrong', 'noidea', 'wrong', 'wrong']);
  const cbScore = scoreOf(cbAnswered);
  const cbZone1 = 'sunlight';
  const cbLesson1 = lessonFor(cb, 'chatbots', cbAnswered, { zone: cbZone1, scorePct: cbScore, goal: CHATBOTS_GOAL });
  const cbSummary1 = summaryFor(cb, 'chatbots', cbLesson1, cbAnswered, { zone: cbZone1, scorePct: cbScore, goal: CHATBOTS_GOAL });
  insertSession(raw, T, {
    id: ids.chatbotsFirst, topicId: 'chatbots', status: 'closed', score: cbScore, depth: depthForScore(cbScore), zone: cbZone1,
    knowledgeMap: cbAssess.knowledgeMap, questions: cbAssess.questions, answered: cbAnswered,
    lesson: cbLesson1, summary: cbSummary1, goal: CHATBOTS_GOAL, createdH: 314, updatedH: 290,
  });
  insertFeedback(raw, T, { id: 1, sessionId: ids.chatbotsFirst, ...CHATBOTS_FEEDBACK, hoursAgo: 313 });
  raw.run(
    `INSERT INTO ${T.reports} (id, session_id, feedback_id, status, support_note, corrected_zone, created_at, resolved_at)
     VALUES (1, ?, 1, 'resolved', ?, 'twilight', ${at}, ${at})`,
    [ids.chatbotsFirst, CHATBOTS_SUPPORT_NOTE, ago(313), ago(290)]
  );

  // ---- Chatbots, rebuilt by support at Twilight (v2) and completed
  const cbZone2 = 'twilight';
  const cbDepth2 = midZoneDepth(cbZone2);
  const previousFeedback = `rated ${CHATBOTS_FEEDBACK.rating}/5, reasons: ${CHATBOTS_FEEDBACK.reasons.join(', ')}, note: "${CHATBOTS_FEEDBACK.note}"`;
  const cbLesson2 = lessonFor(cb, 'chatbots', cbAnswered, {
    zone: cbZone2, scorePct: cbScore, goal: CHATBOTS_GOAL, supportNote: CHATBOTS_SUPPORT_NOTE, previousFeedback,
  });
  const cbSummary2 = summaryFor(cb, 'chatbots', cbLesson2, cbAnswered, { zone: cbZone2, scorePct: cbScore, goal: CHATBOTS_GOAL });
  insertSession(raw, T, {
    id: ids.chatbotsRebuilt, topicId: 'chatbots', version: 2, status: 'closed', score: cbScore, depth: cbDepth2, zone: cbZone2,
    knowledgeMap: cbAssess.knowledgeMap, questions: null, answered: cbAnswered, lesson: cbLesson2, summary: cbSummary2,
    rebuiltFrom: ids.chatbotsFirst, supportNote: CHATBOTS_SUPPORT_NOTE, goal: CHATBOTS_GOAL, createdH: 290, updatedH: 287,
  });
  insertFeedback(raw, T, { id: 2, sessionId: ids.chatbotsRebuilt, rating: 5, hoursAgo: 287 });
  const topic = getTopic('chatbots');
  raw.run(
    `INSERT INTO ${T.notifications} (id, user_id, session_id, title, body, email_html, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ${at})`,
    [DEMO_SEED_IDS.notifications.chatbotsRebuilt, DEMO_USER_ID, ids.chatbotsRebuilt, `Your rebuilt ${topic.title} lesson is ready`,
      `Our support team recalibrated your dive to the ${ZONES[cbZone2].label} (${cbDepth2.toLocaleString('en-US')} m) and the agent rebuilt your lesson from scratch. It’s waiting for you.`,
      rebuildEmailHtml({ userName: DEMO_PERSONA.name, topicTitle: topic.title, zone: cbZone2, depth: cbDepth2, supportNote: CHATBOTS_SUPPORT_NOTE }),
      ago(290)]
  );
  raw.run(
    `INSERT INTO ${T.projects} (id, user_id, session_id, topic_id, kind, name, data, created_at, updated_at)
     VALUES (?, ?, ?, 'chatbots', 'summary', ?, ?, ${at}, ${at})`,
    [DEMO_SEED_IDS.projects.chatbotsDiveLog, DEMO_USER_ID, ids.chatbotsRebuilt, `Dive log · ${topic.title}`, JSON.stringify(cbSummary2), ago(288), ago(288)]
  );

  // ---- a draft agent flow (FlowBuilder's saved shape: { nodes, edges })
  const flow = {
    nodes: [
      { id: 'n1', type: 'trigger', x: 30, y: 150, config: { label: 'Customer message' } },
      { id: 'n2', type: 'llm', x: 250, y: 150, config: { label: 'Classify question', prompt: 'Label the message as hours, menu, booking or other, and say how sure you are.' } },
      { id: 'n3', type: 'llm', x: 470, y: 150, config: { label: 'Draft reply', prompt: 'Write a short, friendly reply using only the café facts. If the label is "other", hand over to a human.' } },
      { id: 'n4', type: 'output', x: 690, y: 150, config: { label: 'Reply' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  };
  raw.run(
    `INSERT INTO ${T.projects} (id, user_id, session_id, topic_id, kind, name, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'ai-agents', 'flow', ?, ?, ${at}, ${at})`,
    [DEMO_SEED_IDS.projects.agentFlow, DEMO_USER_ID, 'Agent flow · Café FAQ triage', JSON.stringify(flow), ago(216), ago(212)]
  );

  // ---- Neural Networks, first visit: Sunlight, completed (no typed goal — started from a topic pill)
  const nn = getCorpus('neural-networks');
  const nnAssess = assessment(nn);
  const nnAnswered = answerAll(nnAssess.questions, ['right', 'wrong', 'noidea', 'wrong', 'noidea', 'wrong']);
  const nnScore = scoreOf(nnAnswered);
  const nnZone = 'sunlight';
  const nnLesson = lessonFor(nn, 'neural-networks', nnAnswered, { zone: nnZone, scorePct: nnScore });
  const nnSummary = summaryFor(nn, 'neural-networks', nnLesson, nnAnswered, { zone: nnZone, scorePct: nnScore });
  insertSession(raw, T, {
    id: ids.neuralNetworks, topicId: 'neural-networks', status: 'closed', score: nnScore, depth: depthForScore(nnScore), zone: nnZone,
    knowledgeMap: nnAssess.knowledgeMap, questions: nnAssess.questions, answered: nnAnswered,
    lesson: nnLesson, summary: nnSummary, createdH: 122, updatedH: 120,
  });
  insertFeedback(raw, T, { id: 3, sessionId: ids.neuralNetworks, rating: 4, hoursAgo: 120 });
}

/**
 * Seed the demo DB. `raw` is db.js's synchronous SQLite API (get/all/run/insert/exec);
 * `T` the table names. The persona always exists afterwards; if the history
 * can't be built (e.g. a corpus file is broken) it is skipped, loudly.
 */
export async function seedDemo(raw, T) {
  raw.run(`INSERT INTO ${T.users} (id, name, email, created_at) VALUES (?, ?, ?, ${at})`,
    [DEMO_USER_ID, DEMO_PERSONA.name, DEMO_PERSONA.email, ago(400)]);
  let getCorpus;
  try {
    // loaded here (not statically) so a broken corpus file can't stop the persona from existing
    ({ getCorpus } = await import('./replay/index.js'));
  } catch (e) {
    console.error('[demo seed] corpus failed to load — the persona starts with an empty logbook:', e);
    return;
  }
  raw.exec('BEGIN');
  try {
    seedHistory(raw, T, getCorpus);
    raw.exec('COMMIT');
  } catch (e) {
    raw.exec('ROLLBACK');
    console.error('[demo seed] history skipped — the persona starts with an empty logbook:', e);
  }
}

/** Delete every row `userId` owns (sessions and their feedback/reports, projects, notifications). */
function wipeUserRows(raw, T, userId) {
  const mine = `SELECT id FROM ${T.learning_sessions} WHERE user_id = ?`;
  const reports = raw.run(
    `DELETE FROM ${T.reports} WHERE session_id IN (${mine}) OR feedback_id IN (SELECT id FROM ${T.feedback} WHERE session_id IN (${mine}))`,
    [userId, userId]
  ).changes;
  const feedback = raw.run(`DELETE FROM ${T.feedback} WHERE session_id IN (${mine})`, [userId]).changes;
  const notifications = raw.run(`DELETE FROM ${T.notifications} WHERE user_id = ?`, [userId]).changes;
  const projects = raw.run(`DELETE FROM ${T.projects} WHERE user_id = ?`, [userId]).changes;
  const sessions = raw.run(`DELETE FROM ${T.learning_sessions} WHERE user_id = ?`, [userId]).changes;
  return { sessions, projects, notifications, feedback, reports };
}

/** AUTOINCREMENT tables continue right after the highest remaining id, as on a cold start. */
function rewindSequences(raw, T) {
  if (!raw.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`)) return;
  for (const t of [T.learning_sessions, T.feedback, T.reports, T.notifications, T.projects]) {
    raw.run(`UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM ${t}) WHERE name = ?`, [t]);
  }
}

/**
 * POST /api/demo/reset: wipe what `userId` created on this instance. For the
 * persona (the auto-pilot's user) the deterministic history is then written
 * back exactly as on a cold start (same ids, same content, timestamps relative
 * to now) and the persona's name is restored, so every rehearsal starts from
 * the same Logbook, Projects and Notifications. Any other user just gets a
 * clean slate. One transaction: on failure nothing changes and it throws.
 */
export async function resetDemoUser(raw, T, userId = DEMO_USER_ID) {
  const persona = userId === DEMO_USER_ID;
  // load before BEGIN: the transaction below is synchronous, so no request can interleave
  const { getCorpus } = persona ? await import('./replay/index.js') : {};
  raw.exec('BEGIN');
  try {
    const wiped = wipeUserRows(raw, T, userId);
    if (persona) {
      if (raw.get(`SELECT id FROM ${T.users} WHERE id = ?`, [DEMO_USER_ID])) {
        raw.run(`UPDATE ${T.users} SET name = ?, email = ? WHERE id = ?`, [DEMO_PERSONA.name, DEMO_PERSONA.email, DEMO_USER_ID]);
      } else {
        raw.run(`INSERT INTO ${T.users} (id, name, email, created_at) VALUES (?, ?, ?, ${at})`,
          [DEMO_USER_ID, DEMO_PERSONA.name, DEMO_PERSONA.email, ago(400)]);
      }
      seedHistory(raw, T, getCorpus);
    }
    rewindSequences(raw, T);
    raw.exec('COMMIT');
    return { userId, wiped, seeded: persona };
  } catch (e) {
    raw.exec('ROLLBACK');
    throw e;
  }
}
