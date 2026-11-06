/**
 * Replay provider for the pitch demo — ONLY active when OCEANMIND_DEMO=1 (see
 * getAiConfig in ai.js). It stands in for the model and nothing else: the
 * routes, validators, shuffles, tool execution and DB writes around it are the
 * real ones. It is stateless — every answer is derived from the prompt the
 * real pipeline built — so retries, re-clicks and several tabs stay consistent.
 *
 * Detection order (first match wins):
 *   1. flow LLM node   system starts 'You are one step inside a small automation flow named "'
 *   2. TASK marker     'TASK: <name>' in the system prompt, or leading the first user message
 *   3. chatbot compare system mentions 'Reef Café assistant' (KB parsed from '- name: reply' lines)
 *   4. generic chat
 * The scripted content lives in server/demo/replay/<topicId>.js (see index.js).
 */
import { TOPICS } from './content/topics.js';
import { demoSpeed, DEMO_LATENCY_MS, DEMO_LATENCY_JITTER } from './demo/index.js';

const FLOW_PREFIX = 'You are one step inside a small automation flow named "';
const FLOW_MID = '". Do exactly your job, concisely (under 150 words). Your instruction: ';
const RETRY_MARK = '\n\nYour previous reply could not be used: ';
const NO_IDEA = ' (said "no idea")';

const TOPIC_BY_TITLE = Object.fromEntries(TOPICS.map((t) => [t.title, t.id]));
const LEVEL_TO_ZONE = { Beginner: 'sunlight', Intermediate: 'twilight', Advanced: 'midnight' };

// Base "thinking" time per task: DEMO_LATENCY_MS (server/demo/index.js, also
// published by GET /api/demo/status), × OCEANMIND_DEMO_SPEED, ± DEMO_LATENCY_JITTER.

/** Corpus method per task, and the corpus used when the prompt names no topic. */
const TASK_METHOD = {
  lesson: 'lesson', expand_steps: 'expansion', tutor_decide: 'tutor', summary: 'summary',
  agent_step: 'agentStep', flow_node: 'flowNode', integration_guide: 'integrationGuide', chat: 'chat',
};
const TASK_FALLBACK_TOPIC = { agent_step: 'ai-agents', flow_node: 'ai-agents', integration_guide: 'ai-agents', chat: 'chatbots' };

/** Free-text → topic when the keyword matcher (lib/topicMatch.js) found nothing. */
const TOPIC_SYNONYMS = {
  'neural-networks': [/\bbrain/, /\bneur/, /\bdeep learning\b/, /\bmachine learning\b/, /\blearns\b/, /\blearning from\b/,
    /\btrain(s|ed|ing)?\b/, /\bbackprop/, /\bgradients?\b/, /\bweights?\b/, /\blayers?\b/, /\brecogni[sz]/, /\bclassif/,
    /\bpredict/, /\bimages?\b/, /\bvision\b/, /\bpatterns?\b/],
  'ai-agents': [/\bagent/, /\bautonom/, /\btools?\b/, /\bautomat/, /\bworkflows?\b/, /\btakes? actions?\b/, /\bon its own\b/,
    /\bby itself\b/, /\binbox\b/, /\be-?mails?\b/, /\bschedul/, /\borchestrat/, /\bpipelines?\b/, /\bplan(s|ning)?\b/,
    /\bdo (tasks|things|work) for me\b/],
  chatbots: [/\bchat/, /\bbots?\b/, /\bconversation/, /\btalk/, /\bfaqs?\b/, /\bcustomer (questions|service)\b/, /\bwhatsapp\b/,
    /\bmessenger\b/, /\bdialog/, /\banswers? questions\b/, /\bwebsite (assistant|visitors)\b/, /\bvisitors\b/],
};

// ------------------------------------------------------------------ helpers

const clean = (s) => String(s ?? '').trim();

/** Text between `start` and the next `end` after it (null when `start` is missing). */
function between(text, start, end, { lastEnd = false } = {}) {
  const a = text.indexOf(start);
  if (a === -1) return null;
  const from = a + start.length;
  const b = lastEnd ? text.lastIndexOf(end) : text.indexOf(end, from);
  return text.slice(from, b === -1 || b < from ? undefined : b);
}

