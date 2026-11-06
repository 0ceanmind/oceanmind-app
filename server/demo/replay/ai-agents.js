/**
 * Replay corpus for AI Agents (pitch demo only). Every function is pure and
 * deterministic: it turns the real inputs of a model call (goal, missed
 * concepts, zone, real tool observations, the flow's real input) into the
 * text a model would have written. The routes, validators, shuffles and tools
 * around it are the real ones, so everything here must pass them first time.
 */
import chatbots from './chatbots.js';

/* ------------------------------------------------ small text helpers */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => {
  const t = clean(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '')}…`;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const stripEnd = (s) => clean(s).replace(/[.!?…\s]+$/, '');

/** The learner's goal, trimmed for quoting inside a sentence. */
const quoteGoal = (goal) => stripEnd(clip(goal, 150));

/* ------------------------------------------------ knowledge map + placement */

const CONCEPTS = {
  loop: 'The agent loop',
  tools: 'Tools & function calling',
  routing: 'Routing',
  wva: 'Workflows vs. agents',
  guard: 'Guardrails & human approval',
  memory: 'Memory & context',
  evals: 'Evaluation & observability',
  multi: 'Multi-agent systems',
};

const LABEL = {
  loop: 'the agent loop',
  tools: 'tools & function calling',
  routing: 'routing',
  wva: 'workflows vs. agents',
  guard: 'guardrails & human approval',
  memory: 'memory & context',
  evals: 'evaluation & observability',
  multi: 'multi-agent systems',
};

/** One plain-language line per concept, used to teach a missed concept explicitly. */
const TEACH = {
  loop: 'an agent thinks, acts with one tool, observes the real result and repeats until the goal is met or a stopping rule fires',
  tools: 'the model only asks for a tool call; your code runs it and hands back the real result',
  routing: 'routing means classifying each input first, then handing it to the prompt, tools and rules built for that case',
  wva: 'a workflow follows steps you wrote, an agent chooses its own path, and the simplest one that works wins',
  guard: 'guardrails decide what the agent may do alone and what must wait for a person, before it happens',
  memory: 'memory is a budget: as the context window fills, you keep, drop or summarise turns',
  evals: 'evaluation means testing on real cases and logging every step, so failures are visible and fixable',
  multi: 'multi-agent systems split work across coordinated agents, at roughly 10–15× the tokens of one agent',
};

/** A concrete one-liner for the step that teaches a missed concept (the intro holds the definition). */
const STEP_TEACH = {
  loop: 'Watch for the moment an observation changes the next decision: that feedback is the whole trick.',
  tools: 'The model only writes a request; your code does the work and reports back the real result.',
  routing: 'Think of a mail room: one quick sort, then each email goes to the desk that knows how to handle it.',
  wva: 'The question is never “could an agent do this?” but “does this need one?”',
  guard: 'The rule that matters most: anything irreversible is approved before it happens, not logged after.',
  memory: 'Watch which facts fall out first as the budget shrinks.',
  evals: 'A second check before anything ships, plus a log of every step, is how you catch failures before customers do.',
  multi: 'More agents means more capability and roughly 10–15× the tokens, so the bar for splitting is high.',
};

const knowledgeMap = {
  mustKnow: [
    { name: CONCEPTS.loop, desc: 'An agent repeats think → act → observe until the goal is met or a stopping condition fires.' },
    { name: CONCEPTS.tools, desc: 'The model picks a tool and its arguments; your code runs it and returns the real result.' },
    { name: CONCEPTS.routing, desc: 'Classify each input first, then hand it to the prompt, model or playbook built for that case.' },
    { name: CONCEPTS.wva, desc: 'Workflows follow paths you coded; agents choose their own. Use the simplest one that does the job.' },
  ],
  needToKnow: [
    { name: CONCEPTS.guard, desc: 'Step budgets, tool allow-lists, spend caps and human sign-off on risky actions keep autonomy safe.' },
    { name: CONCEPTS.memory, desc: 'What an agent keeps, drops or summarises as a conversation outgrows its context window.' },
    { name: CONCEPTS.evals, desc: 'Logging every thought, tool call and result, and testing on real cases, so you can see and fix failures.' },
    { name: CONCEPTS.multi, desc: 'Several agents coordinated by an orchestrator or as peers: more capable, but roughly 10–15× the tokens.' },
  ],
};

// Easy → hard. The pitch plan answers q3 "no idea" and q5 wrong, so the missed
// concepts are Routing and Guardrails & human approval.
const questions = [
  {
    text: 'What does an AI agent repeat until its goal is met?',
    concept: CONCEPTS.loop,
    options: ['Train, test, then deploy itself', 'Think, act with a tool, observe the result', 'Retrieve one document, then answer once', 'Ask the user to approve every word'],
    correctIndex: 1,
    explanation: 'An agent runs a loop: it decides an action, calls a tool, reads the real result, and repeats until the goal is met or it is stopped.',
  },
  {
    text: 'When an agent "uses a tool", who actually runs the tool?',
    concept: CONCEPTS.tools,
    options: ['Your application code, which returns the result', 'The model, inside its own weights', 'The user, by copying the request', 'The tool triggers itself on a schedule'],
    correctIndex: 0,
    explanation: 'The model only outputs a structured request (tool name + arguments). Your code executes it and feeds the real observation back.',
  },
  {
    text: 'A support inbox gets refunds, bug reports and sales leads. Which pattern should handle it first?',
    concept: CONCEPTS.routing,
    options: ['One giant prompt that handles every case', 'Parallelization: answer each email three times', 'Routing: classify, then send to a specialist', 'Fine-tune a new model for each customer'],
    correctIndex: 2,
    explanation: 'Routing classifies each input and hands it to a prompt, model or playbook built for that case: separate concerns, each one testable.',
  },
  {
    text: 'When is a fixed workflow a better choice than an autonomous agent?',
    concept: CONCEPTS.wva,
    options: ['When the number of steps is unknown', 'When the task needs open-ended search', 'Whenever the task involves an LLM', 'When the steps are known in advance'],
    correctIndex: 3,
    explanation: 'If you can map the steps ahead of time, code them: a workflow is cheaper, faster and testable. Agents earn their cost on open-ended tasks.',
  },
  {
    text: 'Your support agent can issue refunds. Which guardrail matters most for that action?',
    concept: CONCEPTS.guard,
    options: ['A step budget of 10 loops', 'Human approval before any money moves', 'Logging every tool call afterwards', 'A cheaper model for refund emails'],
    correctIndex: 1,
    explanation: 'A refund is irreversible. Budgets and logs limit or record damage; only an approval gate stops a wrong refund before it happens.',
  },
  {
    text: 'A 40-message support thread no longer fits the context window. What best preserves the key facts?',
    concept: CONCEPTS.memory,
    options: ['Keep only the last five messages', 'Drop the system prompt to save space', 'Summarise old turns into a running case note', 'Raise the model temperature'],
    correctIndex: 2,
    explanation: 'A sliding window silently drops early facts such as the order number. A rolling summary keeps them at a fraction of the tokens.',
  },
];

/* ------------------------------------------------ learner context */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Map a free concept string (from the quiz answers) to a concept key. */
function conceptKey(name) {
  const n = norm(name);
  for (const [k, v] of Object.entries(CONCEPTS)) if (norm(v) === n) return k;
  if (/rout|classif|triage/.test(n)) return 'routing';
  if (/guard|human|approv|safe/.test(n)) return 'guard';
  if (/memor|context/.test(n)) return 'memory';
  if (/multi|orchestr/.test(n)) return 'multi';
  if (/eval|observ|test|log/.test(n)) return 'evals';
  if (/workflow/.test(n)) return 'wva';
  if (/tool|function/.test(n)) return 'tools';
  if (/loop|react/.test(n)) return 'loop';
  return null;
}

const STORY_EMAIL = 'Hi, my order #4471 arrived with a cracked lid. Can I get a replacement? — Maya';
const REFUND_GOAL = 'A customer was charged 3 times at 49.99 — work out the refund owed and note it for the team';
const SUGGESTED = {
  research: 'Research what tools an AI agent needs and write a summary note',
  budget: 'Calculate a budget: venue 1200 + 80 people at 8 each, check it fits under 2000, note the result',
  guardrails: 'Find what the source documents say about guardrails and save the three key points as notes',
};

/** What kind of project the learner's goal describes. */
function goalKind(goal) {
  const g = String(goal ?? '').toLowerCase();
  if (!g.trim()) return 'none';
  if (/support|customer|e-?mail|inbox|ticket|help ?desk|complain|refund|enquir|inquir/.test(g)) return 'support';
  if (/market|campaign|\bads?\b|advert|social media|brand|launch|seo|newsletter|copywrit/.test(g)) return 'marketing';
  if (/research|report|analy[sz]|summari[sz]|papers|literature|competitor/.test(g)) return 'research';
  return 'other';
}

/** Parse "rated 2/5, reasons: Too hard, note: "…"" into a short human phrase. */
function feedbackPhrase(previousFeedback) {
  const f = String(previousFeedback ?? '');
  const reasons = (f.match(/reasons: ([^,]+(?:, (?!note)[^,]+)*)/)?.[1] ?? '').split(', ').map((r) => r.trim()).filter((r) => r && r !== '—');
  const fixes = {
    'Too easy': 'it skips the basics and goes deeper',
    'Too hard': 'it slows down and builds intuition before jargon',
    Repetitive: 'it uses fresh hands-on blocks instead of repeating ideas',
    'Wrong topic': 'it sticks closely to what you asked for',
    'Wasn’t helpful': 'every step now ends in something you do, not just read',
    "Wasn't helpful": 'every step now ends in something you do, not just read',
  };
  const said = reasons.map((r) => fixes[r]).filter(Boolean);
  return { reasons, change: said.length ? said.join(', and ') : 'it is rebuilt from scratch around what you told us' };
}

/** 'Twilight Zone', 'twilight' or 'Intermediate' → 'twilight' (defaults to twilight). */
const zoneOf = (z) => {
  const s = String(z ?? '').toLowerCase();
  if (/sunlight|beginner/.test(s)) return 'sunlight';
  if (/midnight|advanced/.test(s)) return 'midnight';
  return 'twilight';
};

function makeCtx(ctx = {}) {
  const zone = zoneOf(ctx.zone);
  const goal = clean(ctx.goal) || null;
  const noIdeaKeys = new Set((ctx.noIdea ?? []).map(conceptKey).filter(Boolean));
  const missedKeys = [...new Set([...noIdeaKeys, ...(ctx.missed ?? []).map(conceptKey).filter(Boolean)])];
  return {
    zone,
    goal,
    kind: goalKind(goal),
    missed: missedKeys,
    noIdea: noIdeaKeys,
    scorePct: Number.isFinite(Number(ctx.scorePct)) ? Math.round(Number(ctx.scorePct)) : null,
    supportNote: clean(ctx.supportNote) || null,
    previousFeedback: clean(ctx.previousFeedback) || null,
    redesign: Boolean(ctx.redesign),
    taught: new Set(),
  };
}

/** The concept as a question topic: "the agent loop question", never "the the agent loop question". */
const qLabel = (k) => LABEL[k].replace(/^the /, '');

/** A "your gap" callout, placed on the first step that teaches a missed concept. */
function gapNote(c, keys) {
  const todo = keys.filter((k) => c.missed.includes(k) && !c.taught.has(k));
  if (!todo.length) return '';
  todo.forEach((k) => c.taught.add(k));
  if (todo.length === 1) {
    const [k] = todo;
    return c.noIdea.has(k)
      ? `**Your gap:** you said “no idea” to the ${qLabel(k)} question on your depth check, so this step is built for you. ${STEP_TEACH[k]}\n\n`
      : `**Your gap:** you missed the ${qLabel(k)} question on your depth check. ${STEP_TEACH[k]}\n\n`;
  }
  const named = todo.map((k) => (c.noIdea.has(k) ? `${LABEL[k]} (you said “no idea”)` : LABEL[k]));
  return `**Your gaps:** this step covers ${list(named)} from your depth check. ${todo.slice(0, 2).map((k) => STEP_TEACH[k]).join(' ')}\n\n`;
}

const depth = (c, sun, twi, mid) => (c.zone === 'sunlight' ? sun : c.zone === 'midnight' ? mid : twi);

/* ------------------------------------------------ lesson steps */

const MAX_BODY = 880; // validateSteps truncates longer bodies mid-sentence
/** Keep a body inside the limit: shorten the gap callout first (the intro teaches it too), then drop trailing lines. */
function fitBody(body) {
  let b = body;
  if (b.length > MAX_BODY) b = b.replace(/^(\*\*Your gaps?:\*\*.*?(?:depth check|built for you)\.) [^\n]*/, '$1');
  while (b.length > MAX_BODY && b.includes('\n')) b = b.slice(0, b.lastIndexOf('\n')).trimEnd();
  return b;
}
const step = (title, body, block) => (block ? { title, body: fitBody(body), block } : { title, body: fitBody(body) });

const STEPS = {
  anatomy(c) {
    if (c.kind === 'support') {
      return step('Your support assistant in one picture',
        `${gapNote(c, ['tools'])}Before any jargon, here is the whole assistant you're building. Click each box, left to right, and read what it does.
- the **model** reads and writes, but only **tools** can look up an order
- a **policy check** reviews every draft
- anything that moves money waits for **a person**

Notice there's no box where the model acts alone on a customer. That's on purpose.`,
        {
          type: 'diagram',
          nodes: [
            { id: 'email', label: 'Customer email', detail: 'Maya: order #4471 arrived with a cracked lid. The raw text is all the assistant starts with.' },
            { id: 'router', label: 'Classify', detail: 'One quick model call labels the email: damaged item, refund, delivery or account.' },
            { id: 'lookup', label: 'Order lookup', detail: 'A tool your code runs: it fetches order #4471 so the reply uses facts, not guesses.' },
            { id: 'draft', label: 'Draft reply', detail: 'The model writes a reply using the playbook for that category and the order data.' },
            { id: 'check', label: 'Policy check', detail: 'A second call checks the draft: no promises the policy does not allow.' },
            { id: 'human', label: 'Human approval', detail: 'Refunds and credits stop here until a person clicks approve.' },
            { id: 'send', label: 'Send reply', detail: 'Only checked, safe replies go out. Every step is logged.' },
          ],
          edges: [
            { from: 'email', to: 'router' },
            { from: 'router', to: 'lookup', label: 'needs data' },
            { from: 'lookup', to: 'draft' },
            { from: 'draft', to: 'check' },
            { from: 'check', to: 'human', label: 'risky' },
            { from: 'check', to: 'send', label: 'safe' },
            { from: 'human', to: 'send', label: 'approved' },
          ],
        });
    }
    return step('What makes something an agent',
      `${gapNote(c, ['tools'])}A chatbot answers. An **agent** gets things done: a model that can call **tools** and loop until its goal is met. Click each box, left to right.
