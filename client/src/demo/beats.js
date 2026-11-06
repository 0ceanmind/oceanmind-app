/**
 * The pitch story (team B2-journey): two dives back to back, driven one beat
 * per clicker press. See README.md in this folder for the director API.
 *
 *  1 Welcome                  sign in as the persona
 *  2 Dive 1 · AI Agents       goal → map → depth check → reveal → build
 *  3 Agents lesson            one beat per step, Lulu adds two steps
 *  4 Surface                  dive log → save → rate → celebration
 *  5 Dive 2 · Neural Networks goal → map → brisk depth check → build
 *  6 Neural Networks lesson   one beat per step, live training finale
 *  7 Finish                   dive log → save → Logbook
 *
 * Every chapter's enter() reaches its start state from ANY state (signed out,
 * another route, a modal or Lulu open, mid-lesson…). Lesson chapters reuse the
 * dive the show already made (resetting it through the demo restore route) and
 * only create one through the API when none exists, so rehearsals don't pile
 * up rows in the Logbook. Beats find where the app is from the DOM
 * ([data-demo=lesson-step][data-step-index][data-block-type], data-stage…),
 * never from fixed indices, because Lulu inserts steps.
 */
import { driveBlock, driveCheck, driveTutor } from './blockDrivers.js';

/* ------------------------------------------------------------------ story data */

const GOAL_AGENTS = "I want to build an AI agent that answers my customers' support emails";
const GOAL_NN = 'Show me how a neural network actually learns';
const LULU_ASK = 'Can you walk me through routing a support email step by step?';

const DIVES = {
  dive1: {
    key: 'dive1',
    topicId: 'ai-agents',
    goal: GOAL_AGENTS,
    // 4/6 → 67 % → Twilight, 817 m (q3 "no idea", q5 wrong)
    plan: ['right', 'right', 'noidea', 'right', 'wrong', 'right'],
    lulu: true,
  },
  dive2: {
    key: 'dive2',
    topicId: 'neural-networks',
    goal: GOAL_NN,
    // 3/6 → 50 % → Twilight, 429 m
    plan: ['right', 'wrong', 'right', 'noidea', 'right', 'wrong'],
    lulu: false,
  },
};

// Quiz pacing: dive 1 is told slowly, dive 2 at a brisker clip.
const PACE_FULL = { lead: 160, hover: 330, hover2: 260, read: 1150, slide: 360 };
const PACE_BRISK = { lead: 90, hover: 240, hover2: 0, read: 800, slide: 320 };

// Blocks Lulu's routing expansion inserts into the Agents lesson.
const LULU_TYPES = ['sequence', 'simulator'];

/* ------------------------------------------------------------------ small DOM helpers */

const q = (sel) => document.querySelector(sel);
const normId = (id) => (id == null ? null : String(Number(String(id).replace(/^0+(?=\d)/, ''))));

/** The lesson step on screen, read from its data attributes. */
function stepInfo() {
  const el = q('[data-demo="lesson-step"]');
  if (!el) return null;
  return {
    el,
    i: Number(el.dataset.stepIndex),
    n: Number(el.dataset.stepCount),
    type: el.dataset.blockType,
    kind: el.dataset.stepKind,
    answered: el.dataset.checkAnswered === 'true',
  };
}

/** Any finite CSS animation still running on these elements (or inside them)? */
function animating(els) {
  for (const el of els) {
    const anims = el.getAnimations?.({ subtree: true }) ?? [];
    for (const a of anims) {
      if (a.playState !== 'running') continue;
      const it = a.effect?.getTiming?.().iterations;
      if (it === Infinity) continue;
      return true;
    }
  }
  return false;
}

/** Wait (softly) until entrance animations on `selector` have finished. */
function settleAnimations(ctx, selector, timeout = 3500) {
  return ctx.waitFor(() => !animating(Array.from(document.querySelectorAll(selector))), {
    timeout, interval: 80, soft: true, label: `${selector} to settle`,
  });
}

/** The dive's session row, from the cache or the server. */
async function rowFor(ctx, id = ctx.sessionId()) {
  const sid = normId(id);
  if (!sid) throw new Error('no dive is open');
  return ctx.getSessionRow(sid) ?? ctx.loadSessionRow(sid);
}

/** Load a row, or null when the server doesn't know the id (never swallows an abort). */
async function tryLoadRow(ctx, id) {
  try {
    return await ctx.loadSessionRow(normId(id));
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    return null;
  }
}

/** The most plausible wrong option: the longest one that isn't the key. */
function distractorIndex(question) {
  let best = -1;
  question.options.forEach((opt, i) => {
    if (i === question.correctIndex) return;
    if (best < 0 || String(opt).length > String(question.options[best]).length) best = i;
  });
  return best < 0 ? (question.correctIndex + 1) % question.options.length : best;
}

const blockTypeOf = (step) => step?.block?.type ?? 'none';

/* ------------------------------------------------------------------ app-level helpers */

