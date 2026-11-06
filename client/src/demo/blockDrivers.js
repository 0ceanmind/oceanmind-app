/**
 * Block drivers for the pitch-demo director (team B2-blocks).
 *
 * One driver per lesson block type. Each one plays the block the way a curious
 * learner would — slides, presses, trains, runs — legibly (the toolkit's
 * spotlight / press / ripple / glowing thumb on the real controls), in about
 * 5–12 s, waiting on the blocks' own state attributes rather than on guesses.
 *
 * Interface (agreed with B2-journey / beats.js):
 *   driveBlock(ctx, root, { type, step, stepIndex, session, story, part })
 *     root: the lesson-step element, the [data-block] wrapper, the block's own
 *           frame, a selector, or null (then the current lesson step is used).
 *     type: the block type (read from the DOM when omitted).
 *     story: 'dive1' | 'dive2' picks the pitch choreography where it differs.
 *     part: flow-builder only: 'build' | 'run' (both when omitted).
 *   driveCheck(ctx, stepRoot, correctIndex)   a lesson check step
 *   driveTutor(ctx, message)                  ask Lulu, wait for the reply
 *                                             (and any lesson update), close
 *
 * Every id is looked up INSIDE the block's own frame: ids such as 'step',
 * 'reset', 'race' or 'next' repeat across blocks.
 *
 * Abort rules (README): only ctx waits, ctx.check() in loops, and no bare
 * catch around toolkit calls (soft() below rethrows aborts).
 */

/* ------------------------------------------------------------ story data */

export const REFUND_GOAL = 'A customer was charged 3 times at 49.99 — work out the refund owed and note it for the team';
export const MAYA_EMAIL = 'Hi, my order #4471 arrived with a cracked lid. Can I get a replacement? — Maya';
const CLASSIFY_PROMPT = 'Classify the email (category + urgency) and draft a reply using its details.';
const POLICY_PROMPT = 'Check the draft against our damaged-item policy; never promise refunds; flag if a human must approve.';

/* --------------------------------------------------------------- helpers */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const q = (root, id) => root?.querySelector?.(`[data-demo="${id}"]`) ?? null;
const qa = (root, sel) => Array.from(root?.querySelectorAll?.(sel) ?? []);
const data = (el, name) => el?.getAttribute?.(`data-${name}`) ?? null;
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

/** Await a toolkit call but survive a timeout / missing element; aborts still propagate. */
async function soft(ctx, promise, what) {
  try {
    return await promise;
  } catch (e) {
    if (ctx.signal?.aborted || e?.name === 'AbortError') throw e;
    if (what) ctx.log(`blocks: ${what} — ${e?.message ?? e}`, 'warn');
    return null;
  }
}

/** Wait for a data-* attribute on el (value or predicate). soft: resolve null on timeout. */
function waitAttr(ctx, el, name, want, { timeout = 8000, soft: isSoft = true, label } = {}) {
  const ok = typeof want === 'function' ? want : (v) => v === String(want);
  return ctx.waitFor(() => el?.isConnected && ok(data(el, name)), {
    timeout, soft: isSoft, interval: 50, label: label ?? `data-${name}`,
  });
}

/** Await a non-ctx promise (the FlowBuilder helper) in an abort-aware way. */
async function settle(ctx, promise, { timeout = 8000, label = 'helper' } = {}) {
  let done = false;
  let value;
  Promise.resolve(promise).then((v) => { done = true; value = v; }, (e) => { done = true; value = e; });
  await ctx.waitFor(() => done, { timeout, soft: true, interval: 30, label });
  return value;
}

/** React commits a click's state in a microtask: give it a frame before reading data-*. */
const tick = (ctx) => ctx.pause(60);

/** Click only when the control exists and is enabled; returns the element or null. */
async function clickIf(ctx, root, id, opts = {}) {
  const el = typeof id === 'string' ? q(root, id) : id;
  if (!el || el.disabled) return null;
  return ctx.click(el, opts);
}

/** Bring the whole block on screen (centred, or its top at the top of the band when tall). */
async function bringIntoView(ctx, el) {
  await soft(ctx, ctx.scrollTo(el, { block: 'center' }));
}

/** Dispatch pointermoves on el from a → b (client points) over ms, abort-aware. */
async function glidePointer(ctx, el, a, b, ms = 420) {
  const t0 = now();
  const dur = ms / Math.max(0.1, ctx.tempo);
  for (;;) {
    ctx.check();
    const t = Math.min(1, (now() - t0) / dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(typeof PointerEvent === 'function' ? new PointerEvent('pointermove', init) : new MouseEvent('pointermove', init));
    if (t >= 1) break;
    await ctx.pause(16);
  }
}

const center = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/* ------------------------------------------------------ neural networks */

async function neuron(ctx, f) {
  // a strong negative weight kills the output, a strong positive one saturates it
  await ctx.slide('@w1', [-2.5, 2.5], { within: f, duration: 1100, pause: 300 });
  // the bias slides the whole sigmoid left and right
  await ctx.slide('@bias', [-1.8, 0.8], { within: f, duration: 800, pause: 200 });
  await ctx.wait(800); // the last pulse lands on the output
}

async function bioNeuron(ctx, f) {
  for (const part of ['dendrite', 'soma', 'axon', 'synapse']) {
    ctx.check();
    await ctx.click(`@part-${part}`, { within: f, dwell: 220 });
    await ctx.wait(950);
  }
}

async function perceptron(ctx, f) {
  if (data(f, 'done') === 'true') {
    await ctx.click('@new-data', { within: f });
    await ctx.wait(450);
  }
  for (let i = 0; i < 12 && data(f, 'done') !== 'true'; i++) {
    ctx.check();
    await ctx.click('@step', { within: f, dwell: 170, hold: 120, settle: 80 });
    await tick(ctx);
    await ctx.wait(380); // the line glides 420 ms per update
  }
  await ctx.wait(1000); // kelp line, the hop wave and the badge
}

async function logicGate(ctx, f) {
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'train');
  if (data(f, 'gate') !== 'AND') {
    await ctx.click('@gate-and', { within: f });
    await ctx.wait(300);
  }
  await ctx.click('@train', { within: f });
  await waitAttr(ctx, f, 'solved', 'true', { timeout: 5000 });
  await ctx.wait(700);
  // XOR: no single line can do it
  await ctx.click('@gate-xor', { within: f });
  await ctx.wait(250);
  await ctx.click('@train', { within: f });
  await waitAttr(ctx, f, 'tick', (v) => num(v) >= 14, { timeout: 4000 });
  await ctx.wait(900);
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'train'); // pause the hopeless search
  await ctx.wait(300);
}