- the **goal** is what you ask for
- the **model** decides the next action, it doesn't execute it
- **tools** do the real work and return real results
- the loop ends when the goal is met or a limit is hit${c.goal ? `\n\nKeep your own goal in mind: “${quoteGoal(c.goal)}”.` : ''}`,
      {
        type: 'diagram',
        nodes: [
          { id: 'goal', label: 'Goal', detail: 'What you want done, in plain words, e.g. “work out the event budget”.' },
          { id: 'model', label: 'Model decides', detail: 'The LLM reads the goal and everything seen so far, then picks ONE next action.' },
          { id: 'tool', label: 'Tool runs', detail: 'Your code runs the chosen tool: a calculator, a search, an API call.' },
          { id: 'obs', label: 'Real result', detail: 'The actual output goes back to the model, so its next decision is based on facts.' },
          { id: 'done', label: 'Done or limit', detail: 'The run ends when the goal is met, or when a step budget or a human stops it.' },
        ],
        edges: [
          { from: 'goal', to: 'model' },
          { from: 'model', to: 'tool', label: 'act' },
          { from: 'tool', to: 'obs', label: 'observe' },
          { from: 'obs', to: 'done', label: 'goal met?' },
        ],
      });
  },

  wva(c) {
    const gap = gapNote(c, ['wva']);
    const block = { type: 'workflow-vs-agent' };
    if (c.kind === 'support') {
      return step('Workflow or agent? Start with your inbox',
        `${gap}Before writing a single prompt, decide how much freedom your assistant gets. Answer the four questions for **your support inbox**:
- Steps always the same? **No**: every email is different
- Decisions depend on what you look up? **Yes**: order status, policy
- Open-ended search? **No**: a handful of known playbooks
- A wrong action is cheap to undo? **No**: a sent promise can't be unsent

Notice where that lands: **workflow + human in the loop**. ${depth(c,
          'Everything you build in this dive follows that shape.',
          'Everything you build next follows that shape.',
          'Most production support systems land here: autonomy inside each playbook, never over money.')}`, block);
    }
    if (c.kind === 'marketing') {
      return step('Does your campaign work need an agent?',
        `${gap}Run your goal, “${quoteGoal(c.goal)}”, through the tree. For a campaign built from a brief, the honest first answer is **Yes**: the steps (audience, copy, plan) are known in advance.

Notice the verdict: **use a fixed workflow**. That's good news, not a let-down:
- it's cheaper and faster than an agent
- every step can be tested on its own
- the flow you build later in this dive is exactly that workflow

Press **↺ Run it again** and answer for a messier task, like replying to every comment on a live campaign.`, block);
    }
    if (c.kind === 'research') {
      return step('Research is where agents earn their keep',
        `${gap}Answer the tree for your goal, “${quoteGoal(c.goal)}”:
- Steps known in advance? **No**: you don't know what the first search will turn up
- Decisions depend on intermediate results? **Yes**: each finding shapes the next query
- Open-ended search space? **Yes**

Notice the verdict: **an agent is justified**. Research is the textbook case, which is also why it needs the step budgets you'll meet later. Then press **↺ Run it again** for a routine task and watch the answer change.`, block);
    }
    return step(c.kind === 'other' ? 'Does your idea need an agent at all?' : 'Does this task even need an agent?',
      `${gap}The most common mistake is reaching for an agent when a fixed workflow would be cheaper, faster and safer. Answer the four questions ${c.kind === 'other' ? `for your goal, “${quoteGoal(c.goal)}”` : 'for a task you actually have in mind'}, then press **↺ Run it again** and try another.
- if you can list the steps in advance, you land on a **workflow**
- if the path depends on what you discover, you land on an **agent**
- if mistakes are expensive, you get **a human in the loop**

${depth(c,
        'An agent is a model that chooses its own next step. A workflow follows steps you wrote.',
        'Notice how few tasks truly need full autonomy.',
        'Treat autonomy as a cost you justify, not a feature you add.')}`, block);
  },

  loop(c) {
    const gap = gapNote(c, ['loop']);
    if (c.kind === 'support') {
      return step('The loop your assistant runs',
        `${gap}Every agent, including your support assistant, runs this cycle. Let the ring turn once, then click each stage:
- **Think**: read the email and everything learned so far
- **Act**: call one tool, e.g. look up order #4471
- **Observe**: the real result lands back in context
- **Done?**: stop when the reply is ready, or when the step budget runs out

Notice the model never runs anything itself. It asks; your code executes and reports back.`, { type: 'agent-loop' });
    }
    return step('The loop at the heart of every agent',
      `${gap}Every agent, from a coding assistant to ${c.kind === 'research' ? 'your research agent' : c.kind === 'marketing' ? 'a campaign assistant' : 'a travel planner'}, runs this same cycle. Let the ring turn once, then click each stage:
- **Think**: decide the single next action from the goal and what's known
- **Act**: call a tool, such as a search or a calculator
- **Observe**: the real result is added to context
- **Done?**: finish, or go round again

${depth(c,
        'Notice the model is the brain, and the tools are its hands.',
        'Notice the model never executes anything itself: it requests a tool call, your code runs it, and the observation is what makes the next thought smarter.',
        'The Done? check is where production agents fail: without a stopping rule the loop burns tokens forever.')}`, { type: 'agent-loop' });
  },

  patterns(c, pattern) {
    const initial = pattern ?? (c.missed.includes('routing') ? 'routing' : 'chaining');
    const keys = initial === 'routing' ? ['routing'] : initial === 'orchestrator' ? ['multi'] : initial === 'evaluator' ? ['evals'] : [];
    const gap = gapNote(c, keys);
    const block = { type: 'pattern-explorer', initial };
    if (initial === 'routing' && c.kind === 'support') {
      return step('Route each email to the right playbook',
        `${gap}This is the pattern your inbox needs: **routing**. Click **Router LLM** in the diagram, then compare it with **Prompt chaining** and **Autonomous agent**.
- one small, fast call classifies the email: damaged item, refund, delivery, account
- each category gets its own prompt, tools and rules
- ${depth(c, 'if the router is unsure, a person decides', 'low-confidence emails go to a person, not a best guess', 'set a confidence floor per category: refunds need far more certainty than “where is my order?”')}

Notice the router never writes the reply. Keeping classification separate is what makes each playbook testable.`, block);
    }
    if (initial === 'routing') {
      return step('Routing: one classifier, many specialists',
        `${gap}Click **Router LLM**, then the two specialists. Routing sends each input to the handler built for it:
- a refund question and a bug report need different prompts, tools and rules
- easy questions can go to a small, cheap model
- the router only classifies, so it's quick to test

Then click through the other pills and notice they're ordered from least to most autonomy.`, block);
    }
    if (initial === 'parallel') {
      return step('Parallel branches for campaign work',
        `${gap}Click **Parallelization**. Your campaign work splits naturally:
- **audience analysis** and **ad copy** don't depend on each other, so they run at the same time
- an **aggregator** merges them into one plan
- voting is the other flavour: ask several times, keep the consensus

${depth(c, 'Click the Aggregator node to see its job.', 'Notice the tradeoff: faster and sturdier, but every branch costs another call.', 'Notice the tradeoff: branches cut latency, but cost multiplies with each one, so only split when the sections are genuinely independent.')} Your flow later in this dive uses exactly this shape.`, block);
    }
    if (initial === 'orchestrator') {
      return step('Orchestrator–workers for open-ended research',
        `${gap}Click **Orchestrator–workers**, then the **Orchestrator** node. For research, nobody knows the subtasks up front:
- the orchestrator plans them on the fly and hands each to a worker
- workers search or read in parallel
- a synthesizer merges their findings

${depth(c, 'Compare it with Prompt chaining, where every step is fixed in advance.', 'Notice the tradeoff: it handles unpredictable work, but the orchestrator becomes the quality bottleneck.', 'Notice the tradeoff: flexible decomposition, but the orchestrator is a single point of failure and every worker adds tokens. Log its plans so you can see why it split the task that way.')}`, block);
    }
    if (initial === 'evaluator') {
      return step('Patterns before autonomy: the evaluator loop',
        `${gap}Click through all seven patterns; they run from least to most autonomy. Then land on **Evaluator–optimizer** and click the **Evaluator** node.
- one call drafts, a second scores the draft against explicit criteria
- failing drafts go back with feedback until one passes
- it only pays off when you can write the criteria down

Notice that most real systems stop somewhere before **Autonomous agent**, and are better for it.`, block);
    }
    return step('Patterns that come before autonomy',
      `${gap}Click each pill from left to right; the patterns run from least to most autonomy.
- **Prompt chaining**: fixed steps, with a gate that checks the middle
- **Routing**: classify first, then hand off to a specialist
- **Evaluator–optimizer**: one call drafts, another critiques

Notice that most real products stop before **Autonomous agent**. Reach for it only when the steps truly can't be known in advance.`, block);
  },

  live(c) {
    const gap = gapNote(c, ['tools', 'loop']);
    const block = { type: 'live-agent' };
    if (c.kind === 'support') {
      return step('Watch an agent work a refund',
        `${gap}Now a real agent with real tools. Type this goal: **“${REFUND_GOAL}”**. Keep **Calculator** ticked, untick **Document search**, tick **Notes**, then press **▶ Run agent**.

Watch for three things:
- it uses the calculator instead of doing the maths in its head
- each observation changes the next thought
- it writes the refund up for a person instead of paying it: ${depth(c, 'that is the safety rail you meet next', "that's the rail you'll switch on next", 'the approval gate lives outside the agent, where it can’t be argued with')}`, block);
    }
    if (c.kind === 'research') {
      return step('Run a research agent for real',
        `${gap}Pick the first suggestion, **“${SUGGESTED.research}”**. **Document search** is already ticked; tick **Notes** too, then press **▶ Run agent**.
- every search really runs against the course documents
- read each observation, then the next thought: the agent refines its query based on what it found
- it only writes the note once it has something real to put in it

${depth(c, 'Then untick Notes and run again to see how it copes.', 'Then untick Notes and run again: a good agent says what it could not do.', 'Midnight challenge: count the steps. Each one is a model call, which is why research agents need a step budget.')}`, block);
    }
    return step('Run a real agent with real tools',
      `${gap}Click the budget suggestion, **“${SUGGESTED.budget}”**. Keep **Calculator** ticked, add **Notes**, then press **▶ Run agent**.
- the calculator really runs: watch **1200 + 80*8 = 1840** come back
- the next thought uses that number to check the 2000 limit
- the note it saves is built from real results, not guesses

${c.goal ? `Then try a small piece of your own goal, “${quoteGoal(c.goal)}”, and see which tools it reaches for.` : depth(c, 'Then type a goal of your own and watch the loop again.', 'Then untick a tool it needs and run again: a well-behaved agent says what it could not do.', 'Then untick a tool it needs: the right behaviour is to stop and say so, not to invent a result.')}`, block);
  },

  guard(c) {
    const gap = gapNote(c, ['guard', 'evals']);
    const block = { type: 'guardrails' };
    if (c.kind === 'support') {
      return step('Guardrails before it touches a customer',
        `${gap}Press **▶ Run the agent** with every rail off and watch the counters: 1,284 rows deleted, 47 loops, $38 burned. Switch on **Step budget** and run again: the loop stops, but the rows are already gone. Switch on **Human approval** last: it guards the earliest risky action, so the delete never happens.

For your support assistant, the non-negotiables:
- **Human approval** on refunds, credits and anything that promises money
- a **tool allow-list**: it may read orders, never edit them
- **Observability**: every draft, tool call and verdict logged`, block);
    }
    return step('Guardrails: autonomy with limits',
      `${gap}Press **▶ Run the agent** once with every rail off and watch the counters climb. Then turn rails on one at a time and run again, leaving **Human approval** for last, because it stops the run earliest.
- **Step budget** ends runaway loops
- **Tool allow-list** blocks actions it was never meant to take
- **Spend cap** and **Observability** limit and record the damage

${depth(c,
        'Notice that each rail stops a different kind of failure.',
        `Notice which rails prevent harm and which only limit or record it.${c.goal ? ` Ask which ones your goal, “${quoteGoal(c.goal)}”, can't live without.` : ''}`,
        'Notice the difference between preventive rails (approval, allow-list) and detective ones (logs). You need both, and only the first kind stops an irreversible action.')}`, block);
  },

  flow(c) {
    const gap = gapNote(c, ['evals']);
    if (c.kind === 'support') {
      return step('Build and run your triage flow',
        `${gap}Time to build it. Maya's email is already in the test input. Turn the starter into a two-step triage flow:
- rename **Process** to **Classify & draft**
- add a second **✨ LLM step** and name it **Policy check**
- rewire it as **Incoming request** → **Classify & draft** → **Policy check** → **Result**, then press **▶ Run flow**

Each node's real output types out on its card and lands in the results on the right. The first labels the email and drafts a reply; the second checks that draft against policy before anything is sent. ${depth(c, 'That second check is cheap insurance.', 'That second call is the **evaluator** pattern.', 'That second call is the **evaluator** pattern; in production you would also log its verdicts to measure how often drafts fail.')}`,
        { type: 'flow-builder', template: 'starter', goalHint: STORY_EMAIL });
    }
    if (c.kind === 'marketing') {
      // a goal that already reads like a brief is used as-is; otherwise a realistic sample brief
      const brief = /[$€£]s?d|weeks?|sign-?ups|launch/i.test(c.goal)
        ? clip(c.goal, 200)
        : 'Campaign brief: launch our new product, aimed at small-business owners. 4-week push, $5,000 budget, target 200 sign-ups.';
      return step('Build your campaign flow',
        `${gap}Your brief is already in the test input. The flow branches: **Audience analysis** and **Copywriter** each work from the brief on their own, then **Campaign plan** merges them. Press **▶ Run flow** and read each node's real output as it lands.
- click any LLM node to read or rewrite its prompt
- change the brief and run again: every output changes with it
- press **🔌 Integration guide** to see how this becomes code

Notice this is a workflow, not an agent, and it doesn't need to be anything more.`,
        { type: 'flow-builder', template: 'marketing', goalHint: brief });
    }
    if (c.kind === 'research') {
      const q = clip(stripEnd(c.goal).replace(/^(i want to |help me |please )/i, ''), 190);
      return step('Build a search-and-summarise flow',
        `${gap}Your question is in the test input. The **Search sources** step is a real tool: it searches the course documents. **Summarize** then turns the passages into three bullet points.
- press **▶ Run flow** and read the raw passages, then the summary
- notice the summary can only use what the search returned: that's **grounding**
- rewrite the question and run again

${depth(c, 'This is the simplest reliable research pipeline.', 'An agent would decide whether to search again; this flow always searches once. Start here, then add autonomy where it pays.', 'Next step in production: an evaluator node that checks every bullet is supported by a passage.')}`,
        { type: 'flow-builder', template: 'research', goalHint: q });
    }
    if (c.kind === 'other') {
      return step('Build a first version of your flow',
        `${gap}Your goal is already in the test input: “${quoteGoal(c.goal)}”. Start small:
- click **Process** and rewrite its prompt for your task
- add a **🔧 Tool** step if it needs real data, such as the calculator
- wire it through to **Result**, then press **▶ Run flow**

Read each node's real output as it lands on its card. ${depth(c, 'One good step beats five vague ones.', 'Add a second LLM step that checks the first one’s output: that’s the evaluator pattern, and it catches most bad answers.', 'Add a checker step, then save the flow and open the **🔌 Integration guide** to see how it maps to code.')}`,
        { type: 'flow-builder', template: 'starter', goalHint: clip(c.goal, 200) });
    }
    return step('Build and run a research flow',
      `${gap}The question is already in the test input. **Search sources** is a real tool that searches the course documents; **Summarize** turns what it finds into three bullet points.
- press **▶ Run flow** and read each node's real output as it lands
- click **Summarize** and tighten its prompt, then run again
- ${depth(c, 'type your own question into the test input', 'add a second LLM step that checks the summary against the passages', 'add a checker step, then open the **🔌 Integration guide** to see how it maps to code')}

Notice this is a workflow: the same steps every time. That's why it's easy to trust.`,
      { type: 'flow-builder', template: 'research', goalHint: 'When should I use a multi-agent system instead of a single agent?' });
  },

  memory(c) {
    const gap = gapNote(c, ['memory']);
    if (c.kind === 'support') {
      return step('What to remember across a long thread',
        `${gap}Support threads run long: the order number in message one, the complaint in message three, a follow-up a week later. The thread here is a shopper choosing a laptop, and all 9 turns fit to start with. With **Sliding window** on, drag the **context budget** down: the price cap drops out at 8 turns, the use-case at 6, and at 3 even the SwiftBook recommendation. Then switch to **Summarise old turns**.

Notice:
- a sliding window forgets the oldest facts first, often the ones that matter
- a summary keeps them at a fraction of the tokens

For your assistant: keep a short running case note, and re-fetch order data with a tool instead of trusting old turns.`, { type: 'memory' });
    }
    return step('Memory: what fits in the context window',
      `${gap}An agent only knows what's in its context window, and every turn costs tokens. All 9 turns of this laptop chat fit at first. With **Sliding window** on, drag the **context budget** down until the price cap, the use-case and finally the SwiftBook recommendation fall out. Then switch to **Summarise old turns**.
- **Keep everything**: nothing lost, but cost grows every turn
- **Sliding window**: cheap, but forgets the oldest facts first
- **Summarise old turns**: keeps the facts at a fraction of the tokens

${depth(c, 'Notice how one forgotten fact breaks the whole conversation.', 'Notice that the facts that matter most are often said first.', 'For long-running agents, combine a running summary with tools that re-fetch facts on demand, so memory never has to be trusted blindly.')}`, { type: 'memory' });
  },

  multi(c) {
    const gap = gapNote(c, ['multi']);
    if (c.kind === 'support') {
      return step('Does support need more than one agent?',
        `${gap}Watch the message packets fly between the agents, then switch between **Centralized** and **Decentralized**.
- the source files customer support under **moderate control**, where a hierarchy can fit: a triage lead delegating to billing, shipping and account specialists
- multi-agent systems use roughly **10–15× more tokens** than a single agent
- peer-to-peer is resilient but hard to trace, a poor fit when you must explain every reply

Notice the verdict for a first version: one agent with routed playbooks. Split into agents only when a playbook outgrows its prompt.`, { type: 'multi-agent' });
    }
    return step(c.kind === 'marketing' ? 'Specialist agents for a campaign' : 'One agent or many?',
      `${gap}Watch the message packets fly between the agents, then switch between **Centralized (orchestrator)** and **Decentralized (peer-to-peer)**.
- centralized: predictable and traceable, but the orchestrator is a bottleneck
- decentralized: resilient and parallel, but emergent and hard to stop
- either way, multi-agent systems use roughly **10–15× more tokens** than one agent

${c.kind === 'marketing' ? 'The source’s marketing example uses a director agent that merges specialist outputs. ' : ''}Notice the default answer is still one well-designed agent; split only when the work needs different expertise at once.`, { type: 'multi-agent' });
  },

  reliability(c) {
    const gap = gapNote(c, ['loop']);
    return step('Why long agent runs fail more often',
      `${gap}If each step of a run succeeds with probability **p**, a run of **x** steps is error-free with probability p^x. Slide **p** and watch the curve.
- at p = 0.95, a 10-step run is clean only about 60% of the time
- at p = 0.99, the same run is clean about 90% of the time
- every extra step multiplies in another chance to fail

Notice what this means for design: short loops, checkpoints and step budgets matter more than a clever prompt${c.goal ? `, especially for “${quoteGoal(c.goal)}”` : ''}.`,
      {
        type: 'simulator',
        title: 'Chance a run finishes with no errors',
        expr: '100*p^x',
        xVar: 'x',
        xRange: [1, 30],
        vars: [{ name: 'p', min: 0.8, max: 0.999, init: 0.95, step: 0.001 }],
        yLabel: '% of runs error-free',
      });
  },

  automation(c) {
    const gap = gapNote(c, ['guard']);
    return step('Where automation stops paying',
      `${gap}**x** is the share of emails your assistant sends on its own. Auto-sent emails skip review, but some go wrong, and the error rate **r** climbs as you automate harder cases. Each wrong reply costs **c**; each human review costs **h**.
- with the defaults, the cheapest point is automating about 19% of emails
- drop **c** to 20 and the sweet spot moves to about 80%
- raise **h** and automation pays off sooner

Notice that this curve, not a gut feeling, should set your router's confidence threshold.`,
      {
        type: 'simulator',
        title: 'Daily cost of 1,000 emails vs. share auto-sent',
        expr: '1000*(x*r*(1 + 4*x)*c + (1 - x)*h)',
        xVar: 'x',
        xRange: [0, 1],
        vars: [
          { name: 'r', min: 0.005, max: 0.05, init: 0.01, step: 0.001 },
          { name: 'c', min: 5, max: 200, init: 60, step: 1 },
          { name: 'h', min: 0.5, max: 5, init: 1.5, step: 0.1 },
        ],
        yLabel: 'daily cost',
      });
  },

  check(c) {
    const q = (text, options, correctIndex, explanation) => ({ type: 'check', question: { text, options, correctIndex, explanation } });
    if (c.kind === 'support') {
      if (c.zone === 'midnight') {
        return step('Check: tightening the router',
          'Last one. Think about where a wrong answer does the most damage, and which change stops it before a customer sees it.',
          q('Your router is 92% accurate. Which change most reduces harmful auto-sent replies?',
            ['Send low-confidence and refund emails to a human queue', 'Use the largest model for every email', 'Let the agent retry until it feels confident', 'Add more example emails to the reply prompt'],
            0,
            'A confidence floor plus a human queue for risky categories catches the misroutes before they reach a customer. The other options may raise accuracy a little, but none stops a wrong reply going out.'));
      }
      return step('Check: which reply needs a human?',
        'Last one. Think about which of these drafts can be undone, and which one moves money.',
        q('Which of these drafts should NEVER be sent without a person approving it?',
          ['“Thanks for writing in, we’re checking your order now.”', '“We’ve refunded the two duplicate charges of 49.99.”', '“Your replacement ships today; tracking to follow.”', '“Our team replies within one business day.”'],
          1,
          'It promises money back. Refunds and credits are irreversible, so a person approves them first; the other replies are routine or already covered by policy.'));
    }
    if (c.kind === 'marketing') {
      return step('Check: pick the pattern',
        'Last one. Think about which steps depend on each other.',
        q('Audience analysis and ad copy both start from the brief and don’t depend on each other. Which pattern fits?',
          ['An autonomous agent that decides the order', 'Parallelization, then an aggregator step', 'Routing to a single specialist', 'One long prompt that does everything'],
          1,
          'Independent sections can run at the same time and be merged afterwards. No step needs to decide what happens next, so an agent would add cost without adding value.'));
    }
    if (c.kind === 'research') {
      return step('Check: why research earns autonomy',
        'Last one. Think back to the decision tree.',
        q('Why does a research task justify an agent more than a fixed-form task does?',
          ['It always uses more tools', 'The next step depends on what was just found', 'It never needs a human', 'Research prompts are longer'],
          1,
          'Research is open-ended: each result changes the next query, so the path can’t be written in advance. That’s exactly when an agent’s loop beats a fixed workflow.'));
    }
    if (c.zone === 'sunlight') {
      return step('Check: agent or chatbot?',
        'One quick question to lock in the big idea.',
        q('What makes an AI agent different from a plain chatbot?',
          ['It uses a bigger model', 'It can act with tools, in a loop, toward a goal', 'It never makes mistakes', 'It only answers yes-or-no questions'],
          1,
          'A chatbot replies once. An agent chooses actions, calls tools, reads the real results and loops until its goal is met.'));
    }
    if (c.zone === 'midnight') {
      return step('Check: compounding errors',
        'Last one. Use what the reliability curve showed you.',
        q('Each step of a 12-step agent run succeeds 95% of the time. Roughly how often does the whole run succeed?',
          ['About 95%', 'About 88%', 'About 54%', 'About 12%'],
          2,
          '0.95^12 ≈ 0.54. Per-step errors multiply, so long runs fail far more often than any single step suggests. Shorter loops and checkpoints fight this.'));
    }
    return step('Check: stopping a runaway loop',
      'Last one. Think about which rail stops which failure.',
      q('An agent keeps retrying the same failing tool call. Which guardrail stops it?',
        ['A bigger context window', 'A friendlier system prompt', 'A step budget on the loop', 'Adding more tools'],
        2,
        'A step budget is a hard cap on iterations. The run ends even if the model never realises it is stuck.'));
  },
};

