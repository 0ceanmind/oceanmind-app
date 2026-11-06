/**
 * Self-test for the replay corpus: runs EVERY variant the demo can ask for
 * through the real validators (sanitizeBlock/validateSteps from generate.js,
 * compileExpr from the client's mathExpr.js, the real agent tools) plus the
 * exact per-task rules the routes enforce, and a few stricter demo rules.
 *
 *   node server/demo/replay/check-corpus.mjs          # summary
 *   node server/demo/replay/check-corpus.mjs --verbose # every case
 *
 * Exits 1 when anything fails. Warnings are printed but don't fail the run.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const VERBOSE = process.argv.includes('--verbose');

const gen = await imp('server/lib/generate.js');
const { sanitizeBlock } = gen;
const realValidateSteps = typeof gen.validateSteps === 'function' ? gen.validateSteps : null;
const { compileExpr } = await imp('client/src/lessons/blocks/mathExpr.js');
const { runTool } = await imp('server/lib/agentTools.js');

const CORPUS = {
  'ai-agents': (await import('./ai-agents.js')).default,
  'neural-networks': (await import('./neural-networks.js')).default,
  chatbots: (await import('./chatbots.js')).default,
};

/* ------------------------------------------------ bookkeeping */

let cases = 0;
const failures = [];
const warnings = [];
function fail(where, msg) { failures.push(`${where}: ${msg}`); }
function warn(where, msg) { warnings.push(`${where}: ${msg}`); }
function done(where) {
  cases++;
  if (VERBOSE) console.log(`  ok  ${where}`);
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** Deep equality that ignores key order and undefined-valued keys (JSON semantics). */
function sameJson(a, b) {
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]));
    }
    return v;
  };
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** Call fn twice on deep copies: the result must be identical and the ctx untouched. */
function callPure(where, fn, ctx) {
  const before = clone(ctx ?? {});
  const a = fn(clone(before));
  const b = fn(clone(before));
  const argCopy = clone(before);
  fn(argCopy);
  if (!sameJson(argCopy, before)) fail(where, 'function mutated its ctx argument');
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(where, 'not deterministic: two calls with the same ctx differ');
  return a;
}