async function activation(ctx, f) {
  const active = () => String(data(f, 'active') ?? '').split(',');
  if (!active().includes('tanh')) {
    await ctx.click('@fn-tanh', { within: f });
    await ctx.wait(700); // the curve draws in
  }
  await ctx.slide('@x', [-4, 4, 0.6], { within: f, duration: 1000, pause: 200 });
  if (active().includes('relu') && active().length > 1) {
    await ctx.click('@fn-relu', { within: f });
    await ctx.wait(450);
  }
}

async function forwardpass(ctx, f) {
  for (let i = 0; i < 4 && num(data(f, 'phase')) > 0; i++) {
    ctx.check();
    await ctx.click('@back', { within: f, dwell: 120, hold: 90 });
  }
  await ctx.slide('@x1', 1.0, { within: f, duration: 450 });
  for (let p = 1; p <= 3; p++) {
    ctx.check();
    const btn = q(f, 'step');
    if (!btn || btn.disabled) break;
    await ctx.click(btn);
    // the signal travels, then the numbers land
    await waitAttr(ctx, f, 'shown-phase', (v) => num(v) >= p, { timeout: 1800 });
    await ctx.wait(750);
  }
  await ctx.slide('@x2', 0.8, { within: f, duration: 1200 });
  await ctx.wait(450);
}

async function backprop(ctx, f) {
  if (num(data(f, 'phase')) > 0 || data(f, 'target') !== '1') {
    await clickIf(ctx, f, 'target-1'); // resets to phase 0
    await ctx.wait(350);
  }
  // 1 loss · 2 output δ (backward flow) · 3 hidden δ · 4 update
  const dwell = [1300, 1750, 1650, 1400];
  for (let p = 0; p < 4; p++) {
    ctx.check();
    const btn = q(f, 'step');
    if (!btn || btn.disabled) break;
    await ctx.click(btn);
    await ctx.wait(dwell[p]);
  }
  await ctx.wait(300);
}

async function chainRule(ctx, f) {
  for (let i = 0; i < 4 && num(data(f, 'phase')) > 0; i++) {
    ctx.check();
    await ctx.click('@back', { within: f, dwell: 120, hold: 90 });
  }
  await ctx.slide('@x', -1.0, { within: f, duration: 800 });
  await ctx.wait(200);
  for (let s = 0; s < 3; s++) {
    ctx.check();
    const btn = q(f, 'next');
    if (!btn || btn.disabled) break;
    await ctx.click(btn);
    await ctx.wait(1300);
  }
  // ∂σ/∂w = … × x: move x and watch the product follow
  await ctx.slide('@x', 1.8, { within: f, duration: 1000 });
  await ctx.wait(400);
}

async function lossExplorer(ctx, f) {
  if (data(f, 'target') === '0') {
    await ctx.click('@target-1', { within: f });
    await ctx.wait(600);
  }
  if (!String(data(f, 'active') ?? '').includes('mae')) {
    await ctx.click('@loss-mae', { within: f });
    await ctx.wait(600);
  }
  // cross-entropy explodes as a confident prediction goes wrong
  await ctx.slide('@pred', [0.01, 0.98], { within: f, duration: 1100, pause: 450 });
  await ctx.click('@target-0', { within: f });
  await ctx.wait(700); // the curves mirror
  await ctx.slide('@pred', 0.5, { within: f, duration: 800 });
  await ctx.wait(400);
}

async function gradient(ctx, f) {
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'descend'); // pause
  if (num(data(f, 'steps')) > 0 || data(f, 'result')) {
    await clickIf(ctx, f, 'reset');
    await ctx.wait(500);
  }
  if (Math.abs(num(data(f, 'lr'), 0.08) - 0.08) > 0.001) await ctx.slide('@lr', 0.08, { within: f, duration: 400 });
  // a small learning rate settles in the nearby dip…
  await ctx.click('@descend', { within: f });
  await waitAttr(ctx, f, 'result', (v) => Boolean(v), { timeout: 4000 });
  await ctx.wait(650);
  // …a bigger stride hops the bump into the deep valley
  await ctx.slide('@lr', 0.25, { within: f, duration: 450 });
  await ctx.click('@descend', { within: f });
  await waitAttr(ctx, f, 'running', 'true', { timeout: 1500 });
  await waitAttr(ctx, f, 'running', 'false', { timeout: 5000 });
  await ctx.wait(900);
}