/** Step plans per goal kind and zone (keys into STEPS, with optional arg). */
const PLANS = {
  support: {
    sunlight: ['anatomy', 'loop', 'wva', ['patterns', 'routing'], 'live', 'guard', 'flow', 'check'],
    twilight: ['wva', 'loop', ['patterns', 'routing'], 'live', 'guard', 'flow', 'memory', 'check'],
    midnight: ['wva', ['patterns', 'routing'], 'automation', 'live', 'guard', 'memory', 'multi', 'flow', 'check'],
  },
  marketing: {
    sunlight: ['anatomy', 'wva', ['patterns', 'parallel'], 'live', 'guard', 'flow', 'check'],
    twilight: ['wva', ['patterns', 'parallel'], 'loop', 'live', 'guard', 'flow', 'check'],
    midnight: ['wva', ['patterns', 'parallel'], 'multi', 'reliability', 'live', 'guard', 'flow', 'check'],
  },
  research: {
    sunlight: ['anatomy', 'loop', 'live', 'wva', 'guard', 'flow', 'check'],
    twilight: ['wva', 'loop', ['patterns', 'orchestrator'], 'live', 'memory', 'guard', 'flow', 'check'],
    midnight: ['wva', ['patterns', 'orchestrator'], 'multi', 'reliability', 'live', 'memory', 'guard', 'flow', 'check'],
  },
  general: {
    sunlight: ['anatomy', 'loop', 'live', 'wva', 'guard', 'flow', 'check'],
    twilight: ['loop', 'wva', ['patterns', null], 'live', 'guard', 'memory', 'flow', 'check'],
    midnight: ['wva', ['patterns', 'evaluator'], 'reliability', 'live', 'multi', 'memory', 'guard', 'flow', 'check'],
  },
};

function lessonTitle(c) {
  const t = {
    support: depth(c, 'Your first support-email agent', 'Your support-email agent, from inbox to guarded reply', 'Designing a production support agent'),
    marketing: depth(c, 'Your first marketing flow', 'Your marketing flow, from brief to launch plan', 'Marketing agents: patterns, cost and control'),
    research: depth(c, 'Your first research agent', 'A research agent that searches, reads and reports', 'Research agents in production'),
    other: `Your goal, step by step: ${clip(cap(stripEnd(c.goal ?? '').replace(/^i (want|would like|need) to /i, '')), 60)}`,
    none: depth(c, 'Your first AI agent, from loop to live run', 'AI agents: the loop, the patterns and the guardrails', 'Agents in production: tradeoffs and failure modes'),
  }[c.kind];
  return c.supportNote || c.previousFeedback ? `Rebuilt for you: ${t}` : t;
}

function lessonIntro(c) {
  const parts = [];
  if (c.supportNote || c.previousFeedback) {
    const { change } = feedbackPhrase(c.previousFeedback);
    parts.push(`We rebuilt this dive after your feedback, so ${change}.${c.supportNote ? ` Our support team’s note: “${stripEnd(clip(c.supportNote, 160))}.”` : ''}`);
  }
  if (c.goal) parts.push(c.redesign ? `Lulu rebuilt this dive around your goal: “${quoteGoal(c.goal)}.”` : `You told us: “${quoteGoal(c.goal)}.”`);
  const plan = {
    support: depth(c,
      'This dive builds it from zero: what an agent is, the loop it runs, when it should and shouldn’t act alone, then a live refund run, guardrails and a triage flow you wire yourself.',
      'This dive builds exactly that at Twilight depth: decide how autonomous it should be, route each email to the right playbook, watch a real agent work a refund, add guardrails, then wire and run your own triage flow.',
      'This dive treats it as a production system: autonomy boundaries, routing with a confidence floor, the economics of human review, memory, and a triage flow with a built-in policy check.'),
    marketing: 'We’ll check which parts of your campaign work genuinely need an agent (fewer than you’d think), then build a parallel flow that turns a brief into audience insight, ad copy and a launch plan.',
    research: 'Research is the classic case for real autonomy, because each step depends on what the last search found. You’ll see the loop, the orchestrator pattern, a live research run and a search-and-summarise flow.',
    other: 'Every step below is framed around that goal: whether it needs an agent at all, the loop it would run, a live run with real tools, the guardrails it needs and a first flow you can build on.',
    none: depth(c,
      'This dive starts from zero: what makes something an agent, the loop it runs, a live agent using real tools, and when not to build one at all.',
      'This dive goes past the basics into how agents actually work: the loop, the patterns that come before autonomy, a live run with real tools, guardrails, memory and a flow you run yourself.',
      'This dive is about agents in production: when autonomy pays, why long runs fail, multi-agent tradeoffs, memory limits and the guardrails that keep it all safe.'),
  }[c.kind];
  parts.push(plan);
  if (c.missed.length) {
    const noIdea = c.missed.filter((k) => c.noIdea.has(k)).map((k) => LABEL[k]);
    const wrong = c.missed.filter((k) => !c.noIdea.has(k)).map((k) => LABEL[k]);
    const flagged = [noIdea.length ? `said “no idea” to ${list(noIdea)}` : '', wrong.length ? `missed ${list(wrong)}` : ''].filter(Boolean).join(' and ');
    const teach = c.missed.slice(0, c.supportNote ? 2 : 3).map((k) => TEACH[k]);
    parts.push(`On your depth check you ${flagged}, so ${c.missed.length > 1 ? 'those get' : 'that gets'} extra care along the way. The short version: ${cap(teach.join('; '))}.`);
  } else {
    parts.push('You answered every depth-check question correctly, so we skip the definitions and spend the time on design decisions.');
  }
  return parts.join(' ');
}

function lesson(ctx) {
  const c = makeCtx(ctx);
  const planKind = c.kind === 'other' || c.kind === 'none' ? 'general' : c.kind;
  const plan = PLANS[planKind][c.zone];
  const steps = plan.map((p) => (Array.isArray(p) ? STEPS[p[0]](c, p[1] ?? undefined) : STEPS[p](c)));
  return { title: lessonTitle(c), intro: lessonIntro(c), steps };
}