/** Close anything floating over the page: a modal, Lulu. */
async function clearOverlays(ctx) {
  if (ctx.exists('@modal')) {
    await ctx.pressKey(null, 'Escape');
    await ctx.waitFor(() => !ctx.exists('@modal'), { timeout: 1500, soft: true, label: 'the modal to close' });
  }
  if (ctx.exists('@tutor-panel')) {
    await ctx.click('@tutor-close', { spot: false, scroll: false });
    await ctx.waitFor(() => !ctx.exists('@tutor-panel'), { timeout: 1500, soft: true, label: 'Lulu to close' });
  }
}

/** A dive the Home screen is still starting would yank the view away later: let it land first. */
async function settleHome(ctx) {
  if (!ctx.exists('@compiling')) return;
  ctx.log('a dive is still being compiled — letting it land first', 'warn');
  await ctx.waitFor(() => !ctx.exists('@compiling') || /^#\/session\//.test(window.location.hash), {
    timeout: 20000, soft: true, label: 'the dive being compiled',
  });
  await ctx.pause(150);
}

/** Type the persona into the real sign-in form. */
async function signInForm(ctx, { nameCps = 14, emailCps = 22 } = {}) {
  await ctx.find('@signin-name', { timeout: 15000 });
  await ctx.type('@signin-name', ctx.persona.name, { cps: nameCps, clear: true });
  await ctx.wait(180);
  await ctx.type('@signin-email', ctx.persona.email, { cps: emailCps, clear: true });
  await ctx.wait(260);
  await ctx.click('@signin-submit');
  await ctx.find('@ask-input', { timeout: 15000 });
}

/**
 * Any state → signed in, no overlays, on a normal (learner) route.
 * Signs in through the form at high speed when needed.
 */
async function ensureSignedIn(ctx) {
  await clearOverlays(ctx);
  await settleHome(ctx);
  const route = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  if (route === 'support' || route === 'admin') await ctx.navigate('/');
  await ctx.find('@signin-name, @nav-signout', { timeout: 15000, label: 'sign-in form or nav' });
  if (!ctx.exists('@nav-signout')) {
    await ctx.navigate('/');
    await ctx.fast(() => signInForm(ctx, { nameCps: 30, emailCps: 45 }));
  }
}

/** Any state → signed in, on a clean Home at the top. */
async function ensureHome(ctx) {
  await ensureSignedIn(ctx);
  await ctx.navigate('/');
  const input = await ctx.find('@ask-input', { timeout: 15000 });
  if (input.value) await ctx.clear(input, { instant: true });
  await ctx.scrollTop();
  await ctx.waitIdle({ timeout: 6000 });
}

/**
 * Show the SessionView for `id`, freshly mounted (so every block starts from
 * scratch). When that dive is already on screen, the route toggles between
 * #/session/7 and #/session/07 (same session) to force a remount.
 */
async function openSession(ctx, id) {
  const sid = normId(id);
  const plain = `#/session/${sid}`;
  const alt = `#/session/0${sid}`;
  const stageEl = q('[data-demo="session"] > .om-v-stage');
  const here = window.location.hash === plain || window.location.hash === alt;
  await ctx.navigate(here && window.location.hash === plain ? alt.slice(1) : plain.slice(1));
  if (here && stageEl) {
    await ctx.waitFor(() => !stageEl.isConnected, { timeout: 4000, soft: true, label: 'the dive to reload' });
  }
  return ctx.waitFor(() => {
    const m = q('[data-demo="session"]');
    if (!m) return null;
    const st = m.dataset.stage;
    if (!st || st === 'loading') return null;
    return normId(m.dataset.sessionId) === sid ? st : null;
  }, { timeout: 15000, label: `dive ${sid} to open` });
}

/* ------------------------------------------------------------------ dive rows (fast path) */

function pristineLesson(ctx, dive, row) {
  const saved = ctx.recall(`${dive.key}:lesson`, null);
  if (saved && normId(saved.id) === normId(row.id) && saved.lesson?.steps?.length) return saved.lesson;
  const lesson = row.lesson;
  if (!lesson?.steps) return lesson;
  if (!dive.lulu) return lesson;
  return { ...lesson, steps: lesson.steps.filter((s) => !LULU_TYPES.includes(blockTypeOf(s))) };
}

function rememberLesson(ctx, dive, row) {
  if (row?.lesson?.steps?.length) ctx.remember(`${dive.key}:lesson`, { id: normId(row.id), lesson: row.lesson });
}

/** The dive the show made for this story (remembered id, else the newest one with the story goal). */
async function findDiveRow(ctx, dive) {
  const remembered = ctx.recall(dive.key, null);
  if (remembered) {
    const row = await tryLoadRow(ctx, remembered);
    if (row && row.topic_id === dive.topicId) return row;
  }
  const { sessions = [] } = await ctx.api('/api/sessions');
  const candidates = sessions.filter((s) => s.topicId === dive.topicId).slice(0, 4);
  for (const s of candidates) {
    const row = await tryLoadRow(ctx, s.id);
    if (row && String(row.goal ?? '').trim() === dive.goal) {
      ctx.remember(dive.key, normId(row.id));
      return row;
    }
  }
  return null;
}