/** 'a · b · c' → ['a','b','c']; 'none…' / empty → []. */
function splitList(s) {
  const t = clean(s);
  if (!t || /^none\b/.test(t)) return [];
  return t.split(' · ').map(clean).filter(Boolean);
}

function topicIdFromTitle(title) {
  return TOPIC_BY_TITLE[clean(title)] ?? null;
}

/** Fallback: first quoted/known topic title before the source material. */
function topicIdFromHeader(prompt) {
  const cut = prompt.indexOf('SOURCE MATERIAL');
  const head = cut === -1 ? prompt : prompt.slice(0, cut);
  let best = null;
  let at = Infinity;
  for (const t of TOPICS) {
    const i = head.indexOf(t.title);
    if (i !== -1 && i < at) { best = t.id; at = i; }
  }
  return best;
}

function lastMatch(text, re) {
  let m = null;
  for (const x of text.matchAll(re)) m = x;
  return m;
}

function zoneFromLevel(text) {
  const m = lastMatch(text, /^- (Beginner|Intermediate|Advanced) depth: /gm);
  return m ? LEVEL_TO_ZONE[m[1]] : null;
}

function numberOrNull(s) {
  const n = Number(s);
  return s != null && s !== '' && Number.isFinite(n) ? n : null;
}

/** 'user: …' / 'assistant: …' lines (contents may span lines) → [{role, content}]. */
function parseConversation(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(user|assistant): ?(.*)$/.exec(line);
    if (m) out.push({ role: m[1], content: m[2] });
    else if (out.length) out[out.length - 1].content += `\n${line}`;
  }
  return out.map((x) => ({ ...x, content: x.content.trim() }));
}

// ------------------------------------------------------------------ per-task prompt parsers

function parseLesson(prompt, meta) {
  const profile = between(prompt, 'LEARNER PROFILE:\n', '\n\nSOURCE MATERIAL') ?? prompt;
  const missedItems = splitList(/^- Concepts they MISSED \(teach these carefully\): (.*)$/m.exec(profile)?.[1]);
  const strip = (x) => (x.endsWith(NO_IDEA) ? x.slice(0, -NO_IDEA.length) : x);
  const score = /scored (\d+(?:\.\d+)?)% on the placement quiz/.exec(profile)?.[1];
  return {
    topicId: topicIdFromTitle(/interactive walkthrough lesson on "(.+?)" for ONE specific learner/.exec(prompt)?.[1])
      ?? topicIdFromTitle(lastMatch(prompt, /AVAILABLE INTERACTIVE BLOCKS for "(.+?)"/g)?.[1]),
    ctx: {
      zone: /- Placement: (Sunlight|Twilight|Midnight) Zone/.exec(profile)?.[1]?.toLowerCase() ?? zoneFromLevel(prompt) ?? 'twilight',
      scorePct: numberOrNull(score),
      known: splitList(/^- Concepts they got RIGHT: (.*)$/m.exec(profile)?.[1]),
      missed: missedItems.map(strip),
      noIdea: missedItems.filter((x) => x.endsWith(NO_IDEA)).map(strip),
      goal: /- THEIR STATED GOAL \(the whole lesson must be built around this\): "([\s\S]*)"\s*$/.exec(profile)?.[1] ?? null,
      supportNote: /- Support team note: "([\s\S]*?)"(?=\s*(?:\n- Their complaint about the previous lesson: |\n- THEIR STATED GOAL|$))/.exec(profile)?.[1] ?? null,
      previousFeedback: /- Their complaint about the previous lesson: ([\s\S]*?)\s*(?=\n- THEIR STATED GOAL|$)/.exec(profile)?.[1] ?? null,
      redesign: Boolean(meta.redesign),
    },
  };
}

function parseExpansion(prompt, meta) {
  const existing = between(prompt, 'THE LESSON ALREADY CONTAINS (do NOT duplicate any of these titles, do NOT re-teach their content):\n', '\n\nINTERACTIVE BLOCKS ALREADY USED') ?? '';
  const used = clean(/INTERACTIVE BLOCKS ALREADY USED[^\n]*\n(.*)/.exec(prompt)?.[1]);
  return {
    topicId: topicIdFromTitle(lastMatch(prompt, /AVAILABLE INTERACTIVE BLOCKS for "(.+?)"/g)?.[1]),
    ctx: {
      about: /clarification of EXACTLY this: "([\s\S]*?)"\.\nCreate 2-3 NEW steps/.exec(prompt)?.[1] ?? '',
      currentStepTitle: /The learner is on step "([\s\S]*?)" and asked for a deeper/.exec(prompt)?.[1] ?? '',
      zone: zoneFromLevel(prompt) ?? 'twilight',
      goal: meta.goal ?? null,
      existingTitles: [...existing.matchAll(/^\d+\. "(.*)"(?: — already uses block: [\w-]+)?$/gm)].map((m) => m[1]),
      usedBlockTypes: !used || used === 'none' ? [] : used.split(', ').map(clean).filter(Boolean),
    },
  };
}