/* ------------------------------------------------ Lulu: expansions */

function aboutTitle(about) {
  const a = clean(about).replace(/[?.!]+$/, '').replace(/\s+step by step$/i, ', step by step');
  return clip(cap(a), 70);
}

const EXPANSIONS = [
  {
    match: /rout|classif|triage|sort|categor/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is **one email's journey** through a router, from inbox to reply. Press **▶ Auto-play** or step with **Next →**, and read each stage.

Notice two things:
- the router **only classifies**; a specialist playbook writes the reply
- a **confidence gate** sits between them, so uncertain emails go to a person instead of the wrong playbook`,
        {
          type: 'sequence',
          stages: [
            { label: 'Email arrives', detail: 'Maya writes: order #4471 arrived with a cracked lid, can she get a replacement? The text, sender and order number are all the router gets.' },
            { label: 'Clean & enrich', detail: 'Strip signatures and quoted history, pull out the order number, and fetch the order with a tool so the router sees facts, not just words.' },
            { label: 'Classify', detail: 'One small, fast model call picks a category (damaged item) and a confidence score (say 0.93). Nothing is written to the customer yet.' },
            { label: 'Confidence gate', detail: 'Above the threshold, the email goes to its playbook automatically. Below it, or if the category is refunds or legal, it goes to a person.' },
            { label: 'Specialist', detail: 'The damaged-item playbook has its own prompt, tools and rules: check the order, offer a replacement, never promise money.' },
            { label: 'Review & send', detail: 'A policy check reviews the draft, risky replies wait for approval, and every step is logged so misroutes can be found and fixed.' },
          ],
        }),
      step('Routing confidence: auto-send vs. human review',
        `Now tune the gate yourself. The x-axis is the router's **confidence**; the curve is the chance an email is **auto-routed** instead of queued for a person.
- raise **t**, the threshold, and fewer emails go out alone: safer, but slower replies
- raise **k** and the gate becomes a hard cut-off

${x.kind === 'support' ? 'For refunds keep t high. For “where is my order?” you can afford to lower it.' : 'High-stakes categories deserve a higher threshold than routine ones.'}`,
        {
          type: 'simulator',
          title: 'Auto-send vs. human review',
          expr: 'sigmoid(k*(x - t))',
          xVar: 'x',
          xRange: [0, 1],
          vars: [
            { name: 'k', min: 2, max: 20, init: 10, step: 0.5 },
            { name: 't', min: 0.2, max: 0.9, init: 0.6, step: 0.01 },
          ],
          yLabel: 'chance it is auto-routed',
        }),
    ],
  },
  {
    match: /guard|safe|risk|approv|human|injection|harm/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Follow one risky action through the rails. Step with **Next →** and notice where each rail acts:
- **before** the action: allow-lists and approval can stop it
- **during** the run: budgets and spend caps limit it
- **after**: logs only tell you what happened

Preventive rails are the only ones that stop an irreversible action.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Agent proposes', detail: 'The model decides to call issue_refund(99.98). Nothing has happened yet: this is only a request.' },
            { label: 'Allow-list', detail: 'Is issue_refund on this agent’s list of permitted tools? If not, the call is rejected before it runs.' },
            { label: 'Policy rules', detail: 'Code, not the model, checks hard limits: amount under the cap, order actually charged, no refund already issued.' },
            { label: 'Human approval', detail: 'Money moves, so the run pauses. A person sees the evidence and clicks approve or reject.' },
            { label: 'Execute', detail: 'Only now does your code run the refund, with the approver recorded.' },
            { label: 'Log & audit', detail: 'Thought, tool call, approver and result are logged, so any refund can be traced later.' },
          ],
        }),
      step('How much does a mistake cost?',
        `Put numbers on the risk. The curve is the expected daily cost of mistakes as the **error rate** of unreviewed actions rises.
- **v** is actions per day, **c** the cost of one bad action
- even a 2% error rate is expensive when **c** is a refund or an angry customer

Notice when a human review, at a few cents or dollars each, becomes the cheap option.`,
        {
          type: 'simulator',
          title: 'Expected daily cost of unreviewed mistakes',
          expr: 'v*x*c',
          xVar: 'x',
          xRange: [0, 0.2],
          vars: [
            { name: 'v', min: 50, max: 2000, init: 500, step: 10 },
            { name: 'c', min: 1, max: 200, init: 40, step: 1 },
          ],
          yLabel: 'cost of mistakes per day',
        }),
    ],
  },
  {
    match: /memor|context|forget|remember|history|window|summar/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is how a long thread stays usable. Step through with **Next →**:
- the window fills turn by turn
- old turns get folded into a **running summary**
- facts that must be exact are **re-fetched with a tool**, not remembered

Notice the agent never needs the whole history, only the facts that still matter.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Turn 1', detail: 'The customer gives the order number and the problem. Everything fits in context.' },
            { label: 'Window fills', detail: 'Twenty turns later the thread nears the context budget. Every call now pays for all of it.' },
            { label: 'Summarise', detail: 'Older turns are compressed into a case note: order #4471, cracked lid, replacement promised.' },
            { label: 'Drop raw turns', detail: 'The raw old turns leave the window. The summary stays, at a fraction of the tokens.' },
            { label: 'Re-fetch facts', detail: 'Exact details such as shipping status come fresh from a tool, never from memory.' },
          ],
        }),
      step('Tokens in context as the thread grows',
        `The curve is how many tokens each call carries as the conversation grows, with a **sliding window** of **w** turns and **t** tokens per turn.
- the curve rises, then flattens at the window size
- a bigger **w** remembers more but costs more on every call

Notice the flat part: that's the cost ceiling a window buys you, and the reason you need a summary for what falls out.`,
        {
          type: 'simulator',
          title: 'Tokens per call with a sliding window',
          expr: 't*min(x, w)',
          xVar: 'x',
          xRange: [1, 40],
          vars: [
            { name: 't', min: 50, max: 400, init: 150, step: 10 },
            { name: 'w', min: 2, max: 20, init: 8, step: 1 },
          ],
          yLabel: 'tokens per call',
        }),
    ],
  },
  {
    match: /tool|function|api|call/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is what really happens when an agent “uses a tool”. Step through with **Next →**:
- the model only writes a **request**: a tool name and arguments
- **your code** validates and runs it
- the **real result** goes back to the model

Notice the model never touches your systems directly. That gap is where your guardrails live.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Tool list', detail: 'Your code tells the model which tools exist, each with a name, a description and an argument schema.' },
            { label: 'Model requests', detail: 'The model replies with a structured call, e.g. calculator("3 * 49.99"), instead of prose.' },
            { label: 'Validate', detail: 'Your code checks the tool is allowed and the arguments are well-formed before running anything.' },
            { label: 'Execute', detail: 'Your code runs the tool for real: 3 * 49.99 = 149.97.' },
            { label: 'Observation', detail: 'The result is added to the conversation, so the next thought builds on a real number.' },
          ],
        }),
    ],
  },
  {
    match: /workflow|chain|pipeline|autonom/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The same task, two ways. Step through with **Next →** and notice who decides the next step at each stage:
- in a **workflow**, your code decides
- in an **agent**, the model decides

Neither is better in general. Predictable work favours the workflow; open-ended work favours the agent.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Same input', detail: 'A customer email arrives. Both systems see exactly the same text.' },
            { label: 'Workflow path', detail: 'Code runs fixed steps: classify, fetch the order, draft, check. Same order every time, easy to test.' },
            { label: 'Agent path', detail: 'The model decides what to do next: maybe fetch the order, maybe search the policy, maybe ask a question.' },
            { label: 'Cost & latency', detail: 'The workflow makes a known number of calls. The agent may make many more on a hard email.' },
            { label: 'When to switch', detail: 'Start with the workflow. Add autonomy only where the fixed path keeps failing.' },
          ],
        }),
    ],
  },
  {
    match: /multi|orchestr|worker|team of agents|several agents/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Follow one task through an orchestrator and its workers with **Next →**:
- the orchestrator **plans** subtasks it couldn't know in advance
- workers run in **parallel**, each with a narrow job
- a synthesizer **merges** the results

Notice where the extra tokens go: every hand-off repeats context.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Task arrives', detail: 'A broad request that needs several kinds of work.' },
            { label: 'Plan', detail: 'The orchestrator splits it into subtasks based on what the task actually needs.' },
            { label: 'Delegate', detail: 'Each worker gets one subtask with only the context it needs.' },
            { label: 'Work', detail: 'Workers search, read or compute in parallel.' },
            { label: 'Synthesize', detail: 'Results are merged and checked for conflicts.' },
            { label: 'Deliver', detail: 'One answer goes back, often at 10–15× the tokens of a single agent.' },
          ],
        }),
    ],
  },
  {
    match: /cost|token|price|cheap|expens|budget/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Estimate what your agent will cost per month. The curve is monthly cost as daily volume grows.
- **k** is model calls per task (a router plus one draft is about 2)
- **p** is the average cost of one call, in cents

Notice how quickly an extra call per task adds up at scale, and why multi-agent designs, at 10–15× the tokens, need a clear payoff.`,
        {
          type: 'simulator',
          title: 'Monthly model cost vs. daily volume',
          expr: 'x*k*p*30/100',
          xVar: 'x',
          xRange: [0, 2000],
          vars: [
            { name: 'k', min: 1, max: 15, init: 2, step: 1 },
            { name: 'p', min: 0.05, max: 5, init: 0.4, step: 0.05 },
          ],
          yLabel: 'monthly cost',
        }),
    ],
  },
  {
    match: /eval|test|measur|metric|observ|log|debug/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Here is a practical evaluation loop. Step through with **Next →**:
- build a small **test set** from real cases
- score every run the same way, automatically
- fix, re-run, and compare the numbers

Notice that nothing here needs a new model. It's the habit that makes agents trustworthy.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Collect cases', detail: 'Pull 30–50 real inputs, including the awkward ones, each with the right answer.' },
            { label: 'Run the agent', detail: 'Run every case and log each thought, tool call and output.' },
            { label: 'Score', detail: 'Check category, facts and policy for each output, with code or a grader prompt.' },
            { label: 'Read failures', detail: 'Open the logs of the failures. Most have one of a few causes.' },
            { label: 'Fix & re-run', detail: 'Change one thing, re-run the whole set, and keep the change only if the score improves.' },
          ],
        }),
    ],
  },
];

/** The agent loop, the default expansion when nothing more specific matches. */
const LOOP_EXPANSION = (x) => [
  step(aboutTitle(x.about),
    `Here is one full turn of the loop, slowed right down. Step through with **Next →** and read each stage:
- the model **decides** one action
- your code **runs** it and returns a real result
- the model **re-plans** with that result in view

Notice how each observation changes the plan. That feedback is what separates an agent from a script.`,
    {
      type: 'sequence',
      stages: [
        { label: 'Goal', detail: 'The agent gets a goal and a toolkit: say, work out a refund with a calculator and notes.' },
        { label: 'Think', detail: 'The model reads the goal and history, and picks the single most useful next action.' },
        { label: 'Act', detail: 'It requests a tool call, e.g. calculator("3 * 49.99"). Your code runs it.' },
        { label: 'Observe', detail: 'The real result, 149.97, is appended to the history.' },
        { label: 'Re-plan', detail: 'With the new fact, the next thought changes: now subtract the one legitimate charge.' },
        { label: 'Done?', detail: 'Stop when the goal is met or the step budget runs out. Otherwise, go round again.' },
      ],
    }),
  step('Why short loops are safer',
    `If each step succeeds with probability **p**, a run of **x** steps is error-free with probability p^x. Slide **p**:
- at 0.95, ten steps succeed only about 60% of the time
- at 0.99, about 90%

Notice why step budgets and checkpoints matter as much as the prompt.`,
    {
      type: 'simulator',
      title: 'Chance a run finishes with no errors',
      expr: '100*p^x',
      xVar: 'x',
      xRange: [1, 30],
      vars: [{ name: 'p', min: 0.8, max: 0.999, init: 0.95, step: 0.001 }],
      yLabel: '% of runs error-free',
    }),
];

function expansion(ctx = {}) {
  const about = clean(ctx.about) || 'the agent loop, step by step';
  const x = { about, kind: goalKind(ctx.goal), zone: zoneOf(ctx.zone) };
  const hit = EXPANSIONS.find((e) => e.match.test(about));
  const steps = (hit ? hit.steps(x) : LOOP_EXPANSION(x)).map((s) => ({ ...s }));
  // never duplicate a title already in the lesson (the learner may ask twice)
  const taken = new Set((ctx.existingTitles ?? []).map((t) => clean(t).toLowerCase()));
  for (const s of steps) {
    let title = s.title;
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${s.title} (part ${n})`;
    s.title = title;
    taken.add(title.toLowerCase());
  }
  return { steps };
}

/* ------------------------------------------------ Lulu: decide */