async function createDive(ctx, dive) {
  ctx.log(`no ${dive.topicId} dive yet — creating one through the API`);
  const { session } = await ctx.api('/api/sessions', { method: 'POST', body: { topicId: dive.topicId, goal: dive.goal } });
  const id = normId(session.id);
  ctx.remember(dive.key, id);
  return ctx.getSessionRow(id) ?? ctx.loadSessionRow(id);
}

/** Answer whatever is left of the depth check with the story plan, then build the lesson. */
async function finishDive(ctx, dive, row) {
  const id = normId(row.id);
  const done = new Set((row.answered ?? []).map((a) => String(a.questionId)));
  for (const [qi, qq] of (row.questions ?? []).entries()) {
    ctx.check();
    if (done.has(String(qq.id))) continue;
    const mode = dive.plan[qi] ?? 'right';
    const choice = mode === 'noidea' ? -1 : mode === 'wrong' ? distractorIndex(qq) : qq.correctIndex;
    await ctx.api(`/api/sessions/${id}/answer`, { method: 'POST', body: { questionId: qq.id, choice } });
  }
  await ctx.api(`/api/sessions/${id}/build-lesson`, { method: 'POST' });
  const built = ctx.getSessionRow(id) ?? (await ctx.loadSessionRow(id));
  rememberLesson(ctx, dive, built);
  return built;
}

/** Put a patched copy of the row back on the server (demo restore route) and refresh the cache. */
async function restoreRow(ctx, row, patch) {
  const id = normId(row.id);
  await ctx.api('/api/demo/restore', { method: 'POST', body: { row: { ...row, ...patch } } });
  return ctx.loadSessionRow(id);
}

/**
 * The story dive, in 'lesson' status with no dive log yet.
 * fresh: reset the lesson to the one first built (drops Lulu's steps).
 * withLulu: make sure Lulu's routing steps are in (asks her through the API).
 */
async function ensureLessonRow(ctx, dive, { fresh = true, withLulu = false } = {}) {
  let row = await findDiveRow(ctx, dive);
  if (!row) row = await createDive(ctx, dive);
  if (!row.lesson?.steps?.length) row = await finishDive(ctx, dive, row);
  const pristine = pristineLesson(ctx, dive, row);
  if (!ctx.recall(`${dive.key}:lesson`, null) || normId(ctx.recall(`${dive.key}:lesson`).id) !== normId(row.id)) {
    ctx.remember(`${dive.key}:lesson`, { id: normId(row.id), lesson: pristine });
  }
  const patch = {};
  if (row.status !== 'lesson') patch.status = 'lesson';
  if (row.summary) patch.summary = null;
  if (fresh && row.lesson.steps.length !== pristine.steps.length) patch.lesson = pristine;
  if (Object.keys(patch).length) row = await restoreRow(ctx, row, patch);
  if (withLulu && dive.lulu && !row.lesson.steps.some((s) => LULU_TYPES.includes(blockTypeOf(s)))) {
    const at = row.lesson.steps.findIndex((s) => blockTypeOf(s) === 'pattern-explorer');
    await ctx.api(`/api/sessions/${normId(row.id)}/tutor`, {
      method: 'POST', body: { messages: [{ role: 'user', content: LULU_ASK }], stepIndex: Math.max(0, at) },
    });
    row = ctx.getSessionRow(normId(row.id)) ?? (await ctx.loadSessionRow(normId(row.id)));
  }
  ctx.remember(dive.key, normId(row.id));
  return row;
}

/* ------------------------------------------------------------------ lesson navigation */

/** Pick the correct option of the check on screen. */
async function answerCheck(ctx, s, { drive = false } = {}) {
  const row = await rowFor(ctx);
  const question = row?.lesson?.steps?.[s.i]?.block?.question;
  const idx = Number.isInteger(question?.correctIndex) ? question.correctIndex : 0;
  if (drive) await driveCheck(ctx, s.el, idx);
  else await ctx.click(`@check-option[data-idx="${idx}"]`, { within: s.el });
  await ctx.find('.answer-explain', { within: s.el, timeout: 5000 });
}

