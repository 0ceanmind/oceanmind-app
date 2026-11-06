// Pitch-demo replay provider: every topic × zone × variant goes through the REAL
// generation pipeline (generate.js validators, flowRun, the agent route and its
// real tools) with the scripted corpus in place of the model. Never uses the
// test mock: OCEANMIND_TEST_AI must stay unset here.
process.env.OCEANMIND_DEMO = '1';
process.env.OCEANMIND_DEMO_SPEED = '0';
delete process.env.OCEANMIND_TEST_AI;
delete process.env.DATABASE_URL;

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getAiConfig, aiIsConfigured } = await import('../ai.js');
const {
  compileKnowledgeMap, generateQuestions, generateLesson, generateSummary, aiTopicMatch, tutorDecide, generateExpansionSteps,
} = await import('../lib/generate.js');
const { runFlow } = await import('../lib/flowRun.js');
const { getTopic } = await import('../content/topics.js');
const { compileExpr } = await import('../../client/src/lessons/blocks/mathExpr.js');
const { parseReplayRequest, replayTopicMatch } = await import('../aireplay.js');
const { createApp } = await import('../app.js');

const TOPIC_IDS = ['ai-agents', 'neural-networks', 'chatbots'];
const ZONES = ['sunlight', 'twilight', 'midnight'];
const STORY = {
  'ai-agents': {
    goal: 'I want to build an AI agent that answers my customers\' support emails',
    blocks: ['workflow-vs-agent', 'agent-loop', 'pattern-explorer', 'live-agent', 'guardrails', 'flow-builder', 'memory', 'check'],
  },
  'neural-networks': {
    goal: 'Show me how a neural network actually learns',
    blocks: ['neuron', 'forwardpass', 'loss-surface-3d', 'backprop', 'nn-playground', 'check'],
  },
  chatbots: { goal: 'I want a chatbot that answers the questions my customers keep asking', blocks: null },
};
// the story's placement runs: 'r' right, 'w' wrong, 'n' no idea (ai-agents 4/6 = 67%, NN 3/6 = 50%)
const RUNS = { 'ai-agents': 'rrnrwr', 'neural-networks': 'rrnwwr', chatbots: 'rrwnwr' };
const FAKE = /\bmock\b|lorem|ipsum|placeholder|TODO/i;