const ANSWERS = [
  [/what is an agent|what’s an agent|what's an agent|agent vs|vs\.? (a )?chatbot|different from a chatbot/i, 'A chatbot replies once. An agent pursues a goal: it chooses an action, calls a tool, reads the real result and loops until it’s done or a limit stops it. That loop is exactly what the live agent in this dive shows, one think → act → observe card at a time.'],
  [/why .{0,30}human|need a (human|person)|human.?in.?the.?loop|approv|sign.?off|oversight/i, 'Because some actions can’t be undone. A refund, a promise to a customer or a deleted record can’t be taken back, so the agent prepares them and a person approves them. Routine, reversible replies can go out on their own once your tests show they’re reliable.'],
  [/refund|money back|reimburs|chargeback/i,'Treat a refund as something the agent prepares but never executes. Let it work out the amount with a tool, write the case up with the evidence, and route it to a person for one-click approval. That’s the human-approval rail, and it’s why the live agent stopped at a note instead of paying.'],
  [/\btone\b|\bvoice\b|polite|friendly|\brude\b|\bbrand\b/i, 'Put the voice in the system prompt with two or three real replies from your best support people as examples. Keep the rules concrete: apologise once, name the order number, give one clear next step. Then let a checker step score drafts for tone before they go out, the evaluator pattern.'],
  [/\bcosts?\b|\bprice|\btokens?\b|expens|cheap|\bbudget/i, 'Roughly: calls per email × tokens per call × price. A router on a small, fast model plus one drafting call keeps most emails to two calls. The source notes multi-agent systems use about 10–15× more tokens than a single agent, so start simple and measure before you add agents.'],
  [/hallucinat|\bmak(e|es|ing) (things |stuff |facts |it |answers |details )?up\b|\bmade (things |stuff |it )?up\b|\binvent|fabricat|\blies?\b|\blying\b|wrong fact|false (info|fact)|accura/i, 'Ground every reply in data the agent fetched with a tool, such as the order record or the policy text, and tell it to say “I’ll check with the team” when it can’t find something. Then add a check step that rejects any draft stating facts that aren’t in what was retrieved.'],
  [/safe|risk|danger|guardrail|trust|harm|injection/i, 'Separate what the agent may do alone from what needs a person. Allow-list its tools (read orders, never edit them), cap its steps and spend, log every action, and put human approval on anything irreversible: refunds, credits, account changes. Preventive rails stop harm; logs only record it.'],
  [/memor|remember|context|forget|history/i, 'Keep a short running summary of the case, the order number, the issue and any promise made, and re-fetch live data with a tool instead of trusting old turns. A plain sliding window drops the oldest facts first, and those are often the ones that matter.'],
  [/rout|classif|categor|triage/i, 'Routing means one quick call labels the input (refund, damaged item, delivery, account) and hands it to a playbook built for that case. Add a confidence threshold, so unsure or high-risk emails go to a person. If you’d like, ask me to walk you through it step by step and I’ll add hands-on steps.'],
  [/\btools?\b|function call|\bapis?\b/i, 'The model never runs a tool itself. It writes a structured request, a tool name and arguments; your code checks it’s allowed, runs it, and returns the real result as an observation. That’s why the calculator’s answer in the live agent can be trusted: it was executed, not predicted.'],
  [/workflow|when.{0,20}agent|need an agent/i, 'Use a workflow when you can list the steps in advance; use an agent when the next step depends on what you discover. Most support inboxes are a workflow with a human in the loop: routed playbooks, a check step, and approval for anything that moves money.'],
  [/\btest|evaluat|measur|metric|quality/i, 'Collect 30–50 real emails with the correct category and an ideal reply. Run your flow on all of them, score the category, the facts and the policy compliance, then read the failures. Change one thing at a time and keep it only if the score improves.'],
  [/multi.?agent|orchestr|several agents/i, 'Multiple agents help when work needs different expertise at the same time. They cost roughly 10–15× the tokens and are harder to trace, so for a first version one agent with routed playbooks is usually the better call.'],
  [/deploy|integrat|zendesk|helpdesk|gmail|outlook|production|\bship\b/i, 'Save your flow, download the JSON and open the 🔌 Integration guide on the flow step. Each node maps to one function: the trigger becomes a webhook from your helpdesk, each LLM step one model call, and the result a draft that waits for approval in your queue.'],
  [/which model|best model|what model|\bgpt\b|claude|gemini|llm (should|to use)/i, 'Use a small, fast model for routing and classification and a stronger one for drafting replies. Test both on the same 30 real emails and compare accuracy and cost per email. The architecture matters more than the brand: tools, checks and approvals carry most of the reliability.'],
  [/prompt/i, 'Keep each prompt short and specific: the job, the rules, two real examples and the exact output format. One prompt per playbook beats one giant prompt, because you can test and fix each one on its own.'],
  [/slow|latency|speed|fast enough|how long/i, 'Every model call adds latency, so count them: a router plus one draft is two calls. Use a small model for classification, run independent checks in parallel, and have the draft waiting for the reviewer rather than generated on demand.'],
  [/privacy|personal data|gdpr|\bpii\b|sensitive|secure/i, 'Send the model only what the task needs: the email and the relevant order, not the whole customer record. Redact card numbers and passwords before the call, log who accessed what, and check your provider’s data-retention terms.'],
  [/angry|upset|escalat|complain|rude customer/i, 'Route angry or high-risk emails straight to a person, with the agent’s summary and a suggested reply attached. Spotting tone is a routing job: give “escalate” its own category with a low confidence threshold.'],
  [/loop|observation/i, 'Each turn of the loop is one model call: think about the goal and what’s known, act with one tool, observe the real result, then decide whether it’s done. A step budget ends the loop if the model never decides it is.'],
  [/^((hmm+|um+|oh|ah|alright|right|yeah)[,.!\s]+)?(i think i (get|got) it|got it|makes sense|ok(ay)?[.! ]*$|i see|understood|that helps|perfect)/i, 'Great, that’s the idea. Keep going, and ask me whenever something needs unpacking: I can also add a hands-on step if you ask me to walk you through something step by step. 🐙'],
  [/^(thanks|thank you|cool|great|awesome|nice)/i, 'Anytime! Keep going, and ask me whenever something needs unpacking. I can also add a hands-on step if you ask me to walk you through something step by step. 🐙'],
  [/^(hmm+|um+|uh+|huh)[.!?\s]*$/i, 'Take your time. If something in this step feels fuzzy, ask me about it, or ask me to walk you through it step by step and I’ll add a hands-on step. 🐙'],
];

/** Words that mark a question as being about this dive (anything else gets a polite redirect). */
const ON_TOPIC = /agent|\bai\b|llm|model|tool|prompt|e-?mail|support|customer|flow|loop|rout|guard|memory|context|workflow|step|block|lesson|refund|reply|human|note|calculat|pattern|token|autonom|automat|build|deploy|test/i;

const EXPAND_RE = /step[- ]by[- ]step|walk me through|break (it|this|that)? ?down|go deeper|more detail|in detail|clarify|show me how|explain .{0,60}(more|again|slowly|properly)/i;
const REDESIGN_RE = /\bi want to build\b|\bi'?m building\b|\bi am building\b|\bmy (company|business|startup)\b/i;

/** Pull the thing to clarify out of the learner's own words. */
function extractAbout(message) {
  let a = clean(message).replace(/[?!.]+$/, '');
  a = a.replace(/^(hey|hi|ok|okay|so|lulu)[,!\s]+/i, '');
  a = a.replace(/^(can|could|would) you (please )?/i, '').replace(/^please /i, '');
  a = a.replace(/^(walk me through|explain|show me how|show me|clarify|break down|go deeper (on|into)|tell me more about|help me understand)\s+/i, '');
  a = a.replace(/^(how )?(the |a )?/i, (m) => (/^how /i.test(m) ? m : ''));
  return clip(a, 120) || 'this step, step by step';
}

function restateGoal(message) {
  const m = clean(message).replace(/[?!.]+$/, '');
  const core = m.replace(/^.*?\bi (want|would like|need|am trying|'m trying) to\s+/i, '').replace(/^.*?\bi'?m building\s+/i, 'build ').replace(/^.*?\bi am building\s+/i, 'build ');
  return clip(cap(core), 280);
}

function tutor(ctx = {}) {
  const msg = clean(ctx.lastUserMessage);
  const here = (ctx.stepTitles ?? [])[ctx.currentStepIndex ?? 0];
  if (REDESIGN_RE.test(msg)) {
    const goal = restateGoal(msg);
    return {
      action: 'redesign',
      goal,
      reply: `Love that goal. I’m rebuilding your whole dive around it now, with every step aimed at “${clip(stripEnd(goal), 90)}”. 🌊`,
    };
  }
  if (EXPAND_RE.test(msg)) {
    const about = extractAbout(msg);
    const isRouting = /rout|classif|triage/i.test(about);
    return {
      action: 'expand',
      about,
      reply: isRouting
        ? 'Good call. I’m adding two hands-on steps right after this one: a support email’s journey through the router, stage by stage, and a live dial for when to auto-send. 🤿'
        : `On it. I’m adding interactive steps on ${clip(about, 70)} right after this one, so you can see it happen rather than read about it. 🤿`,
    };
  }
  for (const [re, reply] of ANSWERS) if (re.test(msg)) return { action: 'answer', reply };
  if (!ON_TOPIC.test(msg)) {
    return { action: 'answer', reply: 'That one’s outside this dive, so I’ll leave it to a search engine. 🐙 Ask me anything about agents, from the loop and routing to guardrails and your flow, or ask me to walk you through a step and I’ll add a hands-on one.' };
  }
  return {
    action: 'answer',
    reply: `Good question. The short answer: an agent is only as good as its tools, its stopping rules and the checks around it, so start small and add autonomy only where it pays.${here ? ` The block in “${clip(here, 60)}” is the quickest way to see that for yourself.` : ''} Ask me to walk you through something step by step and I’ll add a hands-on step.`,
  };
}

/* ------------------------------------------------ dive-log summary */

const BUILT = {
  'workflow-vs-agent': (x) => (x.kind === 'support' ? 'You ran your support inbox through the decision tree and landed on workflow + human in the loop.' : 'You ran a real task through the workflow-vs-agent decision tree and got a verdict.'),
  'agent-loop': () => 'You traced the think → act → observe → done loop, stage by stage.',
  'pattern-explorer': (x) => (x.kind === 'support' ? 'You explored the routing pattern that sends each email to its own playbook.' : 'You compared the architecture patterns, from prompt chaining to autonomous agents.'),
  'live-agent': (x) => (x.kind === 'support' ? 'You watched a live agent work a refund with a real calculator and hand it to a person.' : 'You ran a live agent with real tools and read every thought, action and observation.'),
  guardrails: () => 'You switched guardrails on one by one and saw which rail stops a rogue agent first.',
  'flow-builder': (x) => (x.kind === 'support' ? 'You wired a Classify & draft → Policy check flow and ran it on a real customer email.' : 'You wired and ran your own flow, with a real model call at every LLM step.'),
  memory: () => 'You shrank the context budget until early facts fell out, then kept them with a summary.',
  'multi-agent': () => 'You compared an orchestrator with peer-to-peer agents and their tradeoffs.',
  simulator: (x, s) => `You tuned the “${clip(s.title, 60)}” simulator and watched the curve respond.`,
  sequence: (x, s) => `You stepped through “${clip(s.title, 70)}” stage by stage.`,
  diagram: (x, s) => `You explored “${clip(s.title, 70)}” node by node.`,
  chart: (x, s) => `You read the “${clip(s.title, 70)}” chart.`,
};
const BUILT_ORDER = ['flow-builder', 'live-agent', 'simulator', 'guardrails', 'workflow-vs-agent', 'pattern-explorer', 'memory', 'multi-agent', 'agent-loop', 'simulator', 'sequence', 'diagram', 'chart'];

const LEARNED = {
  'workflow-vs-agent': 'You can tell when a task needs an agent, a fixed workflow, or a workflow with a human in the loop.',
  'agent-loop': 'You know the loop every agent runs: think, act with a tool, observe the real result, repeat.',
  'pattern-explorer': 'You know the patterns that come before full autonomy: chaining, routing, parallelization and evaluator loops.',
  'live-agent': 'You saw why tool results beat guesses: the model requests, your code executes, the observation steers the next step.',
  guardrails: 'You know which guardrails prevent harm (approval, allow-lists) and which only limit or record it.',
  'flow-builder': 'You know how a second model call can check the first before anything reaches a customer.',
  memory: 'You understand memory as a budget, and why summaries beat sliding windows for long threads.',
  'multi-agent': 'You can weigh one agent against many, including the 10–15× token cost.',
};
const GAP_LEARNED = {
  routing: 'You closed your routing gap: classify first, then hand off to the playbook built for that case.',
  guard: 'You closed your guardrails gap: anything irreversible, like a refund, waits for human approval.',
  loop: 'You closed your gap on the agent loop: think, act, observe, repeat, until done or stopped.',
  tools: 'You closed your tools gap: the model asks, your code runs the tool and returns the real result.',
  wva: 'You closed your workflow-vs-agent gap: use the simplest design that does the job.',
  memory: 'You closed your memory gap: summarise old turns and re-fetch facts instead of trusting old context.',
  evals: 'You closed your evaluation gap: log every step and test on real cases to see what fails.',
  multi: 'You closed your multi-agent gap: split into agents only when the work needs it, given the token cost.',
};

function summary(ctx = {}) {
  const kind = goalKind(ctx.goal);
  const x = { kind };
  const steps = (ctx.steps ?? []).map((s) => ({ title: clean(s?.title), type: s?.blockType ?? null }));
  const types = [...new Set(steps.map((s) => s.type).filter(Boolean))];
  const zoneName = { sunlight: 'Sunlight', twilight: 'Twilight', midnight: 'Midnight' }[zoneOf(ctx.zone)] ?? 'Twilight';

  const headline = {
    support: `You designed a support-email agent, from routing to guardrails to a flow that runs.`,
    marketing: `You turned a campaign idea into a working flow, and learned when not to use an agent.`,
    research: `You built a research agent that searches, reads and reports, with limits in place.`,
    other: `You took “${clip(stripEnd(ctx.goal ?? ''), 60)}” from idea to a first working flow.`,
    none: `You went from the agent loop to a working, guarded flow in the ${zoneName} Zone.`,
  }[kind];

  const missedKeys = [...new Set((ctx.missed ?? []).map(conceptKey).filter(Boolean))];
  const learned = [];
  for (const k of missedKeys) if (learned.length < 2 && GAP_LEARNED[k]) learned.push(GAP_LEARNED[k]);
  for (const t of types) if (learned.length < 5 && LEARNED[t] && !learned.includes(LEARNED[t])) learned.push(LEARNED[t]);
  for (const fill of [LEARNED['agent-loop'], LEARNED['workflow-vs-agent'], LEARNED.guardrails]) {
    if (learned.length < 3 && !learned.includes(fill)) learned.push(fill);
  }

  const built = [];
  for (const t of BUILT_ORDER) {
    if (built.length >= 4) break;
    const s = steps.find((st) => st.type === t);
    if (s) built.push(BUILT[t](x, s));
  }
  if (built.length < 2) built.push('You answered the check questions and saw why each answer holds.');
  if (built.length < 2) built.push('You read every step and tried each block in turn.');

  const nextSteps = [];
  if (kind === 'support') {
    nextSteps.push('Run 20 of your real support emails through your flow and count how often the Policy check objects.');
    nextSteps.push('Open the integration guide and connect the flow to your helpdesk as drafts that wait for approval.');
  } else if (kind === 'marketing') {
    nextSteps.push('Feed your flow a real brief from your last campaign and compare its plan with what you shipped.');
    nextSteps.push('Add a checker step that scores each ad variant against your brand rules.');
  } else if (kind === 'research') {
    nextSteps.push('Add an evaluator step that checks every summary bullet is backed by a passage.');
    nextSteps.push('Give your live agent a step budget and a real research question, and read its trace.');
  } else {
    nextSteps.push('Save your flow, open the integration guide, and turn one step into real code.');
    nextSteps.push('Run the live agent on a goal from your own work and remove one tool to see how it copes.');
  }
  nextSteps.push({
    sunlight: 'Dive again in the Twilight Zone to see routing, memory and evaluation in more depth.',
    twilight: 'Try the Midnight Zone for multi-agent tradeoffs and the economics of human review.',
    midnight: 'Explore multi-agent orchestration next, and measure its token cost before you commit.',
  }[zoneOf(ctx.zone)] ?? 'Try the next depth zone to go deeper.');

  return { headline: clip(headline, 120), learned: learned.map((s) => clip(s, 140)), built: built.map((s) => clip(s, 140)), nextSteps: nextSteps.map((s) => clip(s, 140)) };
}

/* ------------------------------------------------ live agent (agent_step) */

const NUM_WORDS = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const numWord = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n);

function normHistory(history) {
  return (Array.isArray(history) ? history : []).map((h) => ({
    thought: String(h?.thought ?? ''),
    tool: String(h?.tool ?? h?.action?.tool ?? ''),
    input: String(h?.input ?? h?.action?.input ?? ''),
    observation: String(h?.observation ?? ''),
  }));
}

/** The number a calculator observation reports ("3 * 49.99 = 149.97" → "149.97"). */
const calcResult = (obs) => String(obs ?? '').match(/=\s*(-?\d+(?:\.\d+)?)\s*$/)?.[1] ?? null;
const noteNumber = (obs) => String(obs ?? '').match(/Saved note #(\d+)/)?.[1] ?? null;
const round2 = (n) => String(Math.round(n * 100) / 100);

const act = (thought, tool, input) => ({ thought, done: false, action: { tool, input } });
const finish = (thought, final) => ({ thought, done: true, final });

/** Known phrases from the course documents, and the point each one supports. */
const SOURCE_POINTS = [
  { id: 'screen', re: /one model processes user queries while another\s+screens for inappropriate content/i, quote: 'one model processes user queries while another screens for inappropriate content', point: 'Screen in parallel: one model handles the user’s request while a second screens it for inappropriate content.', short: 'a second model screening requests in parallel' },
  { id: 'vote', re: /vote thresholds\s+to balance false positives and negatives/i, quote: 'different vote thresholds to balance false positives and negatives', point: 'Vote on risky judgements: several prompts review the same content, and the vote threshold trades false positives against false negatives.', short: 'voting with a tuned threshold' },
  { id: 'observe', re: /implement tracing|debugging becomes nearly impossible/i, quote: 'debugging becomes nearly impossible when emergent behaviors arise', point: 'Trace everything: without observability into how agents decide, delegate and combine results, debugging emergent behaviour is nearly impossible.', short: 'tracing of every decision' },
  { id: 'mcp', re: /Model Context Protocol/i, quote: 'configured with the Model Context Protocol (MCP)', point: 'Connectors to real systems: the source’s research agent uses MCP to reach content repositories, business tools and development environments.', short: 'MCP connectors to content repositories, business tools and dev environments' },
  { id: 'skills', re: /specialized\s+knowledge, workflows, and tool integrations/i, quote: 'specialized knowledge, workflows, and tool integrations', point: 'Skills that package specialised knowledge, workflows and tool integrations the agent can load when needed.', short: 'Skills packaging specialised knowledge, workflows and tool integrations' },
  { id: 'reqs', re: /API capabilities, tool integration, and\s+memory management/i, quote: 'API capabilities, tool integration, and memory management', point: 'Production basics: API capabilities, tool integration and memory management.', short: 'API access, tool integration and memory management' },
  { id: 'stop', re: /stopping condition/i, quote: 'a stopping condition like “pause here for human review”', point: 'A stopping condition, such as pausing for human review.', short: 'a stopping condition such as human review' },
  { id: 'north', re: /modular designs, comprehensive\s+observability, and clear success metrics/i, quote: 'modular designs, comprehensive observability, and clear success metrics', point: 'Build for modular designs, comprehensive observability and clear success metrics.', short: 'modular design, observability and clear success metrics' },
  { id: 'mas-domains', re: /When domains must work together/i, quote: 'When domains must work together', point: 'Use several agents when different domains must work together, such as legal review coordinating with financial analysis.', short: 'several agents when domains must work together' },
  { id: 'mas-best', re: /Complex problem-solving requiring diverse expertise/i, quote: 'Complex problem-solving requiring diverse expertise', point: 'Multi-agent systems work best for complex problems needing diverse expertise, research and analysis, and strategic planning.', short: 'multi-agent for diverse expertise and research' },
  { id: 'mas-evolve', re: /might start with a single agent/i, quote: 'might start with a single agent', point: 'Start with one agent and evolve: the source’s contract-review system begins as a single agent and later splits into contract, risk and compliance agents.', short: 'start with one agent, split later' },
  { id: 'mas-cost', re: /proportional complexity/i, quote: 'that power comes with proportional complexity', point: 'Multi-agent power comes with proportional complexity, in both architecture and operating cost.', short: 'complexity and cost grow with every agent' },
  { id: 'mas-open', re: /Complex, open-ended problems \(strategic analysis, research projects, system/i, quote: 'Complex, open-ended problems (strategic analysis, research projects, system troubleshooting)', point: 'Complex, open-ended problems such as strategic analysis, research projects and system troubleshooting are where multi-agent architectures fit.', short: 'multi-agent for open-ended problems' },
  { id: 'tokens', re: /10-15x more tokens/i, quote: 'roughly 10-15x more tokens than single agents', point: 'Multi-agent systems use roughly 10–15× more tokens than single agents, so do the maths on volume first.', short: '10–15× the tokens of one agent' },
  { id: 'overeng', re: /Don['’]t over-engineer/i, quote: 'Don’t over-engineer', point: 'Don’t over-engineer: for straightforward, repeatable tasks, a single well-designed agent is likely enough.', short: 'one well-designed agent for repeatable tasks' },
];

function pointsIn(text) {
  return SOURCE_POINTS.filter((p) => p.re.test(text));
}

/** A readable sentence from a docsearch observation, for when no known phrase matches. */
function snippet(obs, words) {
  const body = String(obs ?? '').replace(/^Top passages for "[^"]*":\s*/, '').replace(/-{3,}/g, ' ').replace(/[•●]/g, ' ').replace(/\s+/g, ' ');
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 360);
  let best = null;
  let bestScore = -1;
  for (const s of sentences) {
    const low = s.toLowerCase();
    const score = words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best ? clip(best, 170) : null;
}

function refundScript(goal, has, H) {
  const low = goal.toLowerCase();
  const count = Number(low.match(/(\d+)\s*(?:times|x\b)/)?.[1] ?? NUM_WORDS[low.match(/\b(once|twice|thrice|one|two|three|four|five|six)\b(?:\s*times)?/)?.[1]] ?? 2);
  const price = goal.match(/(?:at|of|for)\s*[$€£]?\s*(\d+(?:\.\d{1,2})?)/i)?.[1] ?? goal.match(/(\d+\.\d{2})/)?.[1];
  const calcs = H.filter((h) => h.tool === 'calculator');
  const notes = H.filter((h) => h.tool === 'notes');
  if (!price) return genericScript(goal, has, H);

  if (!has.calculator) {
    const total = round2(count * Number(price));
    const refund = round2((count - 1) * Number(price));
    if (has.notes && notes.length === 0) {
      return act(`I don’t have a calculator in my toolkit, so I won’t pretend a tool checked the maths. By hand: ${count} × ${price} = ${total}, minus the one legitimate charge = ${refund}. I’ll note it and flag that it’s unverified.`,
        'notes', `Refund ~${refund} owed (charged ${count}x ${price}, 1 legitimate) — amount NOT tool-verified; needs human approval before paying`);
    }
    return finish('I can’t verify the arithmetic with a tool, so I’ll hand this over clearly marked.',
      `Likely refund: ${refund} (${count} charges of ${price} = ${total}, one legitimate). I had no calculator, so this was worked by hand and is not tool-verified.${notes.length ? ` Saved as note #${noteNumber(notes[0].observation) ?? 1} for the team.` : ''} A person should check it and approve before any money moves.`);
  }

  if (calcs.length === 0) {
    return act(`The customer was charged ${count} times at ${price}, but only one charge should have gone through. First I’ll get the exact total they paid with the calculator, rather than doing the maths in my head.`,
      'calculator', `${count} * ${price}`);
  }
  const total = calcResult(calcs[0].observation);
  if (!total) {
    return finish('The calculator didn’t return a number, and I won’t guess one.',
      `I couldn’t compute the total (the calculator replied: “${clip(calcs[0].observation, 80)}”). Please check the charges manually; nothing was refunded.`);
  }
  if (calcs.length === 1) {
    return act(`The calculator says ${clean(calcs[0].observation)}, so they paid ${total} in total. One ${price} charge was legitimate, so the refund is the total minus one charge.`,
      'calculator', `${total} - ${price}`);
  }
  const refund = calcResult(calcs[1].observation) ?? round2(Number(total) - Number(price));
  const dupes = count - 1;
  if (has.notes && notes.length === 0) {
    return act(`${clean(calcs[1].observation)}: that’s ${dupes === 1 ? 'one duplicate charge' : `${numWord(dupes)} duplicate charges`} of ${price}. A refund moves money, so I shouldn’t pay it myself. I’ll write it up for the team to approve.`,
      'notes', `Refund ${refund} owed (charged ${count}x ${price}, 1 legitimate) — needs human approval before paying`);
  }
  const noteNo = notes.length ? noteNumber(notes[0].observation) : null;
  return finish(
    noteNo ? `Note #${noteNo} is saved, so the team has everything they need. I’m done: paying out is a human decision.` : 'I have the amount. I have no notes tool, so I’ll put everything in my final answer for the team.',
    `Refund owed: ${refund}. The customer was charged ${count} × ${price} = ${total} for a single ${price} purchase, so the ${dupes === 1 ? 'duplicate charge' : `${numWord(dupes)} duplicate charges`} (${total} − ${price} = ${refund}) should go back. ${noteNo ? `I saved this as note #${noteNo} for the team and` : 'I'} did not issue the refund myself: a person needs to approve it before any money moves.`);
}

function budgetScript(goal, has, H) {
  const venue = goal.match(/venue\s*[$€£]?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? '1200';
  const [, people = '80', each = '8'] = goal.match(/(\d+)\s*(?:people|guests|attendees)\s*at\s*[$€£]?\s*(\d+(?:\.\d+)?)/i) ?? [];
  const limit = goal.match(/(?:under|below|within|max(?:imum)?|cap(?:ped)? (?:at|of))\s*[$€£]?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? '2000';
  const calcs = H.filter((h) => h.tool === 'calculator');
  const notes = H.filter((h) => h.tool === 'notes');

  if (!has.calculator) {
    const total = round2(Number(venue) + Number(people) * Number(each));
    return finish('Without a calculator I can only work this by hand, so I’ll say so plainly.',
      `By hand: ${venue} + ${people} × ${each} = ${total}, which is ${Number(total) <= Number(limit) ? `under ${limit} by ${round2(Number(limit) - Number(total))}` : `over ${limit} by ${round2(Number(total) - Number(limit))}`}. This wasn’t checked with a calculator, so add that tool if you need it verified.`);
  }
  if (calcs.length === 0) {
    return act(`The budget is a venue of ${venue} plus ${people} people at ${each} each. I’ll let the calculator do the total.`, 'calculator', `${venue} + ${people}*${each}`);
  }
  const total = calcResult(calcs[0].observation);
  if (!total) return finish('The calculator didn’t return a number, so I’ll stop rather than guess.', `I couldn’t compute the total: “${clip(calcs[0].observation, 80)}”.`);
  const fits = Number(total) <= Number(limit);
  if (calcs.length === 1) {
    return act(`${clean(calcs[0].observation)}. To check it against the ${limit} limit I’ll compute the ${fits ? 'headroom' : 'overrun'}.`,
      'calculator', fits ? `${limit} - ${total}` : `${total} - ${limit}`);
  }
  const gap = calcResult(calcs[1].observation) ?? round2(Math.abs(Number(limit) - Number(total)));
  const verdict = fits ? `fits under ${limit} with ${gap} to spare` : `is over the ${limit} limit by ${gap}`;
  if (has.notes && notes.length === 0) {
    return act(`${clean(calcs[1].observation)}, so the budget ${verdict}. Saving the result as a note, as the goal asks.`,
      'notes', `Event budget: ${total} total (venue ${venue} + ${people} × ${each}). ${cap(verdict)}.`);
  }
  const noteNo = notes.length ? noteNumber(notes[0].observation) : null;
  return finish(noteNo ? `Note #${noteNo} is saved. Everything the goal asked for is done.` : 'I have both numbers. There’s no notes tool, so the result goes in my answer.',
    `The event costs ${total} (venue ${venue} + ${people} people × ${each}), so it ${verdict}.${noteNo ? ` Saved as note #${noteNo}.` : ' I had no Notes tool, so here is the result instead of a saved note.'}`);
}

/** Docsearch-driven goals: search, optionally refine, then save notes and finish. */
function searchScript({ goal, has, H, queries, want, topic, noteMode, prefer }) {
  if (!has.docsearch) {
    return finish(`To answer this I’d need to read the source documents, and I don’t have the Document search tool.`,
      `I can’t tell you what the source documents say about ${topic} without Document search, and I won’t guess. Add Document search to my toolkit and run me again.`);
  }
  const searches = H.filter((h) => h.tool === 'docsearch');
  const notes = H.filter((h) => h.tool === 'notes');
  const seen = searches.map((s) => s.observation).join('\n');
  // only points relevant to this goal, in the order that best answers it
  const found = prefer.map((id) => pointsIn(seen).find((p) => p.id === id)).filter(Boolean);
  if (searches.length === 0) {
    return act(`I’ll start by searching the course documents for ${topic}, so everything I report comes from the source.`, 'docsearch', queries[0]);
  }
  if (searches.length === 1 && found.length < want && queries[1]) {
    const lead = found[0]
      ? `The top passage says “${found[0].quote}”. That’s ${found.length === 1 ? 'one solid point' : `${numWord(found.length)} points`} so far.`
      : `The first passages are thin${snippet(searches[0].observation, topic.split(' ')) ? `: the closest line is “${snippet(searches[0].observation, topic.split(' '))}”` : ''}.`;
    return act(`${lead} I’ll run one more, more specific search to find the rest.`, 'docsearch', queries[1]);
  }
  const points = found.slice(0, want).map((p) => p.point);
  if (points.length === 0) {
    const s = snippet(seen, topic.split(' '));
    if (s) points.push(`The closest passage says: “${s}”`);
  }
  if (has.notes && points.length) {
    if (noteMode === 'each' && notes.length < points.length) {
      const i = notes.length;
      const intro = i === 0
        ? `I have ${points.length === want ? `the ${want} key points` : `${points.length} point${points.length > 1 ? 's' : ''} backed by the documents`}. Saving them one note at a time, starting with the first.`
        : `Note #${noteNumber(notes[i - 1].observation) ?? i} saved. Now point ${i + 1}.`;
      return act(intro, 'notes', `${cap(topic)} ${i + 1}/${points.length}: ${points[i]}`);
    }
    if (noteMode === 'summary' && notes.length === 0) {
      const shorts = found.slice(0, want).map((p) => p.short);
      return act('I have enough from the documents to write the summary. Saving it as one note.', 'notes',
        clip(shorts.length ? `${cap(topic)} (from the course documents): ${shorts.join('; ')}.` : `Summary — ${topic}: ${points.join(' ')}`, 300));
    }
  }
  const saved = notes.map((n) => noteNumber(n.observation)).filter(Boolean);
  const listText = points.map((p, i) => `${i + 1}) ${p}`).join(' ');
  if (!points.length) {
    return finish('The searches didn’t turn up anything I can stand behind.',
      `I searched the documents for ${topic} but found nothing specific enough to report, so I’m not inventing an answer. Try a narrower question.`);
  }
  return finish(saved.length ? `All ${saved.length} note${saved.length > 1 ? 's are' : ' is'} saved. Done.` : has.notes ? 'Done.' : 'I have no Notes tool, so the findings go in my final answer.',
    `From the course documents on ${topic}: ${listText}${saved.length ? ` Saved as note${saved.length > 1 ? 's' : ''} #${saved.join(', #')}.` : has.notes ? '' : ' (No Notes tool was enabled, so nothing was saved.)'}${points.length < want ? ` The documents only supported ${points.length} of the ${want} points, so I stopped there rather than invent one.` : ''}`);
}

const ARITH_RE = /(\(?\s*\d[\d.]*\s*(?:[-+*/%]\s*\(?\s*\d[\d.]*\s*\)?\s*)+)/;

/** Turn a goal into a short search query: drop the question framing, keep the subject. */
function queryFrom(goal) {
  const q = clean(goal)
    .replace(/^(please\s+)?(find out|find|research|search( for)?|look up|tell me( about)?|explain|summari[sz]e|work out|figure out)\s+/i, '')
    .replace(/^what (does|do) (the )?(source|sources|documents?|docs|course)( documents?)? say about\s+/i, '')
    .replace(/\b(and|then)\s+(save|note|write|record)\b.*$/i, '')
    .replace(/[?.!]+$/, '');
  return q.split(' ').slice(0, 8).join(' ');
}

function genericScript(goal, has, H) {
  const pct = goal.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
  const calcExpr = pct ? `${pct[2]} * ${pct[1]}%` : goal.match(ARITH_RE)?.[1]?.trim();
  const query = queryFrom(goal);
  const wantsNote = /\bnote|save|record|write (it )?down|log it|remember\b/i.test(goal);
  const wantsTime = /\btime|date|today|now|deadline|clock\b/i.test(goal);
  const plan = [];
  if (has.calculator && calcExpr && calcExpr.length <= 120) plan.push(['calculator', calcExpr]);
  if (has.clock && wantsTime) plan.push(['clock', 'now']);
  if (has.docsearch && !calcExpr) plan.push(['docsearch', query || goal.slice(0, 60)]);
  const i = H.length;
  const last = H.at(-1);
  if (i < plan.length) {
    const [tool, input] = plan[i];
    const why = {
      calculator: `There’s arithmetic in the goal, so I’ll compute ${input} with the calculator instead of estimating.`,
      clock: 'The goal depends on the current date and time, so I’ll check the clock first.',
      docsearch: `I’ll search the course documents for “${input}” so my answer is grounded in the source.`,
    }[tool];
    return act(`${last ? `Got it: ${clip(last.observation, 90)}. ` : ''}${why}`, tool, input);
  }
  // each finding is a finished sentence built from a REAL observation
  const findings = H.filter((h) => h.tool !== 'notes').map((h) => {
    if (h.tool === 'calculator') return calcResult(h.observation) ? `The calculator gives ${clean(h.observation)}.` : null;
    if (h.tool === 'clock') return `${clean(h.observation)}.`;
    if (h.tool !== 'docsearch') return null;
    const known = pointsIn(h.observation).slice(0, 2).map((p) => p.point);
    if (known.length) return `The course documents say: ${known.join(' ')}`;
    const near = snippet(h.observation, query.toLowerCase().split(' ').filter((w) => w.length > 3));
    return near ? `The closest passage says: “${stripEnd(near)}.”` : null;
  }).filter(Boolean);
  const notes = H.filter((h) => h.tool === 'notes');
  if (has.notes && notes.length === 0 && wantsNote && plan.length === 0 && !findings.length) {
    return act('Nothing here needs looking up; the goal is to keep a record, so I’ll save it as a note.', 'notes', clip(stripEnd(goal), 300));
  }
  if (has.notes && notes.length === 0 && (wantsNote || plan.length === 0) && findings.length) {
    return act('I have what I need. Saving the result as a note so it isn’t lost.', 'notes', clip(`${stripEnd(goal)}: ${findings.join(' ')}`, 300));
  }
  if (!findings.length && notes.length) {
    return finish('The note is saved; nothing else was needed.', `Saved “${clip(stripEnd(goal), 90)}” as note #${noteNumber(notes[0].observation) ?? 1}.`);
  }
  if (!findings.length) {
    const kit = Object.keys(has).filter((k) => has[k]).join(', ') || 'none';
    return finish('None of my tools fit this goal, so I’ll stop instead of guessing.',
      `My toolkit (${kit}) can’t make progress on “${clip(stripEnd(goal), 80)}”, so I stopped rather than invent an answer. Try adding Document search for questions about the course material, or the Calculator for anything with numbers.`);
  }
  const noteNo = notes.length ? noteNumber(notes[0].observation) : null;
  return finish('That covers the goal with real tool results.',
    `For “${clip(stripEnd(goal), 80)}”: ${findings.join(' ')}${noteNo ? ` Saved as note #${noteNo}.` : ''}`);
}

function agentStep(ctx = {}) {
  const goal = clean(ctx.goal);
  const tools = Array.isArray(ctx.tools) ? ctx.tools.map(String) : [];
  const has = { calculator: tools.includes('calculator'), docsearch: tools.includes('docsearch'), notes: tools.includes('notes'), clock: tools.includes('clock') };
  const H = normHistory(ctx.history);
  const low = goal.toLowerCase();

  let decision;
  if (/refund|charged|overcharg|duplicate charge|double charge/.test(low) && /\d/.test(low)) decision = refundScript(goal, has, H);
  else if (/budget/.test(low) && /\d/.test(low)) decision = budgetScript(goal, has, H);
  else if (/guardrail/.test(low)) {
    decision = searchScript({ goal, has, H, queries: ['guardrails', 'human oversight'], want: 3, topic: 'guardrails', noteMode: /note/.test(low) ? 'each' : 'none', prefer: ['screen', 'vote', 'observe', 'stop', 'north'] });
  } else if (/tool/.test(low) && /agent/.test(low) && /research|find|what/.test(low)) {
    decision = searchScript({ goal, has, H, queries: ['tools an AI agent needs', 'Model Context Protocol connect tools'], want: 3, topic: 'the tools an AI agent needs', noteMode: /note|summary/.test(low) ? 'summary' : 'none', prefer: ['mcp', 'skills', 'reqs', 'north'] });
  } else decision = genericScript(goal, has, H);

  // never exceed the route's step budget: after 10 steps the agent must finish
  if (!decision.done && (H.length >= 10 || ctx.mustFinish)) {
    return finish('I’ve used my step budget, so I’m stopping here.', `Stopped at the step budget. Progress so far: ${H.map((h) => clip(h.observation, 60)).join(' · ')}`);
  }
  return decision;
}

/* ------------------------------------------------ flow LLM nodes */

function parseEmail(text) {
  const t = clean(text);
  const order = t.match(/#\s?(\d{3,})/)?.[1] ?? t.match(/order\s+(?:no\.?|number)?\s*(\d{3,})/i)?.[1] ?? null;
  const name = t.match(/[—–-]\s*([A-Z][a-z]+)\s*$/)?.[1]
    ?? t.match(/(?:thanks|regards|cheers|best|sincerely),?\s+([A-Z][a-z]+)/i)?.[1]
    ?? t.match(/(?:I'm|I am|this is|my name is)\s+([A-Z][a-z]+)/)?.[1] ?? null;
  const problem = t.match(/(?:arrived|came|is|was)\s+(?:with\s+)?(?:a\s+|an\s+)?((?:cracked|broken|damaged|smashed|dented|scratched|torn|missing|faulty|leaking)\b[^.,!?]*)/i)?.[1] ?? null;
  const low = t.toLowerCase();
  let category = 'General enquiry';
  if (/refund|money back|charged|charge|overcharg|billing|invoice|payment/.test(low)) category = 'Billing / refund';
  else if (/crack|broken|damag|smash|dent|scratch|defect|faulty|leak|torn|missing part/.test(low)) category = 'Damaged item';
  else if (/where is|hasn'?t arrived|not arrived|never arrived|late|delay|tracking|still waiting|lost/.test(low)) category = 'Delivery delay';
  else if (/cancel/.test(low)) category = 'Cancellation';
  else if (/password|log ?in|sign ?in|account|locked out/.test(low)) category = 'Account access';
  else if (/exchange|wrong size|return/.test(low)) category = 'Return / exchange';
  let urgency = 'Normal';
  if (/urgent|asap|immediately|today|furious|unacceptable|third time|again|lawyer|chargeback|!!/.test(low)) urgency = 'High';
  else if (/no rush|whenever|just wondering|when you can/.test(low)) urgency = 'Low';
  const wants = /replace|replacement|new one|send another/.test(low) ? 'replacement'
    : /refund|money back/.test(low) ? 'refund'
      : /exchange/.test(low) ? 'exchange'
        : /cancel/.test(low) ? 'cancellation'
          : /\?/.test(t) ? 'an answer' : 'help';
  return { text: t, order, name, problem, category, urgency, wants };
}

const looksLikeEmail = (t) => /\b(hi|hello|dear|hey)\b|order|#\d{3,}|—\s*[A-Z][a-z]+\s*$|thanks|regards/i.test(t);

function draftReply(e) {
  const hi = e.name ? `Hi ${e.name},` : 'Hi there,';
  const ord = e.order ? `your order #${e.order}` : 'your order';
  switch (e.category) {
    case 'Damaged item':
      return `${hi} I’m so sorry ${ord} arrived ${e.problem ? `with a ${e.problem}` : 'damaged'}. We’ll send a replacement at no cost, and there’s no need to return the damaged one. You’ll get a tracking link as soon as it ships.`;
    case 'Billing / refund':
      return `${hi} thanks for flagging the charges on ${ord}. I’ve passed the details to our billing team to confirm the amount, and we’ll email you as soon as it’s approved, usually within one business day.`;
    case 'Delivery delay':
      return `${hi} sorry ${ord} is taking longer than it should. I’m checking with the carrier now and will send you the latest tracking update today.`;
    case 'Cancellation':
      return `${hi} I can help with cancelling ${ord}. If it hasn’t shipped yet we’ll cancel it straight away and confirm by email.`;
    case 'Account access':
      return `${hi} sorry you’re locked out. Use “Forgot password” on the sign-in page to get a reset link; if it doesn’t arrive within 10 minutes, reply here and we’ll sort it out.`;
    case 'Return / exchange':
      return `${hi} happy to help with an exchange for ${ord}. Reply with the size or item you’d like instead and we’ll send a prepaid return label.`;
    default:
      return `${hi} thanks for getting in touch. I’ve read your message and I’m looking into it now; you’ll hear back from us within one business day.`;
  }
}

function classifyAndDraft(input) {
  const e = parseEmail(input);
  const head = [`Category: ${e.category}`, `Urgency: ${e.urgency}`, e.order ? `Order #${e.order}` : null, `Wants: ${e.wants}`].filter(Boolean).join(' · ');
  return `${head}\nDraft reply: ${draftReply(e)}`;
}

function policyCheck(input) {
  const t = clean(input);
  const category = t.match(/Category:\s*([^·\n]+?)\s*(?:·|$)/)?.[1]?.trim() ?? parseEmail(t).category;
  const draft = t.match(/Draft reply:\s*([\s\S]+)$/)?.[1] ?? '';
  const promisesMoney = /refund(ed)?\b|money back|credit|compensat|reimburs/i.test(draft) && !/passed the details|confirm the amount|once it’s approved|as soon as it’s approved/i.test(draft);
  const checks = [];
  if (!draft) checks.push('No draft found in the input, so I checked the request itself.');
  let verdict;
  let approval;
  switch (category) {
    case 'Damaged item':
      verdict = promisesMoney ? '⚠ Edit before sending' : '✓ OK to send';
      checks.push('Replacement is allowed under the damaged-item policy');
      approval = 'not needed for a replacement; required if the customer asks for money back';
      break;
    case 'Billing / refund':
      verdict = '⏸ Hold for approval';
      checks.push('Refunds move money, so a person confirms the amount first');
      approval = 'REQUIRED before this goes out';
      break;
    case 'Delivery delay':
      verdict = '✓ OK to send';
      checks.push('No delivery date guaranteed');
      approval = 'not needed';
      break;
    case 'Account access':
      verdict = '✓ OK to send';
      checks.push('No account details changed or revealed');
      approval = 'not needed';
      break;
    default:
      verdict = '✓ OK to send';
      checks.push('Routine reply, no commitments made');
      approval = 'not needed';
  }
  if (draft) checks.push(promisesMoney ? '⚠ the draft promises a refund, which the agent may not do alone: remove it' : 'no refund or credit promised ✓');
  if (draft && /#\d{3,}/.test(draft)) checks.push('order number quoted ✓');
  return `Verdict: ${verdict} · ${checks.join(' · ')} · Human approval: ${approval}.`;
}

/** Text an earlier step already drafted: a classify & draft block, or a reply that opens with the greeting our drafts use. */
const isDraft = (t) => /Draft reply:/.test(t)
  || (/^Hi (there|[A-Z][a-z]+),/.test(clean(t)) && /\b(we’ll|we'll|I’ve|I've|you’ll|you'll|I’m checking|I'm checking)\b/i.test(t));

const WANTS_PHRASE = { replacement: 'a replacement', refund: 'a refund', exchange: 'an exchange', cancellation: 'to cancel', 'an answer': 'an answer', help: 'help' };
const SUBJECT = {
  'Damaged item': (o) => `Your replacement${o ? ` for order #${o}` : ''}`,
  'Billing / refund': (o) => `Your billing question${o ? ` about order #${o}` : ''}`,
  'Delivery delay': (o) => `An update on ${o ? `order #${o}` : 'your order'}`,
  Cancellation: (o) => `Cancelling ${o ? `order #${o}` : 'your order'}`,
  'Account access': () => 'Getting back into your account',
  'Return / exchange': (o) => `Your exchange${o ? ` for order #${o}` : ''}`,
};

/** What a generic step does with a reply an earlier step drafted: review it rather than answer it again. */
function reviewDraft(input) {
  const t = clean(input);
  const draft = t.match(/Draft reply:\s*(.+)$/)?.[1] ?? t;
  const e = parseEmail(t);
  const category = t.match(/Category:\s*([^·]+?)\s*·/)?.[1]?.trim() ?? e.category;
  const money = /refund(ed)?\b|money back|credit|compensat|reimburs/i.test(draft) && !/passed the details|confirm the amount|approved/i.test(draft);
  const subject = (SUBJECT[category] ?? (() => 'Re: your message'))(e.order);
  return `Reviewed the draft: it answers what the customer asked${e.order ? `, quotes order #${e.order}` : ''} and ${money ? 'promises money back, so a person must approve it first' : 'makes no promise the policy forbids'}. Suggested subject: “${subject}”. Status: ${money ? 'hold for approval' : 'ready to send'}.`;
}

function processRequest(input) {
  const t = clean(input);
  if (!t || t === '(empty input)') return 'There was no input to work with. Type a request into the test input and run the flow again.';
  if (isDraft(input)) return reviewDraft(input);
  if (looksLikeEmail(t)) return draftReply(parseEmail(t));
  if (/\b(build|make|create|design)\b.*\b(agent|bot|assistant|automation|flow)\b/i.test(t)) {
    return `Start with the smallest version that works: one LLM step with a clear, specific prompt, one or two real tools for the facts it needs, and a check step before anything reaches a person. Test it on ten real examples, note where it fails, and only then add more steps or more autonomy.`;
  }
  if (/\d\s*[-+*/]\s*\d/.test(t)) {
    return `That needs exact arithmetic, so a model shouldn’t guess it. Add a Calculator tool step before this one and pass it the expression; this step can then explain the real result in plain words.`;
  }
  return `Here’s how I’d handle “${clip(stripEnd(t), 90)}”: first pin down the outcome you need, then gather the facts with the right tool, and reply with one clear next step. Add a tool step (search or calculator) upstream if the answer depends on data I can’t see.`;
}

/** The docsearch tool's output (a summarise step normally sits right after it). */
const isPassages = (t) => /^\s*(Top passages for "|No passages found)/.test(String(t ?? ''));

/** A summary of plain text: an email, an earlier step's draft, or any prose. */
function summarizePlain(input) {
  const t = clean(input);
  if (!t || t === '(empty input)') return 'There was no text to summarise. Type something into the test input and run the flow again.';
  const e = parseEmail(t);
  if (/Draft reply:/.test(t)) {
    const category = t.match(/Category:\s*([^·]+?)\s*·/)?.[1]?.trim() ?? e.category;
    return `Summary: a ${category.toLowerCase()} email${e.order ? ` about order #${e.order}` : ''}. The draft reply offers ${WANTS_PHRASE[e.wants] ?? 'a next step'} and is ready for a policy check before it goes out.`;
  }
  if (looksLikeEmail(t)) {
    const who = e.name ?? 'The customer';
    const what = e.problem
      ? `says ${e.order ? `order #${e.order}` : 'the order'} arrived with a ${e.problem}`
      : `writes about ${e.category === 'General enquiry' ? 'a general question' : e.category.toLowerCase()}${e.order ? ` on order #${e.order}` : ''}`;
    return `Summary: ${who} ${what} and wants ${WANTS_PHRASE[e.wants] ?? 'help'}. Urgency: ${e.urgency.toLowerCase()}.`;
  }
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  if (sentences.length <= 1) return `Summary: ${clip(t, 200)}`;
  return `Summary:\n${sentences.slice(0, 3).map((s) => `• ${clip(s, 110)}`).join('\n')}`;
}

/** Extractive 3-bullet summary of real docsearch passages (plain text gets a plain summary). */
function summarize(input) {
  const t = String(input ?? '');
  if (!isPassages(t)) return summarizePlain(t);
  const q = t.match(/Top passages for "([^"]+)"/)?.[1] ?? null;
  const words = (q ?? t).toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const known = pointsIn(t).map((p) => p.point);
  const body = t.replace(/^Top passages for "[^"]*":\s*/, '').replace(/-{3,}/g, ' ').replace(/[•●]/g, ' ').replace(/\s+/g, ' ');
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length >= 50 && s.length <= 320)
    .map((s, i) => ({ s, i, score: words.reduce((n, w) => n + (s.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => clip(x.s, 110));
  const pool = [...known, ...sentences].filter((b, i, all) => all.indexOf(b) === i);
  if (!pool.length) return `The search returned nothing I can summarise${q ? ` for “${q}”` : ''}. Try a more specific question.`;
  // up to 3 bullets, but keep the whole answer inside the ~400 characters the run panel shows
  const head = q ? `On “${clip(q, 70)}”:` : 'Summary:';
  const bullets = [];
  for (const b of pool) {
    if (bullets.length >= 3) break;
    const next = `${head}\n${[...bullets, b].map((x) => `• ${x}`).join('\n')}`;
    if (bullets.length >= 1 && next.length > 400) break;
    bullets.push(b);
  }
  return `${head}\n${bullets.map((b) => `• ${b}`).join('\n')}`;
}

function parseBrief(input) {
  const t = clean(input);
  const product = t.match(/[“"]([^”"]{2,40})[”"]/)?.[1]
    ?? t.match(/\b(?:launch(?:ing)?|promote|promoting|for)\s+(?:our\s+|the\s+|my\s+|a\s+|an\s+)?(?:new\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/)?.[1]
    ?? null;
  const audience = t.match(/\b(?:for|aimed at|targeting|to reach)\s+((?:small|busy|young|local|new|first-time|remote|working)?\s*[a-z-]+(?:\s+[a-z-]+)?\s+(?:owners|teams|parents|students|developers|professionals|founders|customers|shoppers|gamers|learners|managers|marketers|teachers|nurses|runners))/i)?.[1] ?? null;
  const budget = t.match(/[$€£]\s?\d[\d,]*(?:k)?/)?.[0] ?? null;
  const weeks = t.match(/(\d+)[-\s]week/i)?.[1] ?? null;
  const goal = t.match(/(\d[\d,]*)\s+(sign-?ups|signups|leads|customers|downloads|sales|orders|bookings)/i) ?? null;
  const low = t.toLowerCase();
  const domain = /caf[eé]|coffee|restaurant|food|bakery/.test(low) ? 'food'
    : /app|saas|software|platform|tool|ai\b/.test(low) ? 'software'
      : /fitness|gym|yoga|running|health/.test(low) ? 'fitness'
        : /course|learn|tutor|school|education|training/.test(low) ? 'education'
          : /shop|store|fashion|clothing|retail/.test(low) ? 'retail' : 'general';
  return { t, product, audience, budget, weeks, goal, domain };
}

const PAINS = {
  food: ['no time for a proper lunch on workdays', 'bored of the same few options nearby', 'unsure what fits their diet (vegan, gluten-free)'],
  software: ['too many tools that don’t talk to each other', 'hours lost to repetitive manual work', 'worried a new tool will take weeks to adopt'],
  fitness: ['struggle to stay consistent past week three', 'don’t know which routine suits their level', 'gym schedules clash with work'],
  education: ['short on time to study', 'generic courses that ignore what they already know', 'no feedback on whether they are improving'],
  retail: ['can’t judge fit or quality online', 'returns are a hassle', 'too many similar options to choose from'],
  general: ['short on time', 'unsure which option is right for them', 'burned by products that overpromised before'],
};
const AUDIENCE = {
  food: 'busy office workers within walking distance',
  software: 'small-business owners and team leads who run operations themselves',
  fitness: 'working adults restarting a fitness habit',
  education: 'working professionals learning in short evening sessions',
  retail: 'online shoppers aged 25–40 who value quality over price',
  general: 'time-poor professionals who compare options online before buying',
};

function audienceAnalysis(input) {
  const b = parseBrief(input);
  const pains = PAINS[b.domain];
  // carry the brief's hard numbers forward: the plan step only sees this output and the copy
  const facts = [b.weeks ? `${b.weeks} weeks` : null, b.budget, b.goal ? `${b.goal[1]} ${b.goal[2]}` : null].filter(Boolean);
  return `Target audience: ${b.audience ?? AUDIENCE[b.domain]}${b.product ? `, the people most likely to try ${b.product}` : ''}. Pain points: 1) ${pains[0]}; 2) ${pains[1]}; 3) ${pains[2]}. Lead with the first one.${facts.length ? ` Brief: ${facts.join(' · ')}.` : ''}`;
}

function copywriter(input) {
  const b = parseBrief(input);
  // no invented facts (prices, trials, return policies): the copy only promises what a brief implies
  const P = b.product ?? { software: 'one tool', fitness: 'this plan', education: 'this course' }[b.domain] ?? 'it';
  const lines = {
    food: [`Lunch, sorted in five minutes${b.product ? ` at ${b.product}` : ''}.`, 'Skip the sad desk salad: fresh, fast and right around the corner.'],
    software: [`Stop copy-pasting between tools. Let ${P} do the busywork.`, 'Get your Fridays back from the admin your team hates.'],
    fitness: [`Week three is where most people quit. ${cap(P)} is built for week three.`, 'A routine that fits your calendar, not the other way round.'],
    education: [`Skip what you already know: ${P} starts where you are.`, 'Twenty minutes an evening, and progress you can actually see.'],
    retail: [`Fewer, better things${b.product ? `, from ${b.product}` : ''}.`, 'Made to last, so you only buy it once.'],
    general: [`${b.product ? `${b.product}: the` : 'The'} simpler way to get it done.`, 'Less time on admin, more time on the work that pays.'],
  }[b.domain];
  return `Variant A: “${lines[0]}” Variant B: “${lines[1]}”`;
}

function campaignPlan(input) {
  const b = parseBrief(input);
  const aud = String(input ?? '').match(/Target audience:\s*([^.;]+)/)?.[1]?.trim() ?? AUDIENCE[b.domain];
  const va = String(input ?? '').match(/Variant A:\s*“([^”]+)”/)?.[1] ?? null;
  const weeks = b.weeks ?? '4';
  const target = b.goal ? `${b.goal[1]} ${b.goal[2]}` : 'a clear sign-up target';
  return `Launch plan (${weeks} weeks${b.budget ? `, ${b.budget}` : ''}): reach ${clip(aud.replace(/, the people most likely.*$/, ''), 70)} with two ad variants${va ? `, led by “${stripEnd(clip(va, 50))}”` : ''}. Week 1: split spend evenly and track cost per result. Then shift spend to the winner and retarget clicks that didn’t convert. Success = ${target}. Review weekly; a person signs off any budget increase.`;
}

function genericNode(label, instruction, input) {
  const ins = clean(instruction);
  const t = clean(input);
  const low = ins.toLowerCase();
  if (/summar/.test(low)) return summarize(input);
  if (/classif|categor|label|triage/.test(low)) return classifyAndDraft(input).split('\n')[0];
  if (/draft|reply|respond|answer/.test(low) && isDraft(input)) return reviewDraft(input);
  if (/draft|reply|respond|answer/.test(low) && looksLikeEmail(t)) return draftReply(parseEmail(t));
  if (/check|review|verify|policy|approve/.test(low) || /check|review|policy/i.test(label)) return policyCheck(input);
  if (/translat/.test(low)) return `Translation needs the target language in the prompt, e.g. “Translate into Spanish”. Input received: “${clip(t, 120)}”.`;
  if (/extract|pull out|list/.test(low)) {
    const e = parseEmail(t);
    return `Extracted: ${[e.name ? `name ${e.name}` : null, e.order ? `order #${e.order}` : null, `topic ${e.category.toLowerCase()}`, `wants ${e.wants}`].filter(Boolean).join(' · ')}.`;
  }
  return processRequest(input);
}

/**
 * Labels an LLM node carries before anyone renames it: the palette's default for a new
 * LLM node ('LLM step', and numbered copies), the starter template's 'Process', and the
 * other node types' defaults in case a label is copied onto an LLM node.
 */
const DEFAULT_LLM_LABEL = /^(llm step|process|step|new step|trigger|tool|output|result|untitled)( ?#?\d+| \(\d+\))?$/;

/** An LLM node labelled like a search step can't search; it says so and points at the tool node. */
function searchWithoutTool(input) {
  const q = clean(input);
  return `An LLM step can’t search by itself, so there are no passages to read yet. Make this a 🔧 Tool step with docsearch and it will return real passages${q && q !== '(empty input)' ? ` for “${clip(stripEnd(q), 80)}”` : ''}; a Summarize step after it can then turn them into bullet points.`;
}

function flowNode(ctx = {}) {
  const label = clean(ctx.label);
  const l = label.toLowerCase();
  const input = String(ctx.input ?? '');
  if (/classif/.test(l) && /draft|reply|respond/.test(l)) return classifyAndDraft(input);
  if (/classif|triage|categor/.test(l)) return classifyAndDraft(input).split('\n')[0];
  if (/policy|compliance|review|check|guard/.test(l)) return policyCheck(input);
  if (/draft|reply|respond/.test(l)) {
    if (isDraft(input)) return reviewDraft(input);
    return looksLikeEmail(input) ? draftReply(parseEmail(input)) : processRequest(input);
  }
  if (DEFAULT_LLM_LABEL.test(l)) return processRequest(input);
  if (/summar/.test(l)) return summarize(input);
  if (/search/.test(l)) return isPassages(input) ? summarize(input) : searchWithoutTool(input);
  if (/audience/.test(l)) return audienceAnalysis(input);
  if (/copy|\bads?\b|headline|slogan|tagline/.test(l)) return copywriter(input);
  if (/campaign|\blaunch|\bplan(s|ner|ning)?\b/.test(l)) return campaignPlan(input);
  return genericNode(label, ctx.instruction, input);
}

/* ------------------------------------------------ integration guide */

function integrationGuide(ctx = {}) {
  const nodes = Array.isArray(ctx.nodes) ? ctx.nodes : [];
  const wires = Array.isArray(ctx.wires) ? ctx.wires : [];
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const name = (id) => byId.get(String(id))?.label ?? String(id);
  const icon = { trigger: '⚡', llm: '✨', tool: '🔧', output: '📤' };
  const role = (n) => ({
    trigger: 'your entry point: a webhook or queue consumer that receives the input',
    llm: 'one model call: system = this step’s prompt, user = the upstream text',
    tool: `a plain function in your codebase${n.tool ? ` (\`${n.tool}\`)` : ''} that runs for real, no model involved`,
    output: 'the return value: save it, show it, or queue it for approval',
  }[n.type] ?? 'a function with one input and one output');
  const lines = nodes.slice(0, 8).map((n) => `- **${icon[n.type] ?? '•'} ${clip(n.label ?? n.id, 40)}** → ${role(n)}`);
  const chain = wires.slice(0, 6).map(([a, b]) => `${name(a)} → ${name(b)}`).join(', ');
  const llmCount = nodes.filter((n) => n.type === 'llm').length;
  const hasCheck = nodes.some((n) => /check|policy|review/i.test(n.label ?? ''));
  return [
    '**1. What each step maps to**',
    ...lines,
    '',
    '**2. Running the LLM steps with any provider**',
    `- Your flow has ${llmCount} LLM step${llmCount === 1 ? '' : 's'}; any provider’s chat API can run them.`,
    '- Keep the prompts in the JSON, so they can change without a deploy.',
    '- Set a timeout, retry once, and log tokens per step.',
    '',
    '**3. Wiring the JSON into a runner loop**',
    '```js',
    'for (const id of topoSort(flow.nodes, flow.edges)) {',
    '  const node = byId[id];',
    '  const input = upstream(id).join("\\n\\n") || trigger;',
    '  out[id] = node.type === "llm" ? await llm(node.config.prompt, input)',
    '    : node.type === "tool" ? await tools[node.config.tool](input)',
    '    : input;',
    '}',
    '```',
    '',
    '**4. Testing the connections end to end**',
    `- Wires to verify: ${chain || 'none yet, so connect every step first'}.`,
    '- Run 20 real inputs with known answers and check every node’s output, not just the last.',
    hasCheck ? '- Count how often the check step objects: that number is your quality metric.' : '- Add a check step after your main LLM step and count how often it objects.',
    '- Nothing irreversible should run until a person approves the result.',
  ].join('\n');
}

export default {
  topicId: 'ai-agents',
  knowledgeMap,
  questions,
  lesson,
  expansion,
  tutor,
  summary,
  agentStep,
  flowNode,
  integrationGuide,
  // the chatbot compare lives in the chatbots corpus; delegate lazily
  chat: (ctx) => chatbots.chat(ctx),
};