/** Walk to lesson step `target`: Next/Previous for one hop, the dive rail for longer jumps. */
async function gotoStep(ctx, target, { rail = true } = {}) {
  for (let hop = 0; hop < 24; hop++) {
    ctx.check();
    const s = await ctx.waitFor(stepInfo, { timeout: 15000, label: 'the lesson step' });
    if (s.i === target) return s;
    if (target < 0 || target >= s.n) throw new Error(`the lesson has no step ${target + 1}`);
    const far = Math.abs(target - s.i) > 1;
    if (far && rail && ctx.exists(`@rail-stop[data-idx="${target}"]`)) {
      await ctx.click(`@rail-stop[data-idx="${target}"]`);
    } else if (target > s.i) {
      if (s.kind === 'check' && !s.answered) await answerCheck(ctx, s);
      await ctx.click('@step-next[data-last="false"]', { within: s.el });
    } else {
      await ctx.click('@step-prev', { within: s.el });
    }
    await ctx.waitFor(() => {
      const n = stepInfo();
      return n && n.el !== s.el ? n : null;
    }, { timeout: 8000, label: 'the next lesson step' });
  }
  throw new Error(`could not reach lesson step ${target + 1}`);
}

/** Index of the step a lesson beat is about: here if it matches, else the next one of that type. */
function targetIndex(steps, type, from) {
  if (blockTypeOf(steps[from]) === type) return from;
  for (let j = from + 1; j < steps.length; j++) if (blockTypeOf(steps[j]) === type) return j;
  return steps.findIndex((s) => blockTypeOf(s) === type);
}

/** Lesson stage of the dive on screen (waits briefly for it). */
async function lessonRow(ctx) {
  await ctx.waitStage('lesson', { timeout: 8000 });
  await ctx.waitFor(stepInfo, { timeout: 8000, label: 'the lesson step' });
  return rowFor(ctx);
}

const flowBuilt = (root) => Array.from(root.querySelectorAll('.fb-node')).some((n) => /policy check/i.test(n.textContent));

/** One lesson beat: advance to the step (Next) and drive its block. */
async function lessonBeat(ctx, story, spec) {
  const row = await lessonRow(ctx);
  const steps = row.lesson.steps;
  const here = stepInfo();
  const target = targetIndex(steps, spec.type, here.i);
  if (target < 0) {
    ctx.log(`this lesson has no ${spec.type} step — skipped`, 'warn');
    return;
  }
  const moved = target !== here.i;
  const s = await gotoStep(ctx, target);
  await ctx.wait(moved ? 520 : 200); // the new step slides in and scrolls under the nav

  if (spec.type === 'check') {
    if (s.answered) return;
    await answerCheck(ctx, s, { drive: true });
    await ctx.wait(900);
    return;
  }

  const root = await ctx.find(`[data-block="${spec.type}"]`, { within: s.el, timeout: 8000 });
  const opts = { type: spec.type, step: steps[target], stepIndex: target, session: row, story, part: spec.part };
  if (spec.part === 'run' && !flowBuilt(root)) {
    ctx.log('the flow was reset — rebuilding it quickly first', 'warn');
    await ctx.fast(() => driveBlock(ctx, root, { ...opts, part: 'build' }));
  }
  await driveBlock(ctx, root, opts);
}

/** Back from a lesson beat: stand on the step before it, so the next press replays it. */
async function undoLessonBeat(ctx, story, spec) {
  await clearOverlays(ctx);
  const row = await lessonRow(ctx);
  const steps = row.lesson.steps;
  const target = steps.findIndex((s) => blockTypeOf(s) === spec.type);
  if (target < 0) return;
  if (spec.part === 'run') {
    // back to "built, not run yet": fresh flow step, rebuilt at speed
    const s = stepInfo();
    if (s.i === target) await gotoStep(ctx, target - 1);
    const t = await gotoStep(ctx, target);
    const root = await ctx.find('[data-block="flow-builder"]', { within: t.el, timeout: 8000 });
    await ctx.fast(() => driveBlock(ctx, root, {
      type: 'flow-builder', step: steps[target], stepIndex: target, session: row, story, part: 'build',
    }));
    return;
  }
  if (target === 0) {
    await openSession(ctx, row.id);
    await ctx.waitFor(stepInfo, { timeout: 8000, label: 'the lesson step' });
    await ctx.scrollTop();
    return;
  }
  await gotoStep(ctx, target - 1);
}

function lessonBeats(story, specs) {
  return specs.map((spec) => ({
    title: spec.title,
    timeout: spec.timeout,
    run: (ctx) => lessonBeat(ctx, story, spec),
    undo: (ctx) => undoLessonBeat(ctx, story, spec),
  }));
}

/* ------------------------------------------------------------------ Lulu */

async function luluBeat(ctx) {
  const dive = DIVES.dive1;
  let row = await lessonRow(ctx);
  const pristine = pristineLesson(ctx, dive, row);
  if (row.lesson.steps.length !== pristine.steps.length) {
    ctx.log('the lesson already has Lulu’s steps — resetting it first', 'warn');
    row = await restoreRow(ctx, row, { lesson: pristine });
    await openSession(ctx, row.id);
  }
  const at = row.lesson.steps.findIndex((s) => blockTypeOf(s) === 'pattern-explorer');
  const before = await gotoStep(ctx, Math.max(0, at));
  await driveTutor(ctx, LULU_ASK);
  // the app jumps to the first inserted step; its rail stops flash for 3 s
  await ctx.waitFor(() => {
    const n = stepInfo();
    return n && n.n > before.n && n.i === before.i + 1 ? n : null;
  }, { timeout: 25000, label: 'Lulu to add her steps' });
  if (ctx.exists('@tutor-panel')) await ctx.click('@tutor-close');
  await ctx.wait(700);
}