function parseTutor(prompt) {
  const head = /^LESSON: "(.*)" on (.+)$/m.exec(prompt);
  const stepLines = (between(prompt, 'STEPS (with their interactive blocks):\n', '\n\nCONVERSATION (latest last):') ?? '')
    .split('\n').filter((l) => /^\d+\. /.test(l));
  const HERE = '  ← learner is here';
  const steps = stepLines.map((l) => {
    const body = l.replace(/^\d+\. /, '').replace(HERE, '');
    const m = /^(.*?)(?: \[([\w-]+)\])?$/.exec(body);
    return { title: m[1], blockType: m[2] ?? null };
  });
  const convo = parseConversation(between(prompt, 'CONVERSATION (latest last):\n', '\n\nSOURCE MATERIAL:\n'));
  const lastUser = [...convo].reverse().find((m) => m.role === 'user');
  const here = stepLines.findIndex((l) => l.endsWith(HERE));
  return {
    topicId: topicIdFromTitle(head?.[2]),
    ctx: {
      lastUserMessage: lastUser?.content ?? '',
      lessonTitle: head?.[1] ?? '',
      stepTitles: steps.map((s) => s.title),
      stepBlockTypes: steps.map((s) => s.blockType),
      currentStepIndex: here === -1 ? 0 : here,
      history: convo,
    },
  };
}

function parseSummary(prompt) {
  const head = /personalized lesson on "(.+?)" \((Sunlight|Twilight|Midnight) Zone, placement (\d+(?:\.\d+)?|—)%\)/.exec(prompt);
  const steps = (between(prompt, 'LESSON STEPS THEY COMPLETED:\n', '\n\nCONCEPTS THEY ORIGINALLY MISSED') ?? '')
    .split('\n').filter((l) => l.startsWith('- '))
    .map((l) => {
      const m = /^- (.*?)(?: \[interactive: ([\w-]+)\])?$/.exec(l);
      return { title: m[1], blockType: m[2] ?? null };
    });
  return {
    topicId: topicIdFromTitle(head?.[1]),
    ctx: {
      zone: head?.[2]?.toLowerCase() ?? 'twilight',
      scorePct: numberOrNull(head?.[3]),
      missed: splitList(/^CONCEPTS THEY ORIGINALLY MISSED IN THE PLACEMENT QUIZ: (.*)$/m.exec(prompt)?.[1]),
      steps,
      goal: /^THEIR GOAL \([^)]*\): "([\s\S]*?)"$/m.exec(prompt)?.[1] ?? null,
    },
  };
}

/** 'STEP n\nTHOUGHT: …\nACTION: tool(input)\nOBSERVATION: …' blocks → [{thought, tool, input, observation}]. */
function parseAgentHistory(text) {
  const t = String(text ?? '');
  if (!t.trim() || t.trim().startsWith('(none')) return [];
  return t.split(/(?:^|\n)STEP \d+\n(?=THOUGHT: )/).filter((p) => p.trim()).map((part) => {
    const p = part.replace(/\s+$/, '');
    const m = /^THOUGHT: ([\s\S]*?)(?:\nACTION: ([\s\S]*?)\nOBSERVATION: ([\s\S]*))?$/.exec(p);
    const act = m?.[2] ? /^([\w-]+)\(([\s\S]*)\)$/.exec(m[2]) : null;
    return {
      thought: clean(m?.[1] ?? p.replace(/^THOUGHT: /, '')),
      tool: act?.[1] ?? null,
      input: act ? act[2] : null,
      observation: m?.[3] ?? null,
    };
  });
}