async function lossSurface3d(ctx, f) {
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'descend'); // pause
  // orbit the landscape by hand
  await ctx.pointerDrag('@surface', { dx: 260, dy: -18 }, { within: f, duration: 1200 });
  await ctx.wait(250);
  await ctx.click('@descend', { within: f });
  await waitAttr(ctx, f, 'done', 'true', { timeout: 6000 });
  await ctx.wait(900);
}

async function gdVariants(ctx, f) {
  if (data(f, 'phase') !== 'racing') await ctx.click('@race', { within: f });
  await waitAttr(ctx, f, 'done', 'true', { timeout: 9000 });
  await ctx.wait(900);
}

async function optimizerRace(ctx, f) {
  if (data(f, 'phase') !== 'racing') await ctx.click('@race', { within: f });
  await waitAttr(ctx, f, 'done', 'true', { timeout: 9000 });
  await ctx.wait(1000);
}

async function vanishingGradient(ctx, f) {
  if (data(f, 'phase') !== 'sigmoid') {
    await clickIf(ctx, f, 'act-sigmoid');
    await ctx.wait(500);
  }
  await ctx.slide('@depth', 3, { within: f, duration: 650 });
  await ctx.slide('@depth', 14, { within: f, duration: 1900, easing: 'linear' });
  await ctx.wait(700); // the skulls pop in
  await ctx.click('@act-relu', { within: f });
  await ctx.wait(1300); // every bar glides back to full height
}

async function nnPlayground(ctx, f, o) {
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'train'); // pause first
  const ringStory = o.story === 'dive2' || (q(f, 'dataset-circle') && q(f, 'arch-6'));
  if (ringStory && q(f, 'dataset-circle')) {
    // the seeded twilight recipe: ring, 6 hidden units, 3 teal points, lr 0.008 → ≈99 % at epoch 114
    await ctx.click('@dataset-circle', { within: f });
    await ctx.wait(250);
    if (q(f, 'arch-6')) {
      await ctx.click('@arch-6', { within: f });
      await ctx.wait(250);
    }
    await ctx.click('@paint-teal', { within: f });
    for (const [dx, dy] of [[0.7, 0], [0, 0.7], [-0.7, 0]]) {
      ctx.check();
      await ctx.canvasClick('@canvas', (dx + 1) / 2, (1 - dy) / 2, { within: f });
      await ctx.wait(160);
    }
    await ctx.slide('@lr', 0.008, { within: f, duration: 650 });
  } else {
    // other zones: paint a couple of points, then train on the configured data
    const ds = data(f, 'dataset');
    if (ds !== 'spiral' && q(f, 'paint-teal')) {
      await ctx.click('@paint-teal', { within: f });
      for (const [fx, fy] of [[0.78, 0.3], [0.3, 0.72]]) {
        await ctx.canvasClick('@canvas', fx, fy, { within: f });
        await ctx.wait(180);
      }
    }
  }
  await ctx.click('@train', { within: f });
  const conv = await waitAttr(ctx, f, 'converged', 'true', { timeout: ringStory ? 7000 : 6500 });
  if (!conv && data(f, 'running') === 'true') await clickIf(ctx, f, 'train'); // pause a slow run
  await ctx.wait(1400); // the ✓ Converged badge and the kelp glow
}

/* ---------------------------------------------------------------- agents */

async function agentLoop(ctx, f) {
  if (data(f, 'running') !== 'true' && q(f, 'resume')) {
    await ctx.click('@resume', { within: f });
  }
  // let the token travel the loop
  const h0 = num(data(f, 'hops'));
  await waitAttr(ctx, f, 'hops', (v) => num(v) >= h0 + 1, { timeout: 2200 });
  if (h0 < 2) await waitAttr(ctx, f, 'hops', (v) => num(v) >= h0 + 2, { timeout: 2200 });
  await ctx.wait(350);
  // then tour the four stages by hand
  for (const s of ['think', 'act', 'observe', 'done']) {
    ctx.check();
    await ctx.click(`@stage-${s}`, { within: f, dwell: 220 });
    await ctx.wait(850);
  }
  if (q(f, 'resume')) await ctx.click('@resume', { within: f });
  await ctx.wait(300);
}

const PATTERN_FOCUS = {
  routing: 'router', chaining: 'gate', parallel: 'agg', orchestrator: 'orch',
  evaluator: 'eval', agent: 'env', 'augmented-llm': 'llm',
};
const PATTERN_CONTRAST = {
  routing: 'evaluator', chaining: 'routing', parallel: 'orchestrator', orchestrator: 'parallel',
  evaluator: 'agent', agent: 'evaluator', 'augmented-llm': 'agent',
};

async function patternNode(ctx, f, id) {
  const node = await soft(ctx, ctx.find(`.om-gen-xfade-in [data-demo="node"][data-node-id="${id}"]`, { within: f, timeout: 2500 }));
  if (node) await ctx.click(node, { dwell: 240 });
  return node;
}