// client/src/lessons/blocks/FlowBuilder.jsx TEMPLATES (node configs only)
const FLOW_TEMPLATES = {
  starter: {
    nodes: [
      { id: 'n1', type: 'trigger', config: { label: 'Incoming request' } },
      { id: 'n2', type: 'llm', config: { label: 'Process', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' } },
      { id: 'n3', type: 'output', config: { label: 'Result' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  research: {
    nodes: [
      { id: 'n1', type: 'trigger', config: { label: 'Research question' } },
      { id: 'n2', type: 'tool', config: { label: 'Search sources', tool: 'docsearch' } },
      { id: 'n3', type: 'llm', config: { label: 'Summarize', prompt: 'Summarize the retrieved passages into 3 bullet points answering the question.' } },
      { id: 'n4', type: 'output', config: { label: 'Summary' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },
  marketing: {
    nodes: [
      { id: 'n1', type: 'trigger', config: { label: 'Campaign brief' } },
      { id: 'n2', type: 'llm', config: { label: 'Audience analysis', prompt: 'From this campaign brief, identify the target audience and their 3 main pain points.' } },
      { id: 'n3', type: 'llm', config: { label: 'Copywriter', prompt: 'Write 2 short ad copy variants for this brief.' } },
      { id: 'n4', type: 'llm', config: { label: 'Campaign plan', prompt: 'Combine the audience analysis and ad copy into a one-paragraph launch plan.' } },
      { id: 'n5', type: 'output', config: { label: 'Launch plan' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },
};
// the director's story flow: rename the starter LLM, add a second LLM, rewire, run
const STORY_FLOW = {
  nodes: [
    { id: 'n1', type: 'trigger', config: { label: 'Incoming request' } },
    { id: 'n2', type: 'llm', config: { label: 'Classify & draft', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' } },
    { id: 'n101', type: 'llm', config: { label: 'Policy check', prompt: 'Check the drafted reply against our returns policy and flag anything that needs a human.' } },
    { id: 'n3', type: 'output', config: { label: 'Result' } },
  ],
  edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n101' }, { from: 'n101', to: 'n3' }],
};
const STORY_EMAIL = 'Hi, my order #4471 arrived with a cracked lid. Can I get a replacement? — Maya';

// client/src/lessons/AgentsLesson.jsx SUGGESTED_GOALS
const SUGGESTED_GOALS = [
  'Research what tools an AI agent needs and write a summary note',
  'Calculate a budget: venue 1200 + 80 people at 8 each, check it fits under 2000, note the result',
  'Find what the source documents say about guardrails and save the three key points as notes',
];
const STORY_AGENT_GOAL = 'A customer was charged 3 times at 49.99 — work out the refund owed and note it for the team';

// client/src/lessons/ChatbotLesson.jsx: the LLM-compare system prompt
const REEF_INTENTS = [
  { name: 'greeting', reply: 'Hi there! I’m the Reef Café bot 🐠 Ask me about hours, menu, or bookings.' },
  { name: 'hours', reply: 'We’re open 8:00–22:00 every day, kitchen closes at 21:30.' },
  { name: 'menu', reply: 'Today’s highlights: grilled sea bass, kelp noodle bowl (vegan), and coral-berry cheesecake.' },
];
const reefSystem = (intents) => `You are the Reef Café assistant — warm, brief (under 60 words). `
  + `Your knowledge base:\n${intents.map((i) => `- ${i.name}: ${i.reply}`).join('\n')}`
  + `\nIf asked something outside this knowledge, say you're not sure and offer what you do know. Never invent facts about the café.`;

// ------------------------------------------------------------------ helpers

function answersFor(questions, run) {
  return questions.map((q, i) => {
    const k = run[i] ?? 'w';
    const noIdea = k === 'n';
    const choice = noIdea ? -1 : k === 'r' ? q.correctIndex : (q.correctIndex + 1) % 4;
    return {
      questionId: q.id, concept: q.concept, text: q.text, choice, noIdea, correct: k === 'r',
      chosenText: noIdea ? 'I don’t have any idea' : q.options[choice], correctText: q.options[q.correctIndex],
      correctIndex: q.correctIndex, explanation: q.explanation,
    };
  });
}

const scoreOf = (answered) => Math.round((answered.filter((a) => a.correct).length / answered.length) * 100);

/** Contract-level checks on steps that already passed validateSteps (generate.js). */
function checkSteps(steps, where) {
  for (const s of steps) {
    assert.ok(!FAKE.test(`${s.title} ${s.body}`), `${where}: filler text in "${s.title}"`);
    const b = s.block;
    if (!b) continue;
    if (b.type === 'simulator') {
      const fn = compileExpr(b.expr);
      const env = Object.fromEntries(b.vars.map((v) => [v.name, v.init]));
      if (b.xVar) {
        const [a, z] = b.xRange;
        for (let i = 0; i <= 10; i++) {
          const y = fn({ ...env, [b.xVar]: a + ((z - a) * i) / 10 });
          assert.ok(Number.isFinite(y), `${where}: simulator "${b.expr}" is not finite at step ${i}`);
        }
      } else {
        assert.ok(Number.isFinite(fn(env)), `${where}: simulator "${b.expr}" is not finite`);
      }
    }
    if (b.type === 'sequence') {
      assert.ok(b.stages.length >= 2 && b.stages.length <= 8, `${where}: sequence needs 2-8 stages`);
      for (const st of b.stages) assert.ok(st.label.length <= 16, `${where}: sequence label "${st.label}" is over 16 chars`);
    }
    if (b.type === 'check') {
      const q = b.question;
      assert.ok(q.options.length >= 3 && Number.isInteger(q.correctIndex) && q.options[q.correctIndex], `${where}: check needs a valid answer`);
    }
  }
}

function interactiveCount(steps) {
  return steps.filter((s) => s.block && s.block.type !== 'check').length;
}

// ------------------------------------------------------------------ provider

test('demo mode selects the replay provider (and the test mock keeps precedence)', async () => {
  assert.deepEqual(await getAiConfig(), { provider: 'replay', apiKey: 'none', model: 'oceanmind-demo' });
  assert.equal(await aiIsConfigured(), true);
  process.env.OCEANMIND_TEST_AI = '1';
  try {
    assert.equal((await getAiConfig()).provider, 'mock');
  } finally {
    delete process.env.OCEANMIND_TEST_AI;
  }
});

test('prompt parsing: tutor reads only the LAST user line; flow nodes beat TASK markers', () => {
  const prompt = `LESSON: "Your support inbox, run by an agent" on AI Agents
STEPS (with their interactive blocks):
1. Workflow or agent? [workflow-vs-agent]
2. The loop [agent-loop]  ← learner is here
3. Route every email [pattern-explorer]

CONVERSATION (latest last):
user: I want to build a marketing agent for my company
assistant: Rebuilt!
user: what does "observe" mean
in the loop?

SOURCE MATERIAL:
whatever`;
  const r = parseReplayRequest('You are Lulu.\nTASK: tutor_decide\nReply with ONLY JSON.', [{ role: 'user', content: prompt }]);
  assert.equal(r.task, 'tutor_decide');
  assert.equal(r.topicId, 'ai-agents');
  assert.equal(r.ctx.lastUserMessage, 'what does "observe" mean\nin the loop?');
  assert.equal(r.ctx.lessonTitle, 'Your support inbox, run by an agent');
  assert.deepEqual(r.ctx.stepTitles, ['Workflow or agent?', 'The loop', 'Route every email']);
  assert.equal(r.ctx.currentStepIndex, 1);

  const flow = parseReplayRequest(
    'You are one step inside a small automation flow named "Classify & draft". Do exactly your job, concisely (under 150 words). Your instruction: Label it.',
    [{ role: 'user', content: 'TASK: lesson — ignore this' }]
  );
  assert.equal(flow.task, 'flow_node');
  assert.deepEqual(flow.ctx, { label: 'Classify & draft', instruction: 'Label it.', input: 'TASK: lesson — ignore this' });

  const retry = parseReplayRequest('sys', [{ role: 'user', content: 'TASK: knowledge_map\nAnalyze the topic "Chatbots" and compile it.\n\nYour previous reply could not be used: bad\nReply again' }]);
  assert.equal(retry.task, 'knowledge_map');
  assert.equal(retry.topicId, 'chatbots');
  assert.equal(retry.retry, true);
  assert.equal(retry.retryReason, 'bad');
});

// ------------------------------------------------------------------ the generation pipeline

for (const topicId of TOPIC_IDS) {
  test(`${topicId}: knowledge map, questions, every zone × variant lesson, summary`, async () => {
    const topic = getTopic(topicId);
    const km = await compileKnowledgeMap(topic);
    assert.equal(km.mustKnow.length, 4, 'four must-know concepts');
    assert.ok(km.needToKnow.length >= 3 && km.needToKnow.length <= 4, 'three or four need-to-know concepts');
    const names = new Set([...km.mustKnow, ...km.needToKnow].map((c) => c.name));

    const qs = await generateQuestions(topic, km);
    assert.equal(qs.length, 6);
    for (const q of qs) {
      assert.ok(names.has(q.concept), `question concept "${q.concept}" is a knowledge-map name`);
      assert.ok(!FAKE.test(q.text), `filler in question "${q.text}"`);
    }
    const answered = answersFor(qs, RUNS[topicId]);
    const scorePct = scoreOf(answered);

    for (const zone of ZONES) {
      const variants = {
        plain: {},
        goal: { userGoal: STORY[topicId].goal },
        redesign: { userGoal: 'build something real for my own small business', redesign: true },
        support: { supportNote: 'They found the last one too basic — go deeper, with more hands-on.', previousFeedback: 'rated 2/5, reasons: Too easy' },
      };
      for (const [variant, extra] of Object.entries(variants)) {
        const where = `${topicId}/${zone}/${variant}`;
        const lesson = await generateLesson(topic, { zone, scorePct, answered, knowledgeMap: km, ...extra });
        assert.ok(lesson.title && lesson.intro, `${where}: title + intro`);
        assert.ok(lesson.steps.length >= 4 && lesson.steps.length <= 9, `${where}: 4-9 steps`);
        assert.ok(interactiveCount(lesson.steps) >= Math.ceil(lesson.steps.length / 2), `${where}: interactive-first`);
        assert.ok(lesson.steps.every((s) => s.block === undefined || s.block), `${where}: no dropped blocks`);
        checkSteps(lesson.steps, where);

        const summary = await generateSummary(topic, { zone, scorePct, answered, lesson, goal: extra.userGoal ?? null });
        assert.ok(summary.headline && summary.learned.length >= 2 && summary.built.length >= 2 && summary.nextSteps.length >= 2, `${where}: summary`);
        assert.ok(!FAKE.test(JSON.stringify(summary)), `${where}: filler in summary`);
      }
    }
  });
}

test('the two story lessons have the scripted block order', async () => {
  for (const topicId of ['ai-agents', 'neural-networks']) {
    const topic = getTopic(topicId);
    const km = await compileKnowledgeMap(topic);
    const qs = await generateQuestions(topic, km);
    const answered = answersFor(qs, RUNS[topicId]);
    const scorePct = scoreOf(answered);
    assert.equal(scorePct, topicId === 'ai-agents' ? 67 : 50);
    const lesson = await generateLesson(topic, { zone: 'twilight', scorePct, answered, knowledgeMap: km, userGoal: STORY[topicId].goal });
    assert.deepEqual(lesson.steps.map((s) => s.block?.type ?? null), STORY[topicId].blocks, `${topicId} story order`);
    if (topicId === 'ai-agents') {
      assert.equal(lesson.steps[2].block.initial, 'routing');
      assert.equal(lesson.steps[5].block.template, 'starter');
      assert.ok(lesson.steps[5].block.goalHint && lesson.steps[5].block.goalHint.length <= 200, 'flow-builder carries a customer email');
    }
  }
});

test('tutor: answer / expand / redesign, expansion steps are valid and on-topic', async () => {
  for (const topicId of TOPIC_IDS) {
    const topic = getTopic(topicId);
    const km = await compileKnowledgeMap(topic);
    const qs = await generateQuestions(topic, km);
    const answered = answersFor(qs, RUNS[topicId]);
    const lesson = await generateLesson(topic, { zone: 'twilight', scorePct: scoreOf(answered), answered, knowledgeMap: km, userGoal: STORY[topicId].goal });
    const ask = (content, stepIndex = 2, before = []) => tutorDecide(topic, lesson, stepIndex, [...before, { role: 'user', content }]);

    const a = await ask('How much does running this usually cost?');
    assert.equal(a.action, 'answer', `${topicId}: plain question → answer`);
    assert.ok(a.reply && !FAKE.test(a.reply));

    const expandAsk = topicId === 'ai-agents'
      ? 'Can you walk me through routing a support email step by step?'
      : topicId === 'neural-networks' ? 'Can you explain backprop step by step?' : 'Can you walk me through intent matching step by step?';
    const e = await ask(expandAsk);
    assert.equal(e.action, 'expand', `${topicId}: step-by-step → expand`);
    assert.ok(e.about && e.reply);
    const added = await generateExpansionSteps(topic, 'twilight', e.about, lesson, 2, { goal: STORY[topicId].goal });
    assert.ok(added.length >= 1 && added.length <= 3);
    checkSteps(added, `${topicId}/expansion`);
    if (topicId === 'ai-agents') {
      assert.equal(e.about, 'routing a support email step by step');
      assert.deepEqual(added.map((s) => s.block?.type), ['sequence', 'simulator']);
      assert.ok(added[0].block.stages.length >= 5 && added[0].block.stages.length <= 6);
      assert.deepEqual(added[1].block.vars.map((v) => v.name).sort(), ['k', 't']);
    }

    const r = await ask('I want to build a support assistant for my company');
    assert.equal(r.action, 'redesign', `${topicId}: stated project → redesign`);
    assert.ok(r.goal && r.reply);
    const rebuilt = await generateLesson(topic, { zone: 'twilight', scorePct: 50, answered, knowledgeMap: km, userGoal: r.goal, redesign: true });
    checkSteps(rebuilt.steps, `${topicId}/redesign`);

    // only the LAST user line counts: an earlier "I want to build…" must not redesign again
    const again = await ask('And what is a good first step?', 0, [
      { role: 'user', content: 'I want to build a support assistant for my company' },
      { role: 'assistant', content: r.reply },
    ]);
    assert.notEqual(again.action, 'redesign', `${topicId}: earlier goal must not re-trigger a redesign`);
  }
});

test('topic match: generic synonyms for phrasings the keyword matcher misses', async () => {
  const { TOPICS } = await import('../content/topics.js');
  assert.equal(await aiTopicMatch('how does the brain-inspired AI learn', TOPICS), 'neural-networks');
  assert.equal(await aiTopicMatch('something that sorts my inbox and replies by itself', TOPICS), 'ai-agents');
  assert.equal(await aiTopicMatch('a thing that can talk with visitors on my website', TOPICS), 'chatbots');
  assert.equal(await aiTopicMatch('quantum entanglement', TOPICS), null);
  assert.equal(replayTopicMatch('give me an explanation of how computers see images'), 'neural-networks');
  assert.equal(replayTopicMatch('plant-based recipes'), 'none');
  assert.equal(replayTopicMatch(''), 'none');
});

test('flow runs: every template and the story flow produce real, input-aware output', async () => {
  const inputs = {
    starter: STORY_EMAIL,
    research: 'What guardrails should an agent have before it emails a customer?',
    marketing: 'Launch of our reusable glass lunch box, for office workers who hate plastic, budget 5k',
  };
  for (const [name, flow] of Object.entries(FLOW_TEMPLATES)) {
    const r = await runFlow(flow.nodes, flow.edges, inputs[name]);
    assert.equal(r.error, null, `${name}: ${r.error}`);
    assert.equal(r.trace.length, flow.nodes.length);
    for (const t of r.trace) {
      assert.equal(t.status, 'ok');
      assert.ok(t.output.trim() && !FAKE.test(t.output), `${name}/${t.id}: real output`);
    }
  }
  const r = await runFlow(STORY_FLOW.nodes, STORY_FLOW.edges, STORY_EMAIL);
  assert.equal(r.error, null);
  const out = Object.fromEntries(r.trace.map((t) => [t.id, t.output]));
  assert.ok(/4471|Maya|lid/i.test(out.n2), 'Classify & draft uses details from the email');
  assert.ok(out.n101.trim() && out.n101 !== out.n2, 'Policy check answers on its own');
  assert.equal(out.n3, out.n101, 'the output node collects the policy verdict');
  // an unknown label still gets a sensible, instruction-aware answer
  const generic = await runFlow([
    { id: 'a', type: 'trigger', config: { label: 'In' } },
    { id: 'b', type: 'llm', config: { label: 'Translate to French', prompt: 'Translate the text to French.' } },
    { id: 'c', type: 'output', config: { label: 'Out' } },
  ], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'Your order has shipped.');
  assert.equal(generic.error, null);
  assert.ok(generic.trace[1].output.trim());
});

// ------------------------------------------------------------------ routes that build their prompts inline

let base;
let cookie;
let server;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('routes: start the demo server and sign in as the persona', async () => {
  server = createApp().listen(0);
  await new Promise((ok) => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/auth/session', { name: 'Faisal', email: 'faisal@oceanmind.demo' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 1);
});

/** Drive /api/agent/step exactly like AgentsLesson.jsx run(). */
async function runAgent(goal, tools, maxSteps = 10) {
  const history = [];
  for (let n = 0; n < maxSteps; n++) {
    const r = await call('POST', '/api/agent/step', { topicId: 'ai-agents', goal, tools, history });
    assert.equal(r.status, 200, `agent step ${n + 1} for "${goal}": ${r.body?.error}`);
    assert.ok(typeof r.body.thought === 'string' && r.body.thought, 'every step thinks out loud');
    if (r.body.done) return { history, final: r.body.final };
    assert.ok(tools.includes(r.body.action.tool), `"${r.body.action.tool}" was not one of the picked tools ${tools}`);
    history.push({ thought: r.body.thought, action: r.body.action, observation: r.body.observation });
  }
  assert.fail(`agent never finished "${goal}"`);
}

test('agent: the story refund run uses the real calculator results', async () => {
  const { history, final } = await runAgent(STORY_AGENT_GOAL, ['calculator', 'notes']);
  assert.deepEqual(history.map((h) => h.action.tool), ['calculator', 'calculator', 'notes']);
  assert.equal(history[0].observation, '3 * 49.99 = 149.97');
  assert.equal(history[1].observation, '149.97 - 49.99 = 99.98');
  assert.match(history[2].observation, /^Saved note #1: ".*99\.98/);
  assert.match(final, /99\.98/);
});

test('agent: the built-in suggested goals and a generic goal finish with the picked tools only', async () => {
  const picks = [['calculator', 'docsearch'], ['calculator', 'notes'], ['docsearch', 'notes'], ['notes'], ['clock', 'notes']];
  for (const goal of [...SUGGESTED_GOALS, 'Plan a small team offsite and write down the plan']) {
    for (const tools of picks) {
      const { history, final } = await runAgent(goal, tools);
      assert.ok(final && !FAKE.test(final), `"${goal}" with ${tools}: a real final answer`);
      for (const h of history) assert.ok(!/^Calculator error/.test(h.observation), `"${goal}": calculator input must be plain arithmetic`);
    }
  }
  // the budget goal gets the real numbers when it has a calculator
  const { history } = await runAgent(SUGGESTED_GOALS[1], ['calculator', 'notes']);
  assert.ok(history.some((h) => h.observation === '1200 + 80*8 = 1840' || /= 1840$/.test(h.observation)), 'budget total from the calculator');
});

test('integration guide and the Reef Café LLM bot answer from the real inputs', async () => {
  const guide = await call('POST', '/api/flow/guide', { nodes: STORY_FLOW.nodes, edges: STORY_FLOW.edges });
  assert.equal(guide.status, 200);
  assert.ok(guide.body.text.includes('Classify & draft') && guide.body.text.includes('Policy check'), 'guide names the real nodes');
  assert.ok(!FAKE.test(guide.body.text));

  const chat = (intents, content) => call('POST', '/api/ai/chat', { system: reefSystem(intents), messages: [{ role: 'user', content }] });
  const vegan = await chat(REEF_INTENTS, 'Do you have anything plant-based?');
  assert.equal(vegan.status, 200);
  assert.match(vegan.body.text, /kelp/i, 'plant-based → the vegan kelp noodle bowl');
  const noRefunds = await chat(REEF_INTENTS, 'Can I get my money back?');
  assert.ok(noRefunds.body.text.trim() && !/14 days/.test(noRefunds.body.text), 'no refunds intent → does not invent a policy');
  const withRefunds = await chat([...REEF_INTENTS, { name: 'refunds', reply: 'Refunds within 14 days with your receipt.' }], 'Can I get my money back?');
  assert.match(withRefunds.body.text, /14 days/, 'money back → the refunds intent');
});

test('routes: stop the demo server', () => {
  server.close();
});