function parseAgentStep(prompt) {
  const tools = between(prompt, 'AVAILABLE TOOLS:\n', '\n\nHISTORY SO FAR:\n') ?? '';
  const history = parseAgentHistory(between(prompt, 'HISTORY SO FAR:\n', '\n\nDecide your NEXT step.', { lastEnd: true }));
  return {
    topicId: null,
    ctx: {
      goal: /^GOAL: ([\s\S]*?)\n\nAVAILABLE TOOLS:\n/.exec(prompt)?.[1] ?? '',
      tools: [...tools.matchAll(/^- "([\w-]+)":/gm)].map((m) => m[1]),
      stepNumber: history.length + 1,
      history,
      mustFinish: prompt.includes('ZERO more tool steps'),
    },
  };
}

function parseIntegrationGuide(prompt) {
  const lines = (between(prompt, 'downloaded it as JSON:\n', '\nWires: ') ?? '').split('\n');
  const nodes = lines
    .map((l) => /^- (.+?) \((trigger|llm|tool|output)\): "(.*?)"(?=$| prompt: | tool: )(?: prompt: (.*?))?(?: tool: ([\w-]+))?$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ id: m[1], type: m[2], label: m[3], prompt: m[4] ?? null, tool: m[5] ?? null }));
  const wires = (/^Wires: (.*)$/m.exec(prompt)?.[1] ?? '')
    .split(', ').map((w) => w.split(' → ').map(clean)).filter((w) => w.length === 2 && w[0] && w[1]);
  return { topicId: null, ctx: { nodes, wires } };
}

function parseFlowNode(system, messages) {
  const mid = system.indexOf(FLOW_MID, FLOW_PREFIX.length);
  const label = mid === -1 ? (/named "([^"]*)"/.exec(system)?.[1] ?? '') : system.slice(FLOW_PREFIX.length, mid);
  const instruction = mid === -1 ? (/Your instruction: ([\s\S]*)$/.exec(system)?.[1] ?? '') : system.slice(mid + FLOW_MID.length);
  const input = [...messages].reverse().find((m) => m?.role === 'user')?.content ?? '';
  return { label, instruction, input: String(input) };
}

function parseChat(system, messages) {
  const kbText = between(system, 'Your knowledge base:\n', '\nIf asked something outside') ?? '';
  const kb = [...kbText.matchAll(/^- ([^:\n]+): (.*)$/gm)].map((m) => ({ name: clean(m[1]), reply: clean(m[2]) }));
  const history = messages.map((m) => ({ role: m?.role, content: String(m?.content ?? '') }));
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  return { kb, lastUserMessage: lastUser?.content ?? '', history };
}

// ------------------------------------------------------------------ public API

/**
 * Work out what the pipeline is asking for. Pure (no corpus, no I/O).
 * @returns {{ task: string, topicId: string|null, ctx: object, retry: boolean, retryReason: string|null }}
 */
export function parseReplayRequest(system, messages = [], opts = {}) {
  const sys = String(system ?? '');
  const msgs = Array.isArray(messages) ? messages : [];
  const first = String(msgs[0]?.content ?? '');
  const meta = opts?.meta ?? {};
  const retryAt = first.indexOf(RETRY_MARK);
  const retry = retryAt !== -1;
  const retryReason = retry ? first.slice(retryAt + RETRY_MARK.length).split('\n')[0] : null;
  const prompt = retry ? first.slice(0, retryAt) : first;
  const out = (task, parsed) => ({ task, topicId: parsed.topicId ?? null, ctx: parsed.ctx, retry, retryReason });

  // 1. flow node first, so text typed into a flow input can never pose as a TASK
  if (sys.startsWith(FLOW_PREFIX)) return out('flow_node', { ctx: parseFlowNode(sys, msgs) });

  // 2. TASK marker (system prompt, or the head of the first user message)
  const task = /TASK:\s*([a-z_]+)/.exec(sys)?.[1] ?? /^TASK:\s*([a-z_]+)/.exec(prompt)?.[1] ?? null;
  const withTopic = (parsed) => ({ ...parsed, topicId: parsed.topicId ?? topicIdFromHeader(prompt) });
  switch (task) {
    case 'knowledge_map':
      return out(task, withTopic({ topicId: topicIdFromTitle(/Analyze the topic "(.+?)" and compile/.exec(prompt)?.[1]), ctx: {} }));
    case 'questions':
      return out(task, withTopic({
        topicId: topicIdFromTitle(/placement assessment for "(.+?)" based on/.exec(prompt)?.[1]),
        ctx: { concepts: splitList(/^KNOWLEDGE MAP CONCEPTS: (.*)$/m.exec(prompt)?.[1]) },
      }));
    case 'lesson': return out(task, withTopic(parseLesson(prompt, meta)));
    case 'expand_steps': return out(task, withTopic(parseExpansion(prompt, meta)));
    case 'tutor_decide': return out(task, withTopic(parseTutor(prompt)));
    case 'summary': return out(task, withTopic(parseSummary(prompt)));
    case 'agent_step': return out(task, parseAgentStep(prompt));
    case 'integration_guide': return out(task, parseIntegrationGuide(prompt));
    case 'topic_match':
      return out(task, { ctx: { text: String([...msgs].reverse().find((m) => m?.role === 'user')?.content ?? '') } });
    default: break;
  }

  // 3. the chatbot lesson's live LLM compare; 4. anything else is plain chat
  if (sys.includes('Reef Café assistant')) return out('chat', { topicId: 'chatbots', ctx: parseChat(sys, msgs) });
  return out('chat', { topicId: null, ctx: { ...parseChat('', msgs), generic: true } });
}