async function patternExplorer(ctx, f, o) {
  const home = o.story === 'dive1' ? 'routing' : (o.step?.block?.initial || data(f, 'phase') || 'routing');
  const pill = (k) => q(f, `pattern-${k}`);
  if (data(f, 'phase') !== home && pill(home)) {
    await ctx.click(pill(home));
  }
  await waitAttr(ctx, f, 'done', 'true', { timeout: 3000 });
  await ctx.wait(300);
  // dwell on the lesson's pattern: its key node
  if (await patternNode(ctx, f, PATTERN_FOCUS[home] ?? 'llm')) await ctx.wait(1300);
  // one contrasting pattern, briefly
  const other = PATTERN_CONTRAST[home];
  if (other && pill(other)) {
    await ctx.click(pill(other));
    await waitAttr(ctx, f, 'done', 'true', { timeout: 2600 });
    await ctx.wait(800);
    // back to the lesson's pattern
    await ctx.click(pill(home));
    await waitAttr(ctx, f, 'done', 'true', { timeout: 2600 });
    await ctx.wait(250);
    if (await patternNode(ctx, f, PATTERN_FOCUS[home] ?? 'llm')) await ctx.wait(700);
  }
}

async function workflowVsAgent(ctx, f, o) {
  const goal = String(o.session?.goal ?? o.session?.lesson?.title ?? '');
  const script = o.answers ?? (o.story === 'dive1' ? 'NYNN' : /research/i.test(goal) ? 'NYY' : 'NYNN');
  const answer = async (letters) => {
    for (const ch of letters) {
      ctx.check();
      if (data(f, 'done') === 'true') break;
      await waitAttr(ctx, f, 'running', 'false', { timeout: 1500 });
      await ctx.click(ch === 'Y' ? '@answer-yes' : '@answer-no', { within: f, dwell: 240 });
      await ctx.wait(650); // the question slides out, the next slides in
    }
    await waitAttr(ctx, f, 'done', 'true', { timeout: 2000 });
  };
  if (data(f, 'done') === 'true' || num(String(data(f, 'answers') ?? '').length) > 0) {
    if (q(f, 'restart')) {
      await ctx.click('@restart', { within: f });
      await ctx.wait(500);
    }
  }
  if (o.part !== 'rerun') {
    await answer(script);
    await ctx.wait(1700); // the verdict pops and glows
  }
  if (o.part === 'rerun' || o.rerun) {
    if (q(f, 'restart')) {
      await ctx.click('@restart', { within: f });
      await ctx.wait(500);
    }
    await answer('NYY');
    await ctx.wait(1500);
  }
}

async function liveAgent(ctx, f, o) {
  await ctx.find('@tool-calculator', { within: f, timeout: 12000 }); // tools loaded
  if (data(f, 'running') === 'true') {
    // a run is already going (re-driven beat): just let it finish
    await waitAttr(ctx, f, 'done', 'true', { timeout: 40000 });
    return;
  }
  const story = o.story === 'dive1';
  if (story || o.goal) {
    await ctx.type('@agent-goal', o.goal ?? REFUND_GOAL, { within: f, clear: true, cps: 42 });
  } else {
    await ctx.click('@agent-suggest[data-idx="1"]', { within: f });
    await ctx.wait(500); // the suggestion types itself in
  }
  const want = story ? { calculator: true, docsearch: false, notes: true } : null;
  if (want) {
    for (const [tool, on] of Object.entries(want)) {
      ctx.check();
      const b = q(f, `tool-${tool}`);
      if (b && (data(b, 'on') === 'true') !== on) {
        await ctx.click(b, { dwell: 220 });
        await ctx.wait(200);
      }
    }
  }
  await tick(ctx);
  await ctx.click('@agent-run', { within: f, timeout: 3000 });
  // keep the log in view and point at each tool call as it lands
  const log = q(f, 'agent-log');
  if (log) await soft(ctx, ctx.scrollTo(log, { block: 'center' }));
  const seen = new Set();
  const t0 = now();
  while (data(f, 'done') !== 'true' && now() - t0 < 45000) {
    ctx.check();
    if (data(f, 'phase') === 'stopped' || data(f, 'phase') === 'error') break;
    const acts = qa(f, '[data-demo="agent-step"][data-kind="act"]').filter((el) => !seen.has(el));
    if (acts.length) {
      acts.forEach((el) => seen.add(el));
      const el = acts[acts.length - 1];
      await soft(ctx, ctx.spotlight(el, { hold: 420, pad: 4, scroll: false }));
    } else {
      await ctx.pause(90);
    }
  }
  const fin = q(f, 'agent-final');
  if (fin) await soft(ctx, ctx.scrollTo(fin, { block: 'center' }));
  await ctx.wait(1200); // the final answer with the real numbers
}

async function guardrails(ctx, f) {
  const runOnce = async () => {
    await waitAttr(ctx, f, 'running', 'false', { timeout: 7000 });
    await ctx.click('@run', { within: f });
    await waitAttr(ctx, f, 'running', 'true', { timeout: 1500 });
    await waitAttr(ctx, f, 'running', 'false', { timeout: 8000 });
  };
  // start from no rails at all
  for (const b of qa(f, '[data-demo^="rail-"][data-on="true"]')) {
    ctx.check();
    await ctx.click(b, { dwell: 160, hold: 110 });
  }
  // no rails: the agent runs away (iterations, spend, deleted rows climb)
  await runOnce();
  await ctx.wait(1300);
  // one rail: a person must approve risky actions
  await ctx.click('@rail-human-approval', { within: f });
  await ctx.wait(350);
  await runOnce();
  await ctx.wait(1500); // the fired rail pulses kelp
}