async function undoLulu(ctx) {
  const dive = DIVES.dive1;
  await clearOverlays(ctx);
  let row = await lessonRow(ctx);
  const pristine = pristineLesson(ctx, dive, row);
  if (row.lesson.steps.length !== pristine.steps.length) {
    row = await restoreRow(ctx, row, { lesson: pristine });
    await openSession(ctx, row.id);
  }
  const at = row.lesson.steps.findIndex((s) => blockTypeOf(s) === 'pattern-explorer');
  await gotoStep(ctx, Math.max(0, at));
}

/* ------------------------------------------------------------------ dive start, map, quiz */

/** Home → type the goal → Dive in → the agent's checklist → the knowledge map. */
async function startDive(ctx, dive) {
  if (ctx.exists('@happy-explore')) {
    await ctx.click('@happy-explore');
  } else if (!ctx.exists('@ask-input')) {
    await clearOverlays(ctx);
    await ctx.click('@nav-dive');
  }
  await ctx.find('@ask-input', { timeout: 15000 });
  await ctx.wait(300);
  await ctx.type('@ask-input', dive.goal, { cps: 21, clear: true });
  await ctx.wait(280);
  await ctx.click('@ask-submit');
  await ctx.find('@compiling', { timeout: 6000 });
  await ctx.waitFor(() => /^#\/session\//.test(window.location.hash), { timeout: 60000, label: 'the dive to open' });
  await ctx.waitStage('map', { timeout: 30000 });
  ctx.remember(dive.key, normId(ctx.sessionId()));
  ctx.remember(`${dive.key}:lesson`, null);
  await ctx.find('@concept-toggle', { timeout: 8000 });
  await settleAnimations(ctx, '[data-demo="concept-toggle"]', 3500);
  await ctx.wait(250);
}

/** Open 2 must-know and 1 need-to-know concepts, then point at the CTA. */
async function mapTour(ctx) {
  await ctx.waitStage('map', { timeout: 8000 });
  await settleAnimations(ctx, '[data-demo="concept-toggle"]', 3000);
  const must = ctx.findAll('@concept-toggle[data-col="must"]');
  const need = ctx.findAll('@concept-toggle[data-col="need"]');
  const picks = [must[0], must[1], need[0]].filter(Boolean);
  for (const el of picks) {
    if (el.getAttribute('aria-expanded') !== 'true') await ctx.click(el, { dwell: 300 });
    await ctx.wait(950); // the detail slides open (0.45 s), then a beat to read it
  }
  await ctx.spotlight('@map-cta', { hold: 900 });
}

async function undoMapTour(ctx) {
  await ctx.waitStage('map', { timeout: 8000 });
  for (const el of ctx.findAll('@concept-toggle')) {
    if (el.getAttribute('aria-expanded') === 'true') await ctx.click(el, { spot: false, dwell: 80, hold: 60, settle: 40 });
  }
  await ctx.scrollTop();
}

/** A lighter tour for dive 2: glance over both columns, point at the CTA. */
async function mapGlance(ctx) {
  const must = ctx.findAll('@concept-toggle[data-col="must"]');
  const need = ctx.findAll('@concept-toggle[data-col="need"]');
  if (must[0]) await ctx.hover(must[0], { hold: 450, spot: true });
  if (need[0]) await ctx.hover(need[0], { hold: 450, spot: true });
  ctx.unhover();
  await ctx.spotlight('@map-cta', { hold: 650 });
}

/** Answer the question on screen the way the plan says (a hover or two first). */
async function answerCurrent(ctx, dive, qEl, pace) {
  const row = await rowFor(ctx);
  const index = Number(qEl.dataset.index);
  const qq = row.questions.find((x) => String(x.id) === qEl.dataset.qid) ?? row.questions[index];
  if (!qq) throw new Error('this question is not in the session row');
  const mode = dive.plan[index] ?? 'right';
  const key = qq.correctIndex;
  const alt = distractorIndex(qq);
  const opt = (i) => `@quiz-option[data-idx="${i}"]`;
  await ctx.wait(pace.lead);
  if (mode === 'noidea') {
    await ctx.hover(opt(alt), { within: qEl, hold: pace.hover });
    if (pace.hover2) await ctx.hover(opt(key), { within: qEl, hold: pace.hover2 });
    await ctx.click('@quiz-noidea', { within: qEl });
  } else {
    const pick = mode === 'right' ? key : alt;
    const tease = mode === 'right' ? alt : key; // hesitate on another option first
    await ctx.hover(opt(tease), { within: qEl, hold: pace.hover });
    if (pace.hover2 && mode === 'right') {
      const other = [0, 1, 2, 3].find((i) => i !== key && i !== alt && i < qq.options.length);
      if (other != null) await ctx.hover(opt(other), { within: qEl, hold: pace.hover2 });
    }
    await ctx.click(opt(pick), { within: qEl });
  }
  await ctx.waitFor(() => qEl.isConnected && qEl.dataset.answered === 'true', { timeout: 10000, label: 'the answer to register' });
  await ctx.wait(pace.read); // the explanation is read
}

/** From the map or the quiz: answer questions up to index `last` (0-based) per the plan. */
async function quizThrough(ctx, dive, last, pace) {
  if (ctx.stage() === 'map') {
    await ctx.click('@map-cta');
    await ctx.waitStage('quiz');
  }
  if (ctx.stage() !== 'quiz') {
    ctx.log(`the depth check is already done (stage ${ctx.stage()}) — skipped`, 'warn');
    return;
  }
  for (;;) {
    ctx.check();
    const qEl = await ctx.find('@quiz', { timeout: 8000 });
    const i = Number(qEl.dataset.index);
    if (qEl.dataset.answered !== 'true') {
      if (i > last) return;
      await answerCurrent(ctx, dive, qEl, pace);
    }
    if (i >= last) return;
    await ctx.click('@quiz-next', { within: qEl });
    await ctx.waitFor(() => {
      const n = q('[data-demo="quiz"]');
      return n && n !== qEl ? n : null;
    }, { timeout: 6000, label: 'the next question' });
    await ctx.wait(pace.slide);
  }
}

/** Last question answered → Reveal my depth → the diver and the count-up land. */
async function revealDepth(ctx) {
  if (ctx.stage() === 'quiz') {
    await ctx.click('@quiz-reveal', { timeout: 6000 });
    await ctx.waitStage('reveal');
  }
  await ctx.waitStage('reveal', { timeout: 4000 });
  await ctx.find('@depth-readout[data-done="true"]', { timeout: 9000 });
  await ctx.wait(900); // zone pill + lede settle in
}

/** Reveal → Build my lesson → the checklist → lesson step 1. */
async function buildLesson(ctx, dive) {
  if (ctx.stage() === 'quiz') await revealDepth(ctx);
  if (ctx.stage() === 'reveal') {
    await ctx.click('@build-lesson');
  }
  await ctx.waitStage('lesson', { timeout: 40000 });
  const s = await ctx.waitFor(stepInfo, { timeout: 8000, label: 'lesson step 1' });
  if (s.i !== 0) await gotoStep(ctx, 0);
  rememberLesson(ctx, dive, ctx.getSessionRow(normId(ctx.sessionId())));
  await ctx.waitIdle({ timeout: 6000 });
}

/* undo helpers for the depth check: put the row back as it was, reopen the dive */

async function undoQuizTo(ctx, answeredCount) {
  const id = normId(ctx.sessionId());
  if (!id) return;
  const row = await rowFor(ctx, id);
  const answered = (row.answered ?? []).slice(0, answeredCount);
  const patch = { status: 'assessment', lesson: null, summary: null, answered };
  if (answered.length < (row.questions?.length ?? 6)) Object.assign(patch, { score: null, zone: null, depth: null });
  await restoreRow(ctx, row, patch);
  await openSession(ctx, id);
}

async function undoBuild(ctx) {
  const id = normId(ctx.sessionId());
  if (!id) return;
  const row = await rowFor(ctx, id);
  await restoreRow(ctx, row, { status: 'assessment', lesson: null, summary: null });
  await openSession(ctx, id);
  await revealDepth(ctx);
}

/* ------------------------------------------------------------------ surfacing */

/** The story dive's lesson on screen at its last step, check answered. */
async function enterLastStep(ctx, dive) {
  await ensureSignedIn(ctx);
  const s0 = stepInfo();
  const known = normId(ctx.recall(dive.key, null));
  if (ctx.stage() === 'lesson' && s0 && known && normId(ctx.sessionId()) === known && s0.i === s0.n - 1
    && (s0.kind !== 'check' || s0.answered)) {
    return; // already there
  }
  const row = await ensureLessonRow(ctx, dive, { fresh: false, withLulu: dive.lulu });
  await openSession(ctx, row.id);
  await ctx.waitStage('lesson', { timeout: 10000 });
  const s = await gotoStep(ctx, row.lesson.steps.length - 1);
  if (s.kind === 'check' && !s.answered) {
    await ctx.wait(300);
    await answerCheck(ctx, s);
  }
  await ctx.wait(200);
}

/** Last step → Surface → the dive log writes itself → its items land → Save to Projects. */
async function surfaceAndSave(ctx) {
  if (ctx.stage() === 'lesson') {
    const s = stepInfo();
    if (s && s.i !== s.n - 1) await gotoStep(ctx, s.n - 1);
    const last = stepInfo();
    if (last?.kind === 'check' && !last.answered) await answerCheck(ctx, last);
    await ctx.click('@step-next[data-last="true"]');
  }
  await ctx.waitStage('summary', { timeout: 8000 });
  await ctx.find('@summary[data-ready="true"]', { timeout: 30000 });
  await ctx.wait(300);
  await settleAnimations(ctx, '.log-cols li', 3500);
  await ctx.spotlight('.log-col.built', { hold: 900 });
  const save = await ctx.find('@summary-save');
  if (save.dataset.saved !== 'true') {
    await ctx.click(save);
    await ctx.find('@summary-save[data-saved="true"]', { timeout: 8000 });
  }
  await ctx.wait(800);
}

/** Rate the dive → Very happy → Send → the celebration. */
async function rateHappy(ctx) {
  if (ctx.stage() === 'summary') {
    await ctx.click('@summary-rate');
    await ctx.waitStage('feedback');
  }
  if (ctx.stage() === 'feedback') {
    await ctx.find('@face[data-rating="1"]', { timeout: 6000 });
    await ctx.wait(250);
    for (const r of [1, 2, 3, 4]) await ctx.hover(`@face[data-rating="${r}"]`, { hold: 170 });
    await ctx.click('@face[data-rating="5"]');
    await ctx.wait(450);
    await ctx.click('@feedback-send', { enabled: true });
  }
  await ctx.waitStage('happy', { timeout: 10000 });
  await ctx.find('@happy-explore', { timeout: 6000 });
  await ctx.wait(1400); // bubbles rise
}

async function undoRate(ctx, dive) {
  // back on the dive log: reopen the lesson (status back to 'lesson', log kept), surface again
  const id = normId(ctx.recall(dive.key, null) ?? ctx.sessionId());
  if (!id) return;
  const row = await tryLoadRow(ctx, id);
  if (!row) return;
  if (row.status !== 'lesson') await restoreRow(ctx, row, { status: 'lesson' });
  await openSession(ctx, id);
  await ctx.waitStage('lesson', { timeout: 8000 });
  const s = await gotoStep(ctx, (await rowFor(ctx, id)).lesson.steps.length - 1);
  if (s.kind === 'check' && !s.answered) await answerCheck(ctx, s);
  await ctx.click('@step-next[data-last="true"]');
  await ctx.find('@summary[data-ready="true"]', { timeout: 15000 });
}

/** Logbook: both new dives on top of the seeded history. */
async function showLogbook(ctx) {
  await clearOverlays(ctx);
  await ctx.click('@nav-logbook');
  const top = await ctx.find('@logbook-row', { timeout: 10000 });
  await ctx.waitIdle({ timeout: 6000 });
  await settleAnimations(ctx, '[data-demo="logbook-row"]', 3000);
  const rows = ctx.findAll('@logbook-row');
  const second = rows[1];
  await ctx.hover(top, { hold: 1100, spot: true });
  if (second) {
    await ctx.hover(second, { hold: 800, spot: true });
    await ctx.hover(top, { hold: 500 });
  }
}

/* ------------------------------------------------------------------ the show */

export const chapters = [
  {
    id: 'welcome',
    title: 'Welcome',
    // the front door: signed out, sign-in form at #/
    async enter(ctx) {
      await clearOverlays(ctx);
      await settleHome(ctx);
      const route = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      if (route === 'support' || route === 'admin') await ctx.navigate('/');
      await ctx.find('@signin-name, @nav-signout', { timeout: 15000, label: 'sign-in form or nav' });
      if (ctx.exists('@nav-signout')) await ctx.click('@nav-signout', { spot: false });
      await ctx.navigate('/');
      const name = await ctx.find('@signin-name', { timeout: 15000 });
      if (name.value) await ctx.clear(name, { instant: true });
      const email = await ctx.find('@signin-email');
      if (email.value) await ctx.clear(email, { instant: true });
      await ctx.scrollTop();
    },
    beats: [
      {
        title: 'Sign in as Faisal',
        async run(ctx) {
          if (ctx.exists('@nav-signout')) {
            await ctx.click('@nav-signout');
          }
          await signInForm(ctx);
          await ctx.waitIdle({ timeout: 6000 });
          await settleAnimations(ctx, '[data-demo="suggest-pill"]', 2500);
        },
      },
    ],
  },

  {
    id: 'dive1',
    title: 'Dive 1 · AI Agents',
    enter: ensureHome,
    beats: [
      {
        title: 'Type the goal, Dive in → knowledge map',
        timeout: 90000,
        run: (ctx) => startDive(ctx, DIVES.dive1),
      },
      {
        title: 'Tour the knowledge map',
        run: mapTour,
        undo: undoMapTour,
      },
      {
        title: 'Depth check: Q1 ✓, Q2 ✓, Q3 no idea',
        run: (ctx) => quizThrough(ctx, DIVES.dive1, 2, PACE_FULL),
        undo: (ctx) => undoQuizTo(ctx, 0),
      },
      {
        title: 'Q4 ✓, Q5 ✗, Q6 ✓ → Reveal my depth',
        async run(ctx) {
          await quizThrough(ctx, DIVES.dive1, 5, PACE_FULL);
          await revealDepth(ctx);
        },
        undo: (ctx) => undoQuizTo(ctx, 3),
      },
      {
        title: 'Build my lesson',
        timeout: 60000,
        run: (ctx) => buildLesson(ctx, DIVES.dive1),
        undo: undoBuild,
      },
    ],
  },

  {
    id: 'agents-lesson',
    title: 'Agents lesson',
    async enter(ctx) {
      await ensureSignedIn(ctx);
      const row = await ensureLessonRow(ctx, DIVES.dive1, { fresh: true });
      await openSession(ctx, row.id);
      await ctx.waitStage('lesson', { timeout: 10000 });
      await gotoStep(ctx, 0);
      await ctx.scrollTop();
    },
    beats: [
      ...lessonBeats('dive1', [
        { type: 'workflow-vs-agent', title: 'Workflow or agent? The inbox' },
        { type: 'agent-loop', title: 'The loop the assistant runs' },
        { type: 'pattern-explorer', title: 'Routing each email' },
      ]),
      {
        title: 'Ask Lulu: walk me through routing',
        timeout: 60000,
        run: luluBeat,
        undo: undoLulu,
      },
      ...lessonBeats('dive1', [
        { type: 'sequence', title: 'Lulu’s step: life of a support email' },
        { type: 'simulator', title: 'Lulu’s step: auto-send vs. human review' },
        { type: 'live-agent', title: 'Live agent works out the refund', timeout: 90000 },
        { type: 'guardrails', title: 'Guardrails before it touches a customer' },
        { type: 'flow-builder', part: 'build', title: 'Build the triage flow', timeout: 90000 },
        { type: 'flow-builder', part: 'run', title: 'Run the flow, save it', timeout: 90000 },
        { type: 'memory', title: 'What to remember across a thread' },
        { type: 'check', title: 'Check: which reply needs a human?' },
      ]),
    ],
  },

  {
    id: 'surface1',
    title: 'Surface',
    enter: (ctx) => enterLastStep(ctx, DIVES.dive1),
    beats: [
      {
        title: 'Surface → dive log → Save to Projects',
        timeout: 60000,
        run: surfaceAndSave,
      },
      {
        title: 'Rate the dive: very happy',
        run: rateHappy,
        undo: (ctx) => undoRate(ctx, DIVES.dive1),
      },
    ],
  },

  {
    id: 'dive2',
    title: 'Dive 2 · Neural Networks',
    enter: ensureHome,
    beats: [
      {
        title: 'Type the goal, Dive in → knowledge map',
        timeout: 90000,
        async run(ctx) {
          await startDive(ctx, DIVES.dive2);
          await mapGlance(ctx);
        },
      },
      {
        title: 'Depth check: Q1 ✓, Q2 ✗, Q3 ✓',
        run: (ctx) => quizThrough(ctx, DIVES.dive2, 2, PACE_BRISK),
        undo: (ctx) => undoQuizTo(ctx, 0),
      },
      {
        title: 'Q4 no idea, Q5 ✓, Q6 ✗ → Reveal',
        auto: true, // one press runs the whole brisk depth check
        async run(ctx) {
          await quizThrough(ctx, DIVES.dive2, 5, PACE_BRISK);
          await revealDepth(ctx);
        },
        undo: (ctx) => undoQuizTo(ctx, 3),
      },
      {
        title: 'Build my lesson',
        timeout: 60000,
        run: (ctx) => buildLesson(ctx, DIVES.dive2),
        undo: undoBuild,
      },
    ],
  },

  {
    id: 'nn-lesson',
    title: 'Neural Networks lesson',
    async enter(ctx) {
      await ensureSignedIn(ctx);
      const row = await ensureLessonRow(ctx, DIVES.dive2, { fresh: true });
      await openSession(ctx, row.id);
      await ctx.waitStage('lesson', { timeout: 10000 });
      await gotoStep(ctx, 0);
      await ctx.scrollTop();
    },
    beats: lessonBeats('dive2', [
      { type: 'neuron', title: 'One neuron: weights and bias' },
      { type: 'forwardpass', title: 'A signal through a 2-3-1 network' },
      { type: 'loss-surface-3d', title: 'The landscape training walks down' },
      { type: 'backprop', title: 'Sending the error backwards' },
      { type: 'nn-playground', title: 'Train a real network, live', timeout: 90000 },
      { type: 'check', title: 'Check: which way does a weight move?' },
    ]),
  },

  {
    id: 'finish',
    title: 'Finish',
    enter: (ctx) => enterLastStep(ctx, DIVES.dive2),
    beats: [
      {
        title: 'Surface → dive log → Save to Projects',
        timeout: 60000,
        run: surfaceAndSave,
      },
      {
        title: 'Logbook: both new dives on top',
        run: showLogbook,
      },
    ],
  },
];