/** Generic free-text → topic id (or 'none'), for phrasings the keyword matcher missed. */
export function replayTopicMatch(text) {
  const t = String(text ?? '').toLowerCase();
  let best = 'none';
  let bestScore = 0;
  for (const [id, patterns] of Object.entries(TOPIC_SYNONYMS)) {
    const score = patterns.filter((re) => re.test(t)).length;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}

/**
 * Produce the model's reply text for a parsed request from a corpus lookup.
 * Objects are JSON-stringified exactly like a model's JSON reply.
 * @param {ReturnType<typeof parseReplayRequest>} req
 * @param {(topicId: string) => object|null} getCorpus
 */
export function renderReplay(req, getCorpus) {
  if (req.task === 'topic_match') return replayTopicMatch(req.ctx.text);
  const pick = (topicId, field) => {
    const c = topicId ? getCorpus(topicId) : null;
    return c && c[field] !== undefined ? c : null;
  };
  const field = req.task === 'knowledge_map' ? 'knowledgeMap' : req.task === 'questions' ? 'questions' : TASK_METHOD[req.task];
  const corpus = pick(req.topicId, field) ?? pick(TASK_FALLBACK_TOPIC[req.task], field) ?? pick('ai-agents', field);
  if (!corpus) throw new Error(`no replay corpus provides "${field}" for ${req.topicId ?? 'this prompt'}`);
  const value = typeof corpus[field] === 'function' ? corpus[field](req.ctx) : corpus[field];
  if (value === undefined || value === null) throw new Error(`the ${req.topicId ?? ''} corpus returned nothing for ${req.task}`);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Replay latency for a task in ms: DEMO_LATENCY_MS[task] × OCEANMIND_DEMO_SPEED
 * (0 = instant) × a random factor in [1 - jitter, 1 + jitter]. Retries are instant.
 */
export function replayLatency(task, { retry = false } = {}) {
  const speed = demoSpeed();
  if (!speed || retry) return 0;
  const base = DEMO_LATENCY_MS[task] ?? 600;
  return Math.round(base * speed * (1 - DEMO_LATENCY_JITTER + Math.random() * 2 * DEMO_LATENCY_JITTER));
}

/** The provider entry point (ai.js aiChat, provider 'replay'). Returns the reply as a string. */
export async function replayChat(system, messages, opts = {}) {
  const req = parseReplayRequest(system, messages, opts);
  if (req.retry) console.warn(`[replay] ${req.task} (${req.topicId ?? '—'}) failed validation: ${req.retryReason}`);
  const { getCorpus } = await import('./demo/replay/index.js');
  let text;
  try {
    text = renderReplay(req, getCorpus);
  } catch (e) {
    console.error(`[replay] ${req.task} (${req.topicId ?? '—'}) failed:`, e);
    const err = new Error(`The demo replay could not answer this step (${req.task}): ${e.message}`);
    err.status = 502;
    throw err;
  }
  const ms = replayLatency(req.task, { retry: req.retry });
  if (ms) await new Promise((ok) => setTimeout(ok, ms));
  return text;
}