async function memory(ctx, f) {
  if (data(f, 'phase') !== 'window') {
    await ctx.click('@strategy-window', { within: f });
    await ctx.wait(400);
  }
  if (num(data(f, 'budget'), 9) < 9) await ctx.slide('@budget', 9, { within: f, duration: 450 });
  // shrink the window: the oldest turns (the price cap first) fall out, then it breaks
  await ctx.slide('@budget', 3, { within: f, duration: 2100, easing: 'linear' });
  await ctx.wait(900);
  // summarise instead of forgetting
  await ctx.click('@strategy-summary', { within: f });
  await ctx.wait(1600);
}

async function multiAgent(ctx, f) {
  if (data(f, 'phase') !== 'centralized') {
    await ctx.click('@topology-centralized', { within: f });
    await ctx.wait(600);
  }
  await soft(ctx, ctx.spotlight('@orchestrator', { within: f, hold: 700 }));
  await ctx.wait(1500); // a task out, a result back
  await ctx.click('@topology-decentralized', { within: f });
  await ctx.wait(2700); // peers message each other directly
  await ctx.click('@topology-centralized', { within: f });
  await ctx.wait(600);
}

async function chatbotBuilder(ctx, f) {
  const compare = Boolean(q(f, 'chat-llm'));
  const settleChat = async () => {
    await tick(ctx);
    await ctx.waitFor(() => data(f, 'rule-typing') === 'false' && (!compare || data(f, 'llm-busy') === 'false'),
      { timeout: 15000, soft: true, label: 'the bots to reply' });
    await ctx.wait(450);
  };
  const say = async (text) => {
    await ctx.type('@chat-rule-input', text, { within: f, cps: 32, clear: true });
    await tick(ctx);
    await ctx.click('@chat-rule-send', { within: f, dwell: 180 });
    await settleChat();
  };
  await say('do you have vegan food?');
  await say('can I get a refund?');
  // teach the rule bot a new intent
  if (!f.querySelector('[data-demo="intent-card"][data-intent="refunds"]')) {
    await ctx.type('@intent-name', 'refunds', { within: f, cps: 30, clear: true });
    await ctx.type('@intent-triggers', 'refund, money back', { within: f, cps: 40, clear: true });
    await ctx.type('@intent-reply', 'Of course! Refunds take 3–5 business days — just bring your receipt.', { within: f, cps: 60, clear: true });
    await tick(ctx);
    await ctx.click('@intent-add', { within: f });
    await ctx.wait(600);
  }
  await say('I want my money back');
  await ctx.wait(500);
}

/* --------------------------------------------------------- flow builder */

async function flowBuilder(ctx, f, o) {
  const story = o.story === 'dive1' || /maya/i.test(String(o.step?.block?.goalHint ?? ''));
  const parts = o.part ? [o.part] : ['build', 'run'];
  if (story) {
    if (parts.includes('build')) await flowBuild(ctx, f, o);
    if (parts.includes('run')) await flowRun(ctx, f, { save: true });
  } else {
    if (parts.includes('build')) await flowInput(ctx, f, o);
    if (parts.includes('run')) await flowRun(ctx, f, { save: false });
  }
}

const flowHelper = (ctx) => ctx.waitFor(() => window.__omFlow, { timeout: 4000, soft: true, label: 'the flow helper' });

async function flowInput(ctx, f, o, { story = false } = {}) {
  const input = q(f, 'flow-input');
  if (!input) return;
  const hint = String(o.step?.block?.goalHint ?? '').trim();
  const want = story ? (hint && /maya/i.test(hint) ? hint : MAYA_EMAIL)
    : hint || { research: 'When should I use a multi-agent system instead of a single agent?', marketing: 'Campaign brief: launch our new product to small-business owners. 4 weeks, $5,000, 200 sign-ups.' }[o.step?.block?.template] || 'A customer asks where their order is.';
  const has = String(input.value ?? '');
  if (story ? /maya/i.test(has) : has.trim()) {
    await ctx.spotlight(input, { hold: 650 }); // the real email this flow will read
  } else {
    await ctx.type(input, want, { clear: true, cps: 55 });
  }
}

async function selectNode(ctx, f, id) {
  const node = f.querySelector(`.fb-node[data-node-id="${id}"]`);
  const head = node?.querySelector('.fb-node-head');
  if (head) {
    await ctx.click(head, { pointer: true, scroll: false, at: [0.3, 0.5], dwell: 260 });
  }
  if (data(f, 'selected') !== id) window.__omFlow?.select(id);
  await waitAttr(ctx, f, 'selected', id, { timeout: 1500 });
  await ctx.wait(250);
}

/** Visible wire: press the out port, the rubber band stretches, press the target's in port. */
async function wire(ctx, f, from, to) {
  const out = f.querySelector(`.fb-node[data-node-id="${from}"] [data-port="out"]`);
  const inn = f.querySelector(`.fb-node[data-node-id="${to}"] [data-port="in"]`);
  const canvas = q(f, 'flow-canvas');
  if (!out || !inn || !canvas) {
    const F = window.__omFlow;
    if (F) await settle(ctx, F.connect(from, to), { timeout: 3000, label: 'connect' });
    return;
  }
  await ctx.click(out, { scroll: false, dwell: 200, hold: 120, settle: 60 });
  await glidePointer(ctx, canvas, center(out), center(inn), 420);
  await ctx.click(inn, { scroll: false, dwell: 120, hold: 120 });
  await ctx.waitFor(() => (window.__omFlow?.getState().edges ?? []).some((e) => e.from === from && e.to === to),
    { timeout: 1500, soft: true, label: 'the wire' });
  if (data(f, 'arming')) await ctx.pressKey(null, 'Escape');
  await ctx.wait(350);
}