const BANNED = /\b(mock|lorem|ipsum|todo|fixme|undefined|NaN)\b|\[object|null\b/i;
/** Every string in the output must be free of placeholder junk and single-asterisk italics (Md can't render them). */
function scanStrings(where, value, { markdown = false } = {}) {
  const visit = (v, p) => {
    if (typeof v === 'string') {
      if (BANNED.test(v)) fail(where, `placeholder/junk text at ${p}: "${v.match(BANNED)[0]}" in "${v.slice(0, 80)}"`);
      // only prose fields go through Md; expressions and labels are not markdown
      const md = markdown && /\.(body|reply|final)$|^\$$/.test(p);
      if (md && /(^|[^*])\*(?!\*)[^*\n]+\*(?!\*)/.test(v.replace(/\*\*[^*]+\*\*/g, ''))) fail(where, `single-asterisk italics at ${p} (Md renders only **bold**)`);
      if (md && (v.match(/\*\*/g) ?? []).length % 2) fail(where, `unbalanced ** at ${p}`);
      if (md && v.split('**').some((seg, i) => i % 2 === 1 && (!seg || /^\s|\s$/.test(seg)))) fail(where, `bold text with edge spaces at ${p}`);
      if (/\S {2,}\S/.test(v) && !/```/.test(v)) warn(where, `double space at ${p}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, `${p}.${k}`);
  };
  visit(value, '$');
}

/* ------------------------------------------------ validators (exact copies of the server rules) */

/** generate.js validateSteps, re-implemented verbatim (it also sanitizes blocks in place). */
function validateStepsCopy(steps, topicId, { min = 4, max = 10, minInteractive = null } = {}) {
  if (!Array.isArray(steps) || steps.length < min || steps.length > max) return `steps must have ${min}-${max} items`;
  let interactive = 0;
  for (const s of steps) {
    if (typeof s?.title !== 'string' || !s.title) return 'each step needs a title';
    if (typeof s?.body !== 'string' || !s.body) return 'each step needs a body';
    if (s.body.length > 900) s.body = `${s.body.slice(0, 880)}…`;
    if (s.block !== undefined) {
      const fixed = sanitizeBlock(s.block, topicId);
      if (fixed) s.block = fixed;
      else delete s.block;
    }
    if (s.block && s.block.type !== 'check') interactive++;
  }
  const needed = minInteractive ?? Math.max(1, Math.floor(steps.length / 3));
  if (interactive < needed) return `too few working interactive blocks (${interactive}) — include at least ${Math.ceil(steps.length / 2)} valid ones from the catalog`;
  return null;
}

/** generate.js compileKnowledgeMap validator. */
function validateMap(j) {
  if (!Array.isArray(j?.mustKnow) || j.mustKnow.length < 3 || j.mustKnow.length > 6) return 'mustKnow must have 3-6 items';
  if (!Array.isArray(j?.needToKnow) || j.needToKnow.length < 2 || j.needToKnow.length > 6) return 'needToKnow must have 2-6 items';
  for (const c of [...j.mustKnow, ...j.needToKnow]) {
    if (typeof c?.name !== 'string' || typeof c?.desc !== 'string' || !c.name || !c.desc) return 'each concept needs name and desc strings';
    if (c.desc.length > 160) return 'concept desc must stay under 160 characters';
  }
  return null;
}

/** generate.js generateQuestions validator. */
function validateQuestions(j) {
  if (!Array.isArray(j) || j.length !== 6) return 'must be an array of exactly 6 questions';
  for (const q of j) {
    if (typeof q?.text !== 'string' || !q.text) return 'each question needs text';
    if (q.text.length > 120) return 'question text too long — max 120 characters, keep it brief';
    if (typeof q?.concept !== 'string') return 'each question needs a concept';
    if (!Array.isArray(q?.options) || q.options.length !== 4) return 'each question needs exactly 4 options';
    if (q.options.some((o) => typeof o !== 'string' || o.length > 70)) return 'options must be strings under 70 characters';
    if (!Number.isInteger(q?.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return 'correctIndex must be 0-3';
    if (typeof q?.explanation !== 'string' || !q.explanation) return 'each question needs an explanation';
  }
  return null;
}

/** generate.js generateSummary validator. */
function validateSummary(j) {
  if (typeof j?.headline !== 'string' || !j.headline || j.headline.length > 120) return 'needs a headline under 120 chars';
  for (const k of ['learned', 'built', 'nextSteps']) {
    if (!Array.isArray(j?.[k]) || j[k].length < 2 || j[k].length > 5) return `${k} needs 2-5 items`;
    if (j[k].some((x) => typeof x !== 'string' || !x || x.length > 140)) return `${k} items must be short strings (max 140 chars)`;
  }
  return null;
}

/** generate.js tutorDecide validator. */
function validateTutor(j) {
  if (!['answer', 'expand', 'redesign'].includes(j?.action)) return 'action must be answer|expand|redesign';
  if (typeof j?.reply !== 'string' || !j.reply) return 'needs reply';
  if (j.action === 'expand' && typeof j.about !== 'string') return 'expand needs about';
  if (j.action === 'redesign' && typeof j.goal !== 'string') return 'redesign needs goal';
  return null;
}

/** app.js /api/agent/step validator. */
function validateAgentStep(j) {
  if (typeof j?.thought !== 'string') return 'needs thought';
  if (j?.done === true) return typeof j.final === 'string' && j.final ? null : 'done needs final';
  if (!j?.action?.tool || typeof j.action.input === 'undefined') return 'needs action {tool, input}';
  return null;
}

/* ------------------------------------------------ block-level demo rules */

const SAMPLES = 120; // SimulatorBlock samples 121 points across xRange

function simulatorPoints(fn, block, scope) {
  const [x0, x1] = block.xRange;
  let finite = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const x = x0 + (i / SAMPLES) * (x1 - x0);
    const y = fn({ ...scope, [block.xVar]: x });
    if (Number.isFinite(y)) { finite++; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  return { finite, lo, hi };
}

function checkSimulator(where, block) {
  let fn;
  try { fn = compileExpr(block.expr); } catch (e) { fail(where, `compileExpr("${block.expr}") threw: ${e.message}`); return; }
  if (!block.xVar) { fail(where, 'simulator without xVar (the demo always draws a curve)'); return; }
  const names = new Set((block.vars ?? []).map((v) => v.name));
  for (const id of block.expr.match(/[A-Za-z_]\w*/g) ?? []) {
    if (['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'tanh', 'sigmoid', 'relu', 'max', 'min', 'sign', 'pi', 'e'].includes(id)) continue;
    if (id !== block.xVar && !names.has(id)) fail(where, `identifier "${id}" in expr is neither xVar nor a var (it would silently evaluate to 0)`);
  }
  for (const v of block.vars ?? []) {
    if (v.name === 'e' || v.name === 'pi') fail(where, `var "${v.name}" is shadowed by the constant in mathExpr`);
    if (!(v.min <= v.init && v.init <= v.max)) fail(where, `var ${v.name} init ${v.init} outside [${v.min}, ${v.max}]`);
  }
  if (/\d[eE][-+]?\d/.test(block.expr)) fail(where, 'scientific notation in expr (mathExpr cannot parse it)');
  if (/(^|[^\d])\.\d/.test(block.expr)) fail(where, 'leading-dot decimal in expr (mathExpr mis-tokenizes it)');
  const init = Object.fromEntries((block.vars ?? []).map((v) => [v.name, v.init]));
  const scopes = [['init', init]];
  for (const v of block.vars ?? []) {
    scopes.push([`${v.name}=min`, { ...init, [v.name]: v.min }]);
    scopes.push([`${v.name}=max`, { ...init, [v.name]: v.max }]);
  }
  for (const [label, scope] of scopes) {
    const { finite, lo, hi } = simulatorPoints(fn, block, scope);
    if (finite < 2) fail(where, `simulator "${block.expr}" gives ${finite} finite points at ${label}`);
    else if (finite < SAMPLES + 1) warn(where, `simulator "${block.expr}" has ${SAMPLES + 1 - finite} non-finite samples at ${label}`);
    if (label === 'init' && finite >= 2 && hi - lo < 1e-9) fail(where, `simulator "${block.expr}" is flat at its initial values`);
  }
}

function checkBlock(where, block, topicId) {
  const fixed = sanitizeBlock(clone(block), topicId);
  if (!fixed) { fail(where, `sanitizeBlock DROPPED block type "${block?.type}"`); return; }
  if (!sameJson(fixed, block)) fail(where, `sanitizeBlock CHANGED the block: ${JSON.stringify(block).slice(0, 160)} → ${JSON.stringify(fixed).slice(0, 160)}`);
  if (block.type === 'sequence') {
    if (block.stages.length < 2 || block.stages.length > 8) fail(where, `sequence needs 2-8 stages, has ${block.stages.length}`);
    for (const s of block.stages) {
      if (s.label.length > 16) fail(where, `sequence label "${s.label}" is ${s.label.length} chars (max 16)`);
      if (!s.detail) fail(where, `sequence stage "${s.label}" has no detail`);
      if (s.detail.length > 400) fail(where, `sequence detail over 400 chars ("${s.label}")`);
    }
  }
  if (block.type === 'simulator') checkSimulator(where, block);
  if (block.type === 'diagram') {
    if (block.nodes.length > 9) fail(where, 'diagram has more than 9 nodes');
    if (block.edges.length > 20) fail(where, 'diagram has more than 20 edges');
    for (const n of block.nodes) {
      if (!n.detail) warn(where, `diagram node "${n.label}" has no detail (dead click)`);
      if (n.label.length > 18) warn(where, `diagram label "${n.label}" is over 18 chars (truncated in the SVG)`);
    }
    const ids = new Set(block.nodes.map((n) => n.id));
    for (const e of block.edges) if (!ids.has(e.from) || !ids.has(e.to)) fail(where, `diagram edge ${e.from}→${e.to} points at a missing node`);
  }
  if (block.type === 'check') {
    const q = block.question;
    if (q.options.length < 3 || q.options.length > 4) fail(where, `check needs 3-4 options, has ${q.options.length}`);
    if (!q.explanation) fail(where, 'check has no explanation');
    if (new Set(q.options).size !== q.options.length) fail(where, 'check has duplicate options');
  }
  if (block.type === 'flow-builder' && block.goalHint && block.goalHint.length > 200) fail(where, 'flow-builder goalHint over 200 chars');
}

/** Validate a step list exactly as the server would, then the stricter demo rules. */
function checkSteps(where, steps, topicId, opts) {
  if (realValidateSteps) {
    const err = realValidateSteps(clone(steps), topicId, opts);
    if (err) fail(where, `REAL validateSteps: ${err}`);
  } else warn(where, 'generate.js does not export validateSteps; only the verbatim copy ran');
  const err2 = validateStepsCopy(clone(steps), topicId, opts);
  if (err2) fail(where, `validateSteps copy: ${err2}`);
  if (!Array.isArray(steps)) return;
  const nonCheck = steps.filter((s) => s.block && s.block.type !== 'check').length;
  const need = opts.minInteractive ?? Math.ceil(steps.length / 2);
  if (nonCheck < need) fail(where, `only ${nonCheck} non-check blocks, demo rule needs ≥ ${need} (ceil(steps/2))`);
  const titles = new Set();
  steps.forEach((s, i) => {
    const w = `${where} step ${i + 1} "${s.title}"`;
    if (typeof s.body === 'string' && s.body.length > 880) fail(w, `body is ${s.body.length} chars (max 880, else truncated)`);
    if (typeof s.body === 'string' && words(s.body) > 140) warn(w, `body is ${words(s.body)} words (aim ≤ 90-110)`);
    if (titles.has(s.title)) fail(w, 'duplicate step title in the lesson');
    titles.add(s.title);
    if (s.block) checkBlock(w, s.block, topicId);
    scanStrings(w, s, { markdown: true });
  });
}

/* ------------------------------------------------ fixtures */

const ZONES = ['sunlight', 'twilight', 'midnight'];
const STORY_AGENTS_GOAL = "I want to build an AI agent that answers my customers' support emails";
const STORY_NN_GOAL = 'Show me how a neural network actually learns';
const REFUND_GOAL = 'A customer was charged 3 times at 49.99 — work out the refund owed and note it for the team';
const SUGGESTED_GOALS = [ // client/src/lessons/AgentsLesson.jsx
  'Research what tools an AI agent needs and write a summary note',
  'Calculate a budget: venue 1200 + 80 people at 8 each, check it fits under 2000, note the result',
  'Find what the source documents say about guardrails and save the three key points as notes',
];
const STORY_EMAIL = 'Hi, my order #4471 arrived with a cracked lid. Can I get a replacement? — Maya';

const GOALS = {
  'ai-agents': [STORY_AGENTS_GOAL, 'Build a marketing agent for my company', 'I want an agent that researches competitors and writes a weekly report', 'I want to build a travel-planning assistant that books trips', 'Automate my team’s weekly status updates'],
  'neural-networks': [STORY_NN_GOAL, 'I want to classify photos of plants', 'How do language models like GPT learn?', 'Predict house prices from a few features'],
  chatbots: ['I want a support bot for my bakery', 'Build a chatbot that answers questions about our return policy'],
};

const GOALS_FOR_ZONE_CHECK = { 'ai-agents': STORY_AGENTS_GOAL, 'neural-networks': STORY_NN_GOAL, chatbots: null };

function missedVariants(topicId) {
  const names = CORPUS[topicId].questions.map((q) => q.concept);
  return [
    { label: 'none missed', missed: [], noIdea: [], known: names },
    { label: 'q3 no-idea + q5 wrong', missed: [names[2], names[4]], noIdea: [names[2]], known: names.filter((_, i) => i !== 2 && i !== 4) },
    { label: 'q4-q6 missed', missed: [names[3], names[4], names[5]], noIdea: [names[5]], known: names.slice(0, 3) },
    { label: 'all missed', missed: names, noIdea: names.slice(0, 3), known: [] },
    { label: 'unknown concept strings', missed: ['Some Concept Not On The Map', names[1]], noIdea: [], known: [] },
  ];
}

/* the server may hand over zone labels or prompt fragments instead of ids */
for (const [topicId, c] of Object.entries(CORPUS)) {
  const names = c.questions.map((q) => q.concept);
  const base = { missed: [names[2]], noIdea: [names[2]], goal: GOALS_FOR_ZONE_CHECK[topicId] };
  for (const [id, alias] of [['twilight', 'Twilight Zone'], ['midnight', 'Advanced'], ['sunlight', 'Sunlight']]) {
    const where = `${topicId} zone alias "${alias}"`;
    if (JSON.stringify(c.lesson({ ...base, zone: alias })) !== JSON.stringify(c.lesson({ ...base, zone: id }))) fail(where, 'lesson differs from the zone id');
    done(where);
  }
  const where = `${topicId} suffixed missed concept`;
  const l = c.lesson({ zone: 'twilight', missed: [`${names[2]} (said "no idea")`], noIdea: [] });
  if (!l.intro.toLowerCase().includes(names[2].toLowerCase().replace(/^the /, '').slice(0, 10))) fail(where, 'a "(said no idea)" suffix broke concept matching');
  done(where);
}

const SUPPORT = { supportNote: 'The learner found the pace too fast; rebuilt one zone shallower with more hands-on steps.', previousFeedback: 'rated 2/5, reasons: Too hard, Wasn’t helpful, note: "I got lost at the second step"' };

/* ------------------------------------------------ 1. knowledge maps + questions */

for (const [topicId, c] of Object.entries(CORPUS)) {
  const where = `${topicId} knowledgeMap`;
  const e1 = validateMap(clone(c.knowledgeMap));
  if (e1) fail(where, e1);
  if (c.knowledgeMap.mustKnow.length !== 4) fail(where, 'contract: exactly 4 mustKnow');
  if (c.knowledgeMap.needToKnow.length < 3 || c.knowledgeMap.needToKnow.length > 4) fail(where, 'contract: 3-4 needToKnow');
  for (const x of [...c.knowledgeMap.mustKnow, ...c.knowledgeMap.needToKnow]) if (x.desc.length > 110) warn(where, `desc for "${x.name}" is ${x.desc.length} chars (aim ≤ 110)`);
  scanStrings(where, c.knowledgeMap);
  done(where);

  const wq = `${topicId} questions`;
  const e2 = validateQuestions(clone(c.questions));
  if (e2) fail(wq, e2);
  const names = new Set([...c.knowledgeMap.mustKnow, ...c.knowledgeMap.needToKnow].map((x) => x.name));
  const concepts = c.questions.map((q) => q.concept);
  for (const q of c.questions) {
    if (!names.has(q.concept)) fail(wq, `concept "${q.concept}" is not a map name`);
    if (new Set(q.options).size !== 4) fail(wq, `duplicate options in "${q.text}"`);
  }
  if (new Set(concepts).size !== 6) fail(wq, 'the 6 questions must test 6 different concepts');
  const must = new Set(c.knowledgeMap.mustKnow.map((x) => x.name));
  if (!concepts.slice(0, 4).every((x) => must.has(x))) warn(wq, 'mustKnow concepts should come first');
  scanStrings(wq, c.questions);
  done(wq);
}

/* ------------------------------------------------ 2. lessons: topic × zone × variant × missed */

for (const [topicId, c] of Object.entries(CORPUS)) {
  for (const zone of ZONES) {
    for (const mv of missedVariants(topicId)) {
      const base = { zone, scorePct: 50, known: mv.known, missed: mv.missed, noIdea: mv.noIdea, goal: null, supportNote: null, previousFeedback: null, redesign: false };
      const variants = [['plain', base]];
      for (const g of GOALS[topicId]) {
        variants.push([`goal "${g.slice(0, 30)}"`, { ...base, goal: g }]);
        variants.push([`redesign "${g.slice(0, 30)}"`, { ...base, goal: g, redesign: true }]);
      }
      variants.push(['supportNote', { ...base, ...SUPPORT }]);
      variants.push(['supportNote + goal', { ...base, ...SUPPORT, goal: GOALS[topicId][0] }]);
      variants.push(['sparse ctx', { zone }]);
      for (const [vl, ctx] of variants) {
        const where = `${topicId} lesson ${zone} ${vl} [${mv.label}]`;
        const l = callPure(where, c.lesson, ctx);
        if (typeof l?.title !== 'string' || !l.title) fail(where, 'lesson needs a title');
        if (typeof l?.intro !== 'string' || !l.intro) fail(where, 'lesson needs an intro');
        if (l.intro && l.intro.length > 900) warn(where, `intro is ${l.intro.length} chars`);
        if (l.intro && /\*\*/.test(l.intro)) fail(where, 'intro is rendered as plain text; no **bold**');
        checkSteps(where, l.steps, topicId, { min: 4, max: 9 });
        if (ctx.goal && !l.intro.includes(ctx.goal.replace(/[.!?]+$/, '').slice(0, 40))) fail(where, 'intro does not quote the goal');
        for (const m of ctx.missed ?? []) {
          if (m.startsWith('Some Concept')) continue;
          const label = m.toLowerCase().replace(/^the /, '');
          if (!l.intro.toLowerCase().includes(label.slice(0, 12))) fail(where, `intro does not mention missed concept "${m}"`);
        }
        if (ctx.supportNote && !l.intro.includes('feedback')) fail(where, 'support rebuild intro does not acknowledge the feedback');
        scanStrings(where, { title: l.title, intro: l.intro });
        done(where);
      }
    }
  }
}

/* the pitch story's exact step order */
{
  const names = CORPUS['ai-agents'].questions.map((q) => q.concept);
  const l = CORPUS['ai-agents'].lesson({ zone: 'twilight', scorePct: 67, known: [], missed: [names[2], names[4]], noIdea: [names[2]], goal: STORY_AGENTS_GOAL, supportNote: null, previousFeedback: null, redesign: false });
  const types = l.steps.map((s) => s.block?.type ?? null);
  const want = ['workflow-vs-agent', 'agent-loop', 'pattern-explorer', 'live-agent', 'guardrails', 'flow-builder', 'memory', 'check'];
  if (JSON.stringify(types) !== JSON.stringify(want)) fail('STORY dive 1', `block order ${types.join(',')} ≠ ${want.join(',')}`);
  if (l.steps[2].block.initial !== 'routing') fail('STORY dive 1', 'step 3 pattern-explorer must start on routing');
  if (l.steps[5].block.template !== 'starter' || l.steps[5].block.goalHint !== STORY_EMAIL) fail('STORY dive 1', 'step 6 flow-builder must be starter with the Maya email');
  if (!/NEVER/.test(l.steps[7].block.question.text)) fail('STORY dive 1', 'step 8 check should ask which reply must never go out without a human');
  if (!l.steps[3].body.includes(REFUND_GOAL)) fail('STORY dive 1', 'step 4 must spell out the refund goal for the director');
  done('STORY dive 1 order');
}
{
  const names = CORPUS['neural-networks'].questions.map((q) => q.concept);
  const l = CORPUS['neural-networks'].lesson({ zone: 'twilight', scorePct: 50, known: names.slice(0, 3), missed: names.slice(3), noIdea: [], goal: STORY_NN_GOAL, supportNote: null, previousFeedback: null, redesign: false });
  const types = l.steps.map((s) => s.block?.type ?? null);
  const want = ['neuron', 'forwardpass', 'loss-surface-3d', 'backprop', 'nn-playground', 'check'];
  if (JSON.stringify(types) !== JSON.stringify(want)) fail('STORY dive 2', `block order ${types.join(',')} ≠ ${want.join(',')}`);
  done('STORY dive 2 order');
}

/* ------------------------------------------------ 3. expansions */

const ABOUTS = {
  'ai-agents': ['routing a support email step by step', 'the agent loop step by step', 'guardrails and human approval', 'memory in a long thread', 'how tool calls work', 'workflow vs agent', 'multi-agent orchestration', 'what it costs to run', 'how to test an agent', 'prompt injection', 'something completely unrelated', ''],
  'neural-networks': ['backprop step by step', 'the learning rate', 'gradient descent', 'activation functions', 'the loss function', 'vanishing gradients', 'weights and bias', 'the forward pass', 'overfitting', 'something completely unrelated', ''],
  chatbots: ['grounding and hallucination', 'fallback and escalation', 'conversation context', 'how intents are matched', 'something completely unrelated', ''],
};

for (const [topicId, c] of Object.entries(CORPUS)) {
  const lessonTitles = c.lesson({ zone: 'twilight', goal: GOALS[topicId][0], missed: [], noIdea: [] }).steps.map((s) => s.title);
  for (const zone of ZONES) {
    for (const about of ABOUTS[topicId]) {
      for (const existing of [lessonTitles, [...lessonTitles, ...c.expansion({ about, zone, goal: null, existingTitles: lessonTitles, usedBlockTypes: [] }).steps.map((s) => s.title)]]) {
        const ctx = { about, currentStepTitle: lessonTitles[2], zone, goal: GOALS[topicId][0], existingTitles: existing, usedBlockTypes: ['workflow-vs-agent', 'agent-loop'] };
        const where = `${topicId} expansion ${zone} "${about}"${existing.length > lessonTitles.length ? ' (asked twice)' : ''}`;
        const x = callPure(where, c.expansion, ctx);
        checkSteps(where, x?.steps, topicId, { min: 1, max: 3, minInteractive: 1 });
        for (const s of x?.steps ?? []) {
          if (existing.includes(s.title)) fail(where, `title "${s.title}" duplicates an existing step`);
          if (!s.block || s.block.type === 'check') warn(where, `step "${s.title}" has no interactive block`);
        }
        done(where);
      }
    }
  }
}
{
  const x = CORPUS['ai-agents'].expansion({ about: 'routing a support email step by step', currentStepTitle: 'Route each email to the right playbook', zone: 'twilight', goal: STORY_AGENTS_GOAL, existingTitles: [], usedBlockTypes: [] });
  const [a, b] = x.steps;
  if (x.steps.length !== 2 || a.block.type !== 'sequence' || b.block.type !== 'simulator') fail('STORY Lulu', 'routing expansion must be exactly sequence + simulator');
  if (a.block.stages.length < 5 || a.block.stages.length > 6) fail('STORY Lulu', 'Life of a support email needs 5-6 stages');
  if (b.block.expr !== 'sigmoid(k*(x - t))' || b.block.title !== 'Auto-send vs. human review') fail('STORY Lulu', 'simulator must be sigmoid(k*(x - t)) titled "Auto-send vs. human review"');
  done('STORY Lulu expansion');
}

/* ------------------------------------------------ 4. tutor */

const MESSAGES = [
  'Can you walk me through routing a support email step by step?',
  'explain backprop step by step',
  'Could you clarify how memory works?',
  'Can you break down the loss function in more detail?',
  'I want to build a marketing agent for my company',
  'my company sells shoes, can this help us?',
  "I'm building a helpdesk bot for our clinic",
  'How do I handle refunds safely?',
  'What tone should replies use?',
  'How much will this cost per month?',
  'Is it safe to let it send emails?',
  'What if it makes up an order number?',
  'Does it remember earlier messages?',
  'what is routing?',
  'How does tool calling work?',
  'when do I need an agent at all?',
  'how do I test it?',
  'should I use multiple agents?',
  'how do I connect it to Zendesk?',
  'what is a learning rate?',
  'why relu?',
  'what is overfitting',
  'what is an epoch?',
  'what is an intent?',
  'why did the bot fall back?',
  'thanks!',
  'hmm',
  'What is the capital of France?',
  '',
];

for (const [topicId, c] of Object.entries(CORPUS)) {
  const lesson = c.lesson({ zone: 'twilight', goal: GOALS[topicId][0], missed: [], noIdea: [] });
  for (const msg of MESSAGES) {
    for (const idx of [0, 2, lesson.steps.length - 1, 99]) {
      const where = `${topicId} tutor "${msg.slice(0, 40)}" @${idx}`;
      const t = callPure(where, c.tutor, { lastUserMessage: msg, lessonTitle: lesson.title, stepTitles: lesson.steps.map((s) => s.title), currentStepIndex: idx });
      const err = validateTutor(t);
      if (err) fail(where, err);
      if (t?.action === 'answer' && words(t.reply) > 100) fail(where, `answer is ${words(t.reply)} words (max 100)`);
      if (t?.action !== 'answer' && words(t?.reply) > 40) fail(where, `${t?.action} reply is ${words(t?.reply)} words (max 40)`);
      if (t?.action === 'expand' && !t.about.trim()) fail(where, 'empty about');
      if (t?.action === 'redesign' && (!t.goal.trim() || t.goal.length > 300)) fail(where, 'redesign goal empty or over 300 chars');
      scanStrings(where, t);
      done(where);
    }
  }
}
{
  const t = CORPUS['ai-agents'].tutor({ lastUserMessage: 'Can you walk me through routing a support email step by step?', lessonTitle: 'x', stepTitles: ['a', 'b', 'c'], currentStepIndex: 2 });
  if (t.action !== 'expand' || t.about !== 'routing a support email step by step') fail('STORY Lulu tutor', `expected expand/"routing a support email step by step", got ${JSON.stringify(t)}`);
  for (const m of ['How do I handle refunds safely?', 'What tone should replies use?', 'what is routing?', 'Is it safe to let it send emails?']) {
    if (CORPUS['ai-agents'].tutor({ lastUserMessage: m, lessonTitle: 'x', stepTitles: [], currentStepIndex: 0 }).action !== 'answer') fail('STORY Lulu tutor', `"${m}" should be a plain answer`);
  }
  if (CORPUS['ai-agents'].tutor({ lastUserMessage: 'I want to build a marketing agent for my company', lessonTitle: 'x', stepTitles: [], currentStepIndex: 0 }).action !== 'redesign') fail('STORY Lulu tutor', 'explicit "I want to build" must redesign');
  // keyword answers must not fire on substrings ("capital" ⊃ "api", "earlier" ⊃ "lie")
  for (const [t, m, re] of [
    ['ai-agents', 'What is the capital of France?', /outside this dive/],
    ['ai-agents', 'Does it remember earlier messages?', /summary/],
    ['ai-agents', 'Can I customise the tone?', /voice/],
    ['neural-networks', 'What is the capital of France?', /outside this dive/],
    ['chatbots', 'What is the capital of France?', /outside this dive/],
    ['chatbots', 'why did it reply earlier with the menu?', /^(?!.*Ground the model)/],
  ]) {
    const r = CORPUS[t].tutor({ lastUserMessage: m, lessonTitle: 'x', stepTitles: [], currentStepIndex: 0 });
    if (r.action !== 'answer' || !re.test(r.reply)) fail('Lulu keyword matching', `${t} "${m}" → ${r.reply.slice(0, 80)}`);
  }
  done('STORY Lulu tutor');
}

/* ------------------------------------------------ 5. summaries */

for (const [topicId, c] of Object.entries(CORPUS)) {
  for (const zone of ZONES) {
    for (const goal of [null, ...GOALS[topicId]]) {
      for (const mv of missedVariants(topicId)) {
        const l = c.lesson({ zone, goal, missed: mv.missed, noIdea: mv.noIdea });
        const exp = c.expansion({ about: ABOUTS[topicId][0], zone, goal, existingTitles: l.steps.map((s) => s.title), usedBlockTypes: [] });
        const stepLists = [
          l.steps,
          [...l.steps.slice(0, 3), ...exp.steps, ...l.steps.slice(3)],
          l.steps.slice(0, 2),
          [],
        ];
        for (const steps of stepLists) {
          const where = `${topicId} summary ${zone} goal=${goal ? `"${goal.slice(0, 20)}"` : 'none'} [${mv.label}] ${steps.length} steps`;
          const s = callPure(where, c.summary, { zone, scorePct: 67, missed: mv.missed, steps: steps.map((st) => ({ title: st.title, blockType: st.block?.type ?? null })), goal });
          const err = validateSummary(s);
          if (err) fail(where, err);
          if (s && (s.learned.length < 3 || s.built.length > 4 || s.nextSteps.length > 3)) fail(where, `contract counts: learned ${s.learned.length} (3-5), built ${s.built.length} (2-4), nextSteps ${s.nextSteps.length} (2-3)`);
          scanStrings(where, s);
          done(where);
        }
      }
    }
  }
}

/* ------------------------------------------------ 6. live agent: every goal × tool subset, with REAL tools */

const TOOLS = ['calculator', 'docsearch', 'notes', 'clock'];
const subsets = [];
for (let mask = 1; mask < 16; mask++) subsets.push(TOOLS.filter((_, i) => mask & (1 << i)));

const AGENT_GOALS = [
  REFUND_GOAL,
  ...SUGGESTED_GOALS,
  'Work out 15% of 240 and save it',
  'What does the source say about when to use multi-agent systems?',
  'Remind the team to review the refund queue',
  'A customer was charged twice at 20 — how much should we refund?',
  'Plan a picnic',
];

function runAgent(goal, tools, { firstLineOnly = false, actionShape = false } = {}) {
  const history = [];
  const agents = CORPUS['ai-agents'];
  for (let n = 0; n < 14; n++) {
    const passed = history.map((h) => {
      const obs = firstLineOnly ? h.observation.split('\n')[0] : h.observation;
      return actionShape ? { thought: h.thought, action: { tool: h.tool, input: h.input }, observation: obs } : { thought: h.thought, tool: h.tool, input: h.input, observation: obs };
    });
    const ctx = { goal, tools, stepNumber: n + 1, history: passed };
    const d = callPure(`agent "${goal.slice(0, 30)}" [${tools.join('+')}] step ${n + 1}`, agents.agentStep, ctx);
    const err = validateAgentStep(d);
    if (err) return { error: `step ${n + 1}: ${err}`, history };
    if (d.done) return { final: d.final, thought: d.thought, history };
    if (!tools.includes(d.action.tool)) return { error: `step ${n + 1}: used tool "${d.action.tool}" not in picked [${tools.join(', ')}]`, history };
    // exactly what app.js does: notes numbering continues from the history
    const notes = history.filter((h) => h.observation?.startsWith('Saved note')).map((h) => h.observation);
    const observation = runTool(d.action.tool, d.action.input, { topicId: 'ai-agents', notes });
    history.push({ thought: d.thought, tool: d.action.tool, input: String(d.action.input), observation });
  }
  return { error: 'never finished within 14 steps', history };
}

for (const goal of AGENT_GOALS) {
  for (const tools of subsets) {
    for (const mode of [{}, { firstLineOnly: true }, { actionShape: true }]) {
      const where = `agent "${goal.slice(0, 40)}" [${tools.join('+')}]${mode.firstLineOnly ? ' (first-line obs)' : ''}${mode.actionShape ? ' (action shape)' : ''}`;
      const r = runAgent(goal, tools, mode);
      if (r.error) { fail(where, r.error); continue; }
      const steps = r.history.length + 1;
      if (steps > 8) fail(where, `took ${steps} steps (sunlight budget is 8)`);
      for (const h of r.history) {
        if (/error|Unknown tool|crashed/i.test(h.observation) && h.tool !== 'docsearch') fail(where, `tool call ${h.tool}(${h.input}) failed: ${h.observation}`);
        if (/^No passages found/.test(h.observation)) warn(where, `docsearch "${h.input}" found nothing`);
      }
      if (words(r.final) > 120) warn(where, `final answer is ${words(r.final)} words`);
      scanStrings(where, { final: r.final, thought: r.thought, history: r.history.map((h) => ({ thought: h.thought, input: h.input })) });
      if (goal === REFUND_GOAL && tools.includes('calculator') && !mode.firstLineOnly) {
        const calc = r.history.filter((h) => h.tool === 'calculator').map((h) => h.observation);
        if (calc[0] !== '3 * 49.99 = 149.97' || calc[1] !== '149.97 - 49.99 = 99.98') fail(where, `refund arithmetic observations: ${JSON.stringify(calc)}`);
        if (!/99\.98/.test(r.final) || !/149\.97/.test(r.final)) fail(where, 'final must cite the real 149.97 and 99.98');
        if (tools.includes('notes')) {
          const note = r.history.find((h) => h.tool === 'notes');
          if (note?.input !== 'Refund 99.98 owed (charged 3x 49.99, 1 legitimate) — needs human approval before paying') fail(where, `refund note input was ${JSON.stringify(note?.input)}`);
          if (!/note #1/.test(r.final)) fail(where, 'final must mention the saved note #1');
        }
      }
      if (goal === SUGGESTED_GOALS[1] && tools.includes('calculator') && !mode.firstLineOnly) {
        if (r.history[0]?.observation !== '1200 + 80*8 = 1840') fail(where, `budget first observation: ${r.history[0]?.observation}`);
        if (!/1840/.test(r.final) || !/160/.test(r.final)) fail(where, 'budget final must cite 1840 and the 160 headroom');
      }
      if (goal === SUGGESTED_GOALS[2] && tools.includes('docsearch') && tools.includes('notes') && !mode.firstLineOnly) {
        const n = r.history.filter((h) => h.tool === 'notes').length;
        if (n !== 3) fail(where, `guardrails goal saved ${n} notes, expected 3`);
      }
      done(where);
    }
  }
}
if (VERBOSE) {
  for (const [goal, tools] of [[REFUND_GOAL, ['calculator', 'notes']], [SUGGESTED_GOALS[0], ['calculator', 'docsearch']], [SUGGESTED_GOALS[1], ['calculator', 'docsearch']], [SUGGESTED_GOALS[2], ['docsearch', 'notes']]]) {
    const r = runAgent(goal, tools);
    console.log(`\n--- agent: ${goal} [${tools.join('+')}]`);
    for (const h of r.history) console.log(`  THINK ${h.thought}\n  ACT   ${h.tool}(${h.input})\n  OBS   ${h.observation.split('\n')[0].slice(0, 140)}`);
    console.log(`  THINK ${r.thought}\n  FINAL ${r.final}`);
  }
}

/* ------------------------------------------------ 7. flow nodes (by template label), with real tool nodes */

const MARKETING_BRIEFS = [
  'Brief: Build a marketing agent for my company. 4-week launch, $5,000 budget, target 200 sign-ups.',
  'Launch "Reef Café" weekday lunch boxes for office workers nearby — 2-week push, $800 budget, 150 orders.',
  'Promote our new app TaskTide to small business owners, $5k, 6-week campaign, 300 signups',
];
const EMAILS = [
  STORY_EMAIL,
  'Hello, I was charged twice for order #5520 — I want my money back ASAP. Thanks, Omar',
  'Where is my package? Order 88123 still hasn’t arrived after two weeks.',
  'I can’t log in to my account, the password reset never comes. — Priya',
  'Hi, can I cancel order #7001 please? Sam',
  'Do you ship to Canada?',
];

function flowCheck(where, out, { maxChars = 1500 } = {}) {
  if (typeof out !== 'string' || !out.trim()) { fail(where, 'flow node output must be a non-empty string'); return; }
  if (words(out) > 150) fail(where, `output is ${words(out)} words (the node prompt says under 150)`);
  else if (words(out) > 120) warn(where, `output is ${words(out)} words (contract aims ≤ ~120)`);
  if (out.length > maxChars) fail(where, `output is ${out.length} chars (trace keeps 1500)`);
  if (out.length > 400) warn(where, `output is ${out.length} chars; the run panel shows the first 400`);
  scanStrings(where, out);
}

{
  const agents = CORPUS['ai-agents'];
  const node = (label, input, instruction = '') => callPure(`flow "${label}"`, agents.flowNode, { label, instruction, input });
  // the story flow: Trigger → Classify & draft → Policy check → Result
  for (const email of EMAILS) {
    const cd = node('Classify & draft', email, 'Answer the incoming request helpfully in 2-3 sentences.');
    flowCheck(`flow Classify & draft "${email.slice(0, 30)}"`, cd);
    const pc = node('Policy check', cd, 'Process the input and produce a useful result.');
    flowCheck(`flow Policy check after "${email.slice(0, 30)}"`, pc);
    const direct = node('Policy check', email);
    flowCheck(`flow Policy check (wired straight from trigger) "${email.slice(0, 30)}"`, direct);
    for (const l of ['Process', 'LLM step', 'Classify', 'Draft reply', 'Triage', 'Something else entirely']) flowCheck(`flow ${l} "${email.slice(0, 30)}"`, node(l, email, 'Process the input and produce a useful result.'));
    done(`flow story chain "${email.slice(0, 30)}"`);
  }
  {
    const cd = node('Classify & draft', STORY_EMAIL);
    if (!/Damaged item/.test(cd) || !/#4471/.test(cd) || !/Maya/.test(cd) || !/replacement/i.test(cd)) fail('STORY flow', `Classify & draft misses category/order/name/replacement: ${cd}`);
    const pc = node('Policy check', cd);
    if (!/OK to send/.test(pc) || !/damaged-item policy/.test(pc) || !/no refund/i.test(pc) || !/Human approval/.test(pc)) fail('STORY flow', `Policy check misses verdict/policy/no-refund/approval flag: ${pc}`);
    if (VERBOSE) console.log(`\n--- flow story\n  Classify & draft → ${cd}\n  Policy check → ${pc}`);
    done('STORY flow outputs');
  }
  // starter default + research + marketing templates, with the real docsearch tool node
  for (const q of ['When should I use a multi-agent system instead of a single agent?', 'What guardrails should an agent have?', 'I want an agent that researches competitors and writes a weekly report', 'zzz qqq']) {
    const passages = runTool('docsearch', q.slice(0, 400), { topicId: 'ai-agents', notes: [] });
    flowCheck(`flow Summarize "${q.slice(0, 30)}"`, node('Summarize', passages, 'Summarize the retrieved passages into 3 bullet points answering the question.'));
    flowCheck(`flow Search sources as LLM "${q.slice(0, 30)}"`, node('Search sources', q));
    flowCheck(`flow Process "${q.slice(0, 30)}"`, node('Process', q, 'Answer the incoming request helpfully in 2-3 sentences.'));
    done(`flow research "${q.slice(0, 30)}"`);
  }
  for (const brief of MARKETING_BRIEFS) {
    const aud = node('Audience analysis', brief, 'From this campaign brief, identify the target audience and their 3 main pain points.');
    const copy = node('Copywriter', brief, 'Write 2 short ad copy variants for this brief.');
    const plan = node('Campaign plan', `${aud}\n\n${copy}`, 'Combine the audience analysis and ad copy into a one-paragraph launch plan.');
    for (const [l, o] of [['Audience analysis', aud], ['Copywriter', copy], ['Campaign plan', plan]]) flowCheck(`flow ${l} "${brief.slice(0, 30)}"`, o);
    done(`flow marketing "${brief.slice(0, 30)}"`);
  }
  for (const [label, instruction, input] of [
    ['Translate', 'Translate this into Spanish', 'Hello, where is my order?'],
    ['Extract fields', 'Extract the name and order number', STORY_EMAIL],
    ['Sentiment', 'Rate the sentiment from 1 to 5', 'This is the third time I am asking!!'],
    ['My step', '', ''],
    ['Budget helper', 'Explain the result', '1200 + 80*8 = 1840'],
  ]) {
    flowCheck(`flow generic "${label}"`, node(label, input, instruction));
    done(`flow generic "${label}"`);
  }
}

/* ------------------------------------------------ 8. integration guide */

{
  const T = (arr) => arr.map((n) => ({ id: n.id, type: n.type, label: n.label, prompt: n.prompt ?? '', tool: n.tool ?? '' }));
  const flows = {
    starter: [T([{ id: 'n1', type: 'trigger', label: 'Incoming request' }, { id: 'n2', type: 'llm', label: 'Process', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' }, { id: 'n3', type: 'output', label: 'Result' }]), [['n1', 'n2'], ['n2', 'n3']]],
    story: [T([{ id: 'n1', type: 'trigger', label: 'Incoming request' }, { id: 'n2', type: 'llm', label: 'Classify & draft', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' }, { id: 'n101', type: 'llm', label: 'Policy check', prompt: 'Process the input and produce a useful result.' }, { id: 'n3', type: 'output', label: 'Result' }]), [['n1', 'n2'], ['n2', 'n101'], ['n101', 'n3']]],
    research: [T([{ id: 'n1', type: 'trigger', label: 'Research question' }, { id: 'n2', type: 'tool', label: 'Search sources', tool: 'docsearch' }, { id: 'n3', type: 'llm', label: 'Summarize', prompt: 'Summarize the retrieved passages into 3 bullet points answering the question.' }, { id: 'n4', type: 'output', label: 'Summary' }]), [['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4']]],
    marketing: [T([{ id: 'n1', type: 'trigger', label: 'Campaign brief' }, { id: 'n2', type: 'llm', label: 'Audience analysis', prompt: 'From this campaign brief, identify the target audience and their 3 main pain points.' }, { id: 'n3', type: 'llm', label: 'Copywriter', prompt: 'Write 2 short ad copy variants for this brief.' }, { id: 'n4', type: 'llm', label: 'Campaign plan', prompt: 'Combine the audience analysis and ad copy into a one-paragraph launch plan.' }, { id: 'n5', type: 'output', label: 'Launch plan' }]), [['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5']]],
    tiny: [T([{ id: 'n1', type: 'trigger', label: 'Trigger' }]), []],
  };
  for (const [name, [nodes, wires]] of Object.entries(flows)) {
    const where = `integrationGuide ${name}`;
    const g = callPure(where, CORPUS['ai-agents'].integrationGuide, { nodes, wires });
    if (typeof g !== 'string' || !g.trim()) { fail(where, 'must be a non-empty string'); continue; }
    if (words(g) > 300) fail(where, `${words(g)} words (max 300)`);
    const fences = g.split('```');
    for (let i = 1; i < fences.length; i += 2) if (fences[i].trim().split('\n').length > 11) fail(where, 'code fence longer than 10 lines');
    for (const n of nodes) if (!g.includes(n.label)) fail(where, `guide does not mention node "${n.label}"`);
    if (!/\*\*/.test(g) || !/^- /m.test(g)) fail(where, 'guide needs **bold** and "- " bullets');
    scanStrings(where, g.replace(/```[\s\S]*?```/g, ''));
    if (VERBOSE && name === 'story') console.log(`\n--- integration guide (story)\n${g}`);
    done(where);
  }
}

/* ------------------------------------------------ 9. chatbot LLM compare (generic chat) */

{
  const BASIC = [
    { name: 'greeting', reply: 'Hi there! I’m the Reef Café bot 🐠 Ask me about hours, menu, or bookings.' },
    { name: 'hours', reply: 'We’re open 8:00–22:00 every day, kitchen closes at 21:30.' },
    { name: 'menu', reply: 'Today’s highlights: grilled sea bass, kelp noodle bowl (vegan), and coral-berry cheesecake.' },
  ];
  const EXTENDED = [
    ...BASIC,
    { name: 'booking', reply: 'I can hold a table for you! Call 555-REEF or book online at reefcafe.example.' },
    { name: 'location', reply: 'We’re at 12 Harbor Walk, right by the pier. Free parking after 18:00.' },
  ];
  const WITH_REFUNDS = [...BASIC, { name: 'refunds', reply: 'Refunds go back to your card within 3–5 working days — just show your receipt at the counter.' }];
  const WITH_WIFI = [...BASIC, { name: 'wifi', reply: 'Free wifi! The network is ReefGuest, password coral2026.' }];
  const expect = [
    [BASIC, 'Do you have anything plant-based?', /kelp noodle bowl/],
    [BASIC, 'any vegetarian dishes?', /kelp noodle bowl/],
    [BASIC, 'Can I get a refund?', /not sure/i],
    [BASIC, 'I was overcharged, I want my money back', /not sure/i],
    [WITH_REFUNDS, 'Can I get a refund?', /3–5 working days/],
    [WITH_REFUNDS, 'how do I get my money back', /3–5 working days/],
    [BASIC, 'When do you close?', /22:00/],
    [BASIC, 'are you open on sunday?', /Sunday/],
    [BASIC, 'hello!', /Reef Café bot/],
    [BASIC, 'whats on the menu', /sea bass/],
    [EXTENDED, 'is there parking?', /parking after 18:00/i],
    [EXTENDED, 'can I reserve a table for 4?', /555-REEF/],
    [EXTENDED, 'where are you?', /Harbor Walk/],
    [WITH_WIFI, 'do you have wifi?', /coral2026/],
    [BASIC, 'Do you have wifi?', /not sure/i],
    [BASIC, 'What is the capital of France?', /not sure/i],
    [BASIC, '', /.+/],
    [[], 'hi', /.+/],
  ];
  for (const [kb, msg, re] of expect) {
    const where = `chat [${kb.map((k) => k.name).join(',')}] "${msg}"`;
    const history = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hi there!' }, { role: 'user', content: msg }];
    const out = callPure(where, CORPUS.chatbots.chat, { kb, lastUserMessage: msg, history });
    if (typeof out !== 'string' || !out.trim()) fail(where, 'reply must be a non-empty string');
    else {
      if (!re.test(out)) fail(where, `expected ${re} in "${out}"`);
      if (words(out) > 60) fail(where, `${words(out)} words (persona says under 60)`);
      scanStrings(where, out);
    }
    // the other corpora delegate chat to the chatbots corpus
    for (const t of ['ai-agents', 'neural-networks']) if (CORPUS[t].chat({ kb, lastUserMessage: msg, history }) !== out) fail(where, `${t}.chat differs from chatbots.chat`);
    if (VERBOSE) console.log(`  chat "${msg}" → ${out}`);
    done(where);
  }
  // follow-up inherits the previous topic only when it still fits
  const fu = CORPUS.chatbots.chat({ kb: BASIC, lastUserMessage: 'and is there parking?', history: [{ role: 'user', content: 'when do you close?' }, { role: 'assistant', content: 'We close at 22:00.' }, { role: 'user', content: 'and is there parking?' }] });
  if (/22:00/.test(fu)) fail('chat follow-up', `"and is there parking?" wrongly inherited the hours topic: ${fu}`);
  done('chat follow-up');
}

/* ------------------------------------------------ 10. interface completeness */

for (const [topicId, c] of Object.entries(CORPUS)) {
  for (const k of ['lesson', 'expansion', 'tutor', 'summary', 'agentStep', 'flowNode', 'integrationGuide', 'chat']) {
    if (typeof c[k] !== 'function') fail(`${topicId} interface`, `missing function ${k}`);
  }
  if (c.topicId !== topicId) fail(`${topicId} interface`, `topicId is "${c.topicId}"`);
  done(`${topicId} interface`);
}
for (const t of ['neural-networks', 'chatbots']) {
  const a = CORPUS[t].agentStep({ goal: REFUND_GOAL, tools: ['calculator', 'notes'], stepNumber: 1, history: [] });
  if (JSON.stringify(a) !== JSON.stringify(CORPUS['ai-agents'].agentStep({ goal: REFUND_GOAL, tools: ['calculator', 'notes'], stepNumber: 1, history: [] }))) fail(`${t} delegation`, 'agentStep should delegate to ai-agents');
  done(`${t} delegation`);
}

/* ------------------------------------------------ report */

const uniqWarn = [...new Set(warnings)];
if (uniqWarn.length) {
  console.log(`\n${uniqWarn.length} warning(s):`);
  for (const w of uniqWarn.slice(0, VERBOSE ? uniqWarn.length : 25)) console.log(`  ⚠ ${w}`);
  if (!VERBOSE && uniqWarn.length > 25) console.log(`  … ${uniqWarn.length - 25} more (run with --verbose)`);
}
const uniqFail = [...new Set(failures)];
if (uniqFail.length) {
  console.log(`\n${uniqFail.length} FAILURE(S):`);
  for (const f of uniqFail.slice(0, 80)) console.log(`  ✗ ${f}`);
  if (uniqFail.length > 80) console.log(`  … ${uniqFail.length - 80} more`);
  console.log(`\n${cases} cases checked, ${uniqFail.length} failing.`);
  process.exit(1);
}
console.log(`\nAll ${cases} corpus cases pass the real validators (sanitizeBlock${realValidateSteps ? ' + validateSteps' : ''}, compileExpr, runTool) and the demo rules.`);