async function flowBuild(ctx, f, o) {
  const F = await flowHelper(ctx);
  const canvas = q(f, 'flow-canvas');
  // frame the builder: palette, canvas and inspector together
  if (canvas) await soft(ctx, ctx.scrollTo(canvas, { block: 'center' }));
  await ctx.wait(350);
  const state = () => F?.getState?.() ?? { nodes: [], edges: [] };
  const byLabel = (label) => state().nodes.find((n) => n.config?.label === label);
  if (byLabel('Policy check')) {
    ctx.log('blocks: the story flow is already built — skipping the build', 'info');
    await flowInput(ctx, f, o, { story: true });
    return;
  }
  // start from the plain starter template
  const s0 = state();
  const starter = s0.nodes.length === 3 && s0.nodes.some((n) => n.id === 'n2' && n.type === 'llm');
  if (!starter && q(f, 'tpl-starter')) {
    await ctx.click('@tpl-starter', { within: f });
    await ctx.wait(1100);
  }
  const llm = state().nodes.find((n) => n.type === 'llm') ?? { id: 'n2' };
  const out = state().nodes.find((n) => n.type === 'output') ?? { id: 'n3' };

  // 1. rename the LLM step and give it its job
  await selectNode(ctx, f, llm.id);
  await ctx.type('@insp-name', 'Classify & draft', { within: f, clear: true, cps: 20 });
  await ctx.type('@insp-prompt', CLASSIFY_PROMPT, { within: f, clear: true, cps: 70 });
  await ctx.wait(200);

  // 2. make room: Result glides below, so the chain reads left → right → down
  if (F) {
    const n = state().nodes.find((x) => x.id === llm.id);
    await settle(ctx, F.moveNode(out.id, (n?.x ?? 250) + 220, (n?.y ?? 150) + 150, { duration: 520 }), { timeout: 2000, label: 'move Result' });
    await ctx.wait(200);
  }

  // 3. add a second LLM step next to it
  const before = new Set(state().nodes.map((n) => n.id));
  if (data(f, 'selected') !== llm.id) await selectNode(ctx, f, llm.id);
  await ctx.click('@pal-llm', { within: f });
  const added = await ctx.waitFor(() => state().nodes.find((n) => !before.has(n.id)), { timeout: 2000, soft: true, label: 'the new node' });
  const pid = added?.id;
  await ctx.wait(650); // it pops in and the view glides to fit
  if (pid) {
    if (data(f, 'selected') !== pid) await selectNode(ctx, f, pid);
    await ctx.type('@insp-name', 'Policy check', { within: f, clear: true, cps: 20 });
    await ctx.type('@insp-prompt', POLICY_PROMPT, { within: f, clear: true, cps: 75 });
    await ctx.wait(200);
  }

  // 4. rewire: drop the direct edge, then Classify → Policy check → Result
  const direct = f.querySelector(`path[data-edge="${llm.id}-${out.id}"]`);
  if (direct) {
    await ctx.click(direct, { scroll: false, dwell: 300, hold: 140 });
    await ctx.wait(300);
  } else if (F) {
    F.removeEdge(llm.id, out.id);
  }
  if (F && data(f, 'selected')) F.select(null); // show the wiring without the inspector focus
  if (pid) {
    await wire(ctx, f, llm.id, pid);
    await wire(ctx, f, pid, out.id);
  }
  if (F) await settle(ctx, F.fit({ animate: true }), { timeout: 1500, label: 'fit' });
  await ctx.wait(250);

  // 5. the test input: Maya's real email
  await flowInput(ctx, f, o, { story: true });
}

async function flowRun(ctx, f, { save = false } = {}) {
  const canvas = q(f, 'flow-canvas');
  const run = q(f, 'flow-run');
  if (canvas) await soft(ctx, ctx.scrollTo(canvas, { block: 'center' }));
  const fits = run && run.getBoundingClientRect().bottom < window.innerHeight - 12;
  if (data(f, 'running') !== 'true') {
    await ctx.click('@flow-run', { within: f, scroll: !fits, timeout: 4000 });
  }
  await waitAttr(ctx, f, 'running', 'true', { timeout: 2000 });
  // packets travel, each node types its output
  await waitAttr(ctx, f, 'done', 'true', { timeout: 30000, label: 'the flow run' });
  await ctx.wait(1100);
  if (save && data(q(f, 'flow-save'), 'saved') !== 'true') {
    await ctx.click('@flow-save', { within: f, scroll: !fits });
    await waitAttr(ctx, q(f, 'flow-save'), 'saved', 'true', { timeout: 8000 });
    await soft(ctx, ctx.find('@toast', { timeout: 2000 }));
    await ctx.wait(900);
  }
}

/* --------------------------------------------------------------- generic */

async function diagram(ctx, f) {
  await waitAttr(ctx, f, 'done', 'true', { timeout: 3500 });
  await ctx.wait(250);
  const nodes = qa(f, '[data-demo="node"]').sort((a, b) => num(data(a, 'idx')) - num(data(b, 'idx')));
  const withDetail = nodes.filter((n) => data(n, 'has-detail') === 'true');
  const pool = withDetail.length >= 3 ? withDetail : nodes;
  const pick = pool.length <= 4 ? pool : [0, 1, 2, 3].map((i) => pool[Math.round((i * (pool.length - 1)) / 3)]);
  for (const n of pick) {
    ctx.check();
    await ctx.click(n, { dwell: 220 });
    await ctx.wait(950);
  }
}

async function chart(ctx, f) {
  await waitAttr(ctx, f, 'done', 'true', { timeout: 4500 });
  await ctx.wait(250);
  const cols = qa(f, '[data-demo="hover-col"]').sort((a, b) => num(data(a, 'idx')) - num(data(b, 'idx')));
  if (!cols.length) return;
  const n = cols.length;
  const idx = n <= 4 ? cols.map((_, i) => i) : [0, 1, 2, 3].map((i) => Math.round(((i + 1) * (n - 1)) / 4));
  for (const i of idx) {
    ctx.check();
    await ctx.hover(cols[i], { hold: 600, scroll: false });
  }
  await ctx.wait(800);
  ctx.unhover();
}

async function simulator(ctx, f, o) {
  const ranges = qa(f, 'input[type="range"][data-demo^="var-"]');
  const name = (el) => data(el, 'demo').slice(4);
  const byName = Object.fromEntries(ranges.map((el) => [name(el), el]));
  const hasCurve = data(f, 'phase') === 'curve';
  if (data(f, 'changed') === 'true' && q(f, 'reset')) {
    await ctx.click('@reset', { within: f });
    await ctx.wait(400);
  }
  if (byName.k && byName.t) {
    // routing confidence: a softer gate, a sharper gate, then a stricter threshold
    await ctx.slide(byName.k, [4, 16], { duration: 850, pause: 300 });
    await ctx.wait(200);
    await ctx.slide(byName.t, 0.8, { duration: 950 });
  } else {
    for (const [i, el] of ranges.slice(0, 2).entries()) {
      ctx.check();
      const min = parseFloat(el.min);
      const max = parseFloat(el.max);
      const v = parseFloat(el.value);
      const span = max - min;
      const to = i === 0 ? v + (max - v) * 0.7 : v - (v - min) * 0.7;
      const back = i === 0 ? v - (v - min) * 0.35 : null;
      await ctx.slide(el, back == null || !Number.isFinite(back) ? to : [to, back], { duration: span > 0 ? 950 : 500, pause: 250 });
      await ctx.wait(200);
    }
  }
  if (hasCurve && q(f, 'plot')) {
    await ctx.canvasClick('@plot', 0.72, 0.5, { within: f });
    await ctx.wait(1000);
  } else {
    await ctx.wait(700);
  }
}

async function sequence(ctx, f) {
  if (data(f, 'running') === 'true') await clickIf(ctx, f, 'autoplay'); // pause the tour
  const count = num(data(f, 'stages'), qa(f, '[data-demo="stage"]').length);
  let from = num(data(f, 'phase'));
  if (from >= count - 1) {
    // start over from the first stage
    const first = f.querySelector('[data-demo="stage"][data-idx="0"]');
    if (first) await ctx.click(first, { dwell: 200 });
    await ctx.wait(500);
    from = 0;
  }
  for (let i = from + 1; i < count; i++) {
    ctx.check();
    const st = f.querySelector(`[data-demo="stage"][data-idx="${i}"]`);
    if (st) await ctx.click(st, { dwell: 200, hold: 130 });
    else await ctx.click('@next', { within: f });
    await ctx.wait(count > 6 ? 700 : 850);
  }
  await ctx.wait(400);
}

/* ------------------------------------------------------------- registry */

const DRIVERS = {
  // neural networks
  neuron,
  'bio-neuron': bioNeuron,
  perceptron,
  'logic-gate': logicGate,
  activation,
  forwardpass,
  backprop,
  'chain-rule': chainRule,
  'loss-explorer': lossExplorer,
  gradient,
  'loss-surface-3d': lossSurface3d,
  'gd-variants': gdVariants,
  'optimizer-race': optimizerRace,
  'vanishing-gradient': vanishingGradient,
  'nn-playground': nnPlayground,
  // agents
  'agent-loop': agentLoop,
  'pattern-explorer': patternExplorer,
  'flow-builder': flowBuilder,
  'live-agent': liveAgent,
  memory,
  guardrails,
  'multi-agent': multiAgent,
  'workflow-vs-agent': workflowVsAgent,
  // chatbots
  'chatbot-builder': chatbotBuilder,
  // any topic
  diagram,
  chart,
  simulator,
  sequence,
};

export const BLOCK_TYPES = Object.keys(DRIVERS);

/* ------------------------------------------------------------ public API */

/** Resolve { step, wrapper, type } from whatever root the beat hands us. */
async function resolve(ctx, root, type) {
  let el = root;
  if (typeof root === 'string') el = await ctx.find(root, { timeout: 8000 });
  if (!el) el = await ctx.find('@lesson-step', { timeout: 8000 });
  const step = el.closest?.('[data-demo="lesson-step"]') ?? (data(el, 'demo') === 'lesson-step' ? el : null);
  let wrapper = null;
  const own = el.matches?.('[data-block]') ? el : el.closest?.('[data-block]');
  if (own && (!type || data(own, 'block') === type)) wrapper = own;
  if (!wrapper) {
    const scope = step ?? el;
    const sel = type ? `[data-block="${type}"]` : '[data-block]';
    wrapper = scope.querySelector?.(sel) ?? await soft(ctx, ctx.find(sel, { within: scope, timeout: 6000, visible: false }));
  }
  const t = type ?? data(wrapper, 'block') ?? data(step, 'block-type');
  return { step, wrapper, type: t };
}

/**
 * Play one lesson block. Resolves when the block has shown what it teaches.
 * Returns { type, ms } (or null when there was nothing to drive).
 */
export async function driveBlock(ctx, root, opts = {}) {
  ctx.check();
  const t0 = now();
  const { step, wrapper, type } = await resolve(ctx, root, opts.type);
  if (type === 'check') {
    await driveCheck(ctx, step ?? root, opts.correctIndex);
    return { type, ms: Math.round(now() - t0) };
  }
  if (!wrapper) {
    ctx.log(`blocks: no [data-block="${type}"] to drive`, 'warn');
    return null;
  }
  const frame = wrapper.firstElementChild ?? wrapper;
  const fn = DRIVERS[type];
  await bringIntoView(ctx, wrapper);
  if (!fn) {
    ctx.log(`blocks: no driver for "${type}" — pointing at it`, 'warn');
    await ctx.spotlight(wrapper, { hold: 900, scroll: false });
    return { type, ms: Math.round(now() - t0) };
  }
  await fn(ctx, frame, { ...opts, type, wrapper, stepRoot: step });
  const ms = Math.round(now() - t0);
  ctx.log(`blocks: ${type}${opts.part ? ` (${opts.part})` : ''} ${(ms / 1000).toFixed(1)} s`);
  return { type, ms };
}

/** Answer a lesson check step correctly (the key comes from the session row when not given). */
export async function driveCheck(ctx, stepRoot, correctIndex) {
  ctx.check();
  const step = typeof stepRoot === 'string' ? await ctx.find(stepRoot)
    : stepRoot instanceof Element ? (stepRoot.closest('[data-demo="lesson-step"]') ?? stepRoot)
      : await ctx.find('@lesson-step');
  if (data(step, 'check-answered') === 'true') {
    await ctx.wait(400);
    return;
  }
  let key = Number.isInteger(correctIndex) ? correctIndex : null;
  if (key == null) {
    const i = num(data(step, 'step-index'), -1);
    const pick = (row) => row?.lesson?.steps?.[i]?.block?.question?.correctIndex;
    key = pick(ctx.getSessionRow());
    if (!Number.isInteger(key)) key = pick(await soft(ctx, ctx.loadSessionRow(), 'reload the session row'));
  }
  const options = await ctx.find('@check-option', { within: step, timeout: 5000 }).then(() => ctx.findAll('@check-option', { within: step }));
  if (!Number.isInteger(key)) {
    ctx.log('blocks: no answer key for this check — picking the first option', 'warn');
    key = num(data(options[0], 'idx'));
  }
  // a moment of doubt on another option, then the right one
  const other = options.find((o) => num(data(o, 'idx')) !== key && num(data(o, 'idx')) !== (key + 1) % options.length)
    ?? options.find((o) => num(data(o, 'idx')) !== key);
  if (other) await ctx.hover(other, { hold: 480 });
  await ctx.click(`@check-option[data-idx="${key}"]`, { within: step });
  await soft(ctx, ctx.find('.answer-explain', { within: step, timeout: 2500 }));
  await ctx.wait(1400); // read the explanation
}

/**
 * Ask Lulu, visibly: open the panel, type, send, wait for her to finish typing
 * and for any lesson change (inserted steps → the app moves to the first one),
 * then close the panel. Returns { expanded, added, from, to, reply }.
 */
export async function driveTutor(ctx, message, { hold = 900, cps = 30 } = {}) {
  ctx.check();
  const stepEl = () => document.querySelector('[data-demo="lesson-step"]');
  const where = () => ({ index: num(data(stepEl(), 'step-index'), -1), count: num(data(stepEl(), 'step-count'), 0) });
  const panel = () => document.querySelector('[data-demo="tutor-panel"]');
  const before = where();

  const toggle = await ctx.find('@tutor-toggle', { timeout: 8000 });
  if (!panel() || data(toggle, 'open') !== 'true') {
    await ctx.click(toggle);
    await ctx.find('@tutor-panel', { timeout: 3000 });
    await ctx.wait(420); // the panel springs open
  }
  await ctx.type('@tutor-input', message, { cps, clear: true });
  await tick(ctx);
  const count0 = num(data(panel(), 'count'));
  await ctx.click('@tutor-send', { timeout: 3000 });
  // thinking… → her reply types out
  await ctx.waitFor(() => data(panel(), 'busy') === 'true' || num(data(panel(), 'count')) >= count0 + 2,
    { timeout: 3000, soft: true, label: 'Lulu to start' });
  await ctx.waitFor(() => panel() && data(panel(), 'busy') === 'false', { timeout: 45000, label: 'Lulu to reply' });
  await ctx.waitFor(() => !panel() || data(panel(), 'typing') === 'false', { timeout: 20000, soft: true, label: 'Lulu to finish typing' });
  const bubbles = qa(panel(), '.bubble.bot');
  const reply = bubbles.length ? bubbles[bubbles.length - 1].textContent : '';
  let after = where();
  const expanded = after.count > before.count;
  if (expanded) {
    await ctx.waitFor(() => where().index === before.index + 1, { timeout: 3000, soft: true, label: 'the first new step' });
    after = where();
  }
  await ctx.wait(hold);
  if (panel()) {
    await ctx.click('@tutor-close', { timeout: 3000 });
    await soft(ctx, ctx.waitGone('@tutor-panel', { timeout: 2000 }));
  }
  if (expanded) await ctx.waitIdle({ timeout: 4000 });
  return { expanded, added: after.count - before.count, from: before.index, to: after.index, reply };
}
