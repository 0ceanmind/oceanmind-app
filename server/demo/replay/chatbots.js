/**
 * Replay corpus for Chatbots (pitch demo only). Pure and deterministic. The
 * `chat` function here also powers the ✨ LLM side of the chatbot builder: it
 * answers ONLY from the knowledge base the page sends (the learner's current
 * intents), matching meaning rather than exact words ("plant-based" finds the
 * vegan dish), and says so plainly when something isn't in the knowledge base.
 */
import agents from './ai-agents.js';

/* ------------------------------------------------ small text helpers */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => {
  const t = clean(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/[\s,;:.—-]+\S*$/, '')}…`;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const stripEnd = (s) => clean(s).replace(/[.!?…\s]+$/, '');
const quoteGoal = (goal) => stripEnd(clip(goal, 150));

/* ------------------------------------------------ knowledge map + placement */

const CONCEPTS = {
  intents: 'Intents',
  patterns: 'Pattern matching',
  fallback: 'Fallback responses',
  llm: 'LLM chatbots',
  grounding: 'Grounding & knowledge bases',
  context: 'Conversation context',
  hallucination: 'Hallucination',
  hybrid: 'Hybrid bots & escalation',
};

const LABEL = {
  intents: 'intents',
  patterns: 'pattern matching',
  fallback: 'fallback responses',
  llm: 'LLM chatbots',
  grounding: 'grounding & knowledge bases',
  context: 'conversation context',
  hallucination: 'hallucination',
  hybrid: 'hybrid bots & escalation',
};

const TEACH = {
  intents: 'an intent is the goal behind a message, like asking the opening hours, and a bot maps each message to one',
  patterns: 'a rule bot scores each message against trigger words and only understands phrasings someone wrote down',
  fallback: 'a good fallback admits the bot didn’t understand and steers the user back to what it can do',
  llm: 'an LLM bot writes its reply from a prompt, so it handles phrasings no rule anticipated',
  grounding: 'grounding means giving the model the real facts and telling it to answer only from them',
  context: 'context means carrying earlier turns forward, so a follow-up like “and on Sunday?” still makes sense',
  hallucination: 'a hallucination is a confident answer that isn’t true or isn’t in the bot’s knowledge',
  hybrid: 'hybrid bots use rules for exact, high-stakes flows, an LLM for open questions, and a person when unsure',
};

/** A concrete one-liner for the step that teaches a missed concept (the intro holds the definition). */
const STEP_TEACH = {
  intents: 'Many different phrasings, one intent behind them.',
  patterns: 'The bot counts words; it never understands them.',
  fallback: 'A good fallback admits the miss and points the way back.',
  llm: 'The model reads meaning, so phrasings nobody wrote down still land.',
  grounding: 'Every claim must trace back to a fact you gave it.',
  context: 'A follow-up only makes sense with the turns before it.',
  hallucination: 'A fluent answer is not the same as a true one.',
  hybrid: 'Rules where you need certainty, a model where you need flexibility, a person where you need judgement.',
};

const knowledgeMap = {
  mustKnow: [
    { name: CONCEPTS.intents, desc: 'The goal behind a message, such as asking opening hours or booking a table; bots map messages to intents.' },
    { name: CONCEPTS.patterns, desc: 'Rule bots score each message against trigger words and reply with the best-matching intent.' },
    { name: CONCEPTS.fallback, desc: 'What a bot says when nothing matches: admit it, then steer the user back to what it can do.' },
    { name: CONCEPTS.llm, desc: 'A language model writes replies from a prompt, handling phrasings no rule anticipated.' },
  ],
  needToKnow: [
    { name: CONCEPTS.grounding, desc: 'Giving the model approved facts and telling it to stay within them, so answers match the business.' },
    { name: CONCEPTS.context, desc: 'Carrying earlier turns forward so follow-ups like “and on Sunday?” still make sense.' },
    { name: CONCEPTS.hallucination, desc: 'A model confidently stating things that aren’t true or aren’t in its knowledge base.' },
    { name: CONCEPTS.hybrid, desc: 'Rules for high-stakes flows, an LLM for open questions, and a human handoff when confidence is low.' },
  ],
};

const questions = [
  {
    text: 'In a chatbot, what is an intent?',
    concept: CONCEPTS.intents,
    options: ['The bot’s reply template', 'The goal behind a user’s message', 'A single keyword', 'The user’s account ID'],
    correctIndex: 1,
    explanation: 'An intent is what the user wants, like “opening hours”. Many different phrasings map to the same intent.',
  },
  {
    text: 'A rule bot has the trigger word “vegan”. A user asks “anything plant-based?”. What happens?',
    concept: CONCEPTS.patterns,
    options: ['It matches, because the meaning is close', 'No trigger word matches, so it falls back', 'It asks a language model automatically', 'It crashes'],
    correctIndex: 1,
    explanation: 'Keyword matching compares words, not meaning. “Plant-based” shares no trigger word with “vegan”, so the rule bot hits its fallback.',
  },
  {
    text: 'What makes a good fallback reply?',
    concept: CONCEPTS.fallback,
    options: ['Silently guessing the closest intent', 'Repeating the user’s message back', 'Admitting it didn’t understand and offering what it can do', 'Ending the conversation'],
    correctIndex: 2,
    explanation: 'An honest fallback keeps trust and steers the user back on track, instead of a wrong answer or a dead end.',
  },
  {
    text: 'What can an LLM chatbot do that a keyword bot can’t?',
    concept: CONCEPTS.llm,
    options: ['Understand phrasings nobody wrote a rule for', 'Guarantee every answer is correct', 'Run without any prompt or instructions', 'Work with no knowledge of the business'],
    correctIndex: 0,
    explanation: 'An LLM generalises across wording, so “plant-based” and “vegan” land in the same place. It still needs the facts, and it can still be wrong.',
  },
  {
    text: 'How do you stop an LLM café bot from inventing opening hours?',
    concept: CONCEPTS.grounding,
    options: ['Raise the temperature', 'Give it the real facts and tell it to answer only from them', 'Remove the system prompt', 'Train it on more random chats'],
    correctIndex: 1,
    explanation: 'Grounding puts the real facts in the prompt with an instruction to stay inside them and to say “I’m not sure” otherwise.',
  },
  {
    text: 'User: “Book a table.” Bot: “For when?” User: “Friday.” What does the bot need to handle “Friday”?',
    concept: CONCEPTS.context,
    options: ['A bigger keyword list', 'A fallback message', 'A new intent called “Friday”', 'The earlier turns of the conversation'],
    correctIndex: 3,
    explanation: '“Friday” only makes sense as the answer to “for when?”. The bot has to carry the booking context forward from earlier turns.',
  },
];

/* ------------------------------------------------ learner context */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

function conceptKey(name) {
  const n = norm(name);
  for (const [k, v] of Object.entries(CONCEPTS)) if (norm(v) === n) return k;
  if (/hallucin/.test(n)) return 'hallucination';
  if (/ground|knowledge|rag|retriev/.test(n)) return 'grounding';
  if (/context|memory|multiturn|history/.test(n)) return 'context';
  if (/hybrid|escalat|handoff|human/.test(n)) return 'hybrid';
  if (/fallback/.test(n)) return 'fallback';
  if (/llm|language|generative/.test(n)) return 'llm';
  if (/pattern|keyword|match|rule/.test(n)) return 'patterns';
  if (/intent/.test(n)) return 'intents';
  return null;
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
  const noIdea = new Set((ctx.noIdea ?? []).map(conceptKey).filter(Boolean));
  const missed = [...new Set([...noIdea, ...(ctx.missed ?? []).map(conceptKey).filter(Boolean)])];
  return {
    zone,
    goal: clean(ctx.goal) || null,
    missed,
    noIdea,
    supportNote: clean(ctx.supportNote) || null,
    previousFeedback: clean(ctx.previousFeedback) || null,
    redesign: Boolean(ctx.redesign),
    taught: new Set(),
  };
}

/** The concept as a question topic (never "the the … question"). */
const qLabel = (k) => LABEL[k].replace(/^the /, '');

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
const MAX_BODY = 880; // validateSteps truncates longer bodies mid-sentence
/** Keep a body inside the limit: shorten the gap callout first (the intro teaches it too), then drop trailing lines. */
function fitBody(body) {
  let b = body;
  if (b.length > MAX_BODY) b = b.replace(/^(\*\*Your gaps?:\*\*.*?(?:depth check|built for you)\.) [^\n]*/, '$1');
  while (b.length > MAX_BODY && b.includes('\n')) b = b.slice(0, b.lastIndexOf('\n')).trimEnd();
  return b;
}
const step = (title, body, block) => (block ? { title, body: fitBody(body), block } : { title, body: fitBody(body) });
const goalLine = (c) => (c.goal ? `\n\nFor your goal, “${quoteGoal(c.goal)}”, sketch the three intents your users will ask about first.` : '');

/* ------------------------------------------------ lesson steps */

const STEPS = {
  pipeline(c) {
    return step('What happens when you press Send',
      `${gapNote(c, ['intents', 'patterns'])}A rule-based bot is a small pipeline. Press **▶ Auto-play** or step with **Next →**:
- the message is cleaned up and split into words
- every **intent** gets a score for how many of its trigger words appear
- the best score wins, and its reply is sent
- no score at all means the **fallback**

Notice there's no understanding anywhere in this pipeline, only word counting. Keep that in mind for the next step.`,
      {
        type: 'sequence',
        stages: [
          { label: 'Message in', detail: 'A customer types: “When do you open on Sunday?”' },
          { label: 'Normalise', detail: 'Lower-case it and split it into words: when, do, you, open, on, sunday.' },
          { label: 'Score intents', detail: 'Each intent counts its trigger words in the message. hours: “when” + “open” = 2. menu: 0. greeting: 0.' },
          { label: 'Pick a winner', detail: 'The highest score wins: hours, with 2 points. Ties go to whichever intent is listed first.' },
          { label: 'Reply', detail: 'The bot sends the hours intent’s fixed reply: “We’re open 8:00–22:00 every day, kitchen closes at 21:30.”' },
          { label: 'Or fall back', detail: 'If every score is 0, the fallback reply goes out instead: “Hmm, I’m not sure about that one. Could you rephrase, or ask about hours, menu, or bookings?”' },
        ],
      });
  },

  builder(c) {
    const gap = gapNote(c, ['patterns', 'llm', 'fallback', 'hallucination']);
    if (c.zone === 'sunlight') {
      return step('Chat with a rule-based bot',
        `${gap}Meet the Reef Café bot. It knows three intents: **greeting**, **hours** and **menu**. Chat with it:
- say “hi”, then “when do you open?”
- now ask “anything plant-based?”: there's no trigger word for that, so it falls back
- add an intent with the form, e.g. **booking** with triggers “book, table, reserve”, then ask “can I book a table?”

Notice the bot only knows the exact words you gave it.${goalLine(c)}`, { type: 'chatbot-builder' });
    }
    return step(depth(c, '', 'Two bots, one knowledge base', 'Rules vs. LLM, side by side'),
      `${gap}The top bot matches keywords; the **✨ LLM bot** gets the same intents as its knowledge base. One message goes to both:
- “when do you close?”: both handle it
- “do you have anything plant-based?”: the rule bot falls back, the LLM finds the vegan kelp noodle bowl
- “can I get a refund?”: nothing in the knowledge base covers it, so the LLM should say so, not invent a policy

Then add a **refunds** intent with the form and ask again: both bots now know it.${depth(c, '', '', ' Also try a follow-up such as “and is there parking?”.')}`, { type: 'chatbot-builder' });
  },

  intentsDiagram(c) {
    return step('Intents, triggers and replies',
      `${gapNote(c, ['intents', 'fallback'])}Here's the bot you just chatted with, drawn out. Click each box:
- every **intent** has trigger words and one fixed reply
- the **matcher** picks the intent with the most matching words
- the **fallback** catches everything else

Notice the reply is fixed text: a rule bot can never say anything you didn't write.`,
      {
        type: 'diagram',
        nodes: [
          { id: 'msg', label: 'User message', detail: 'Whatever the customer types, in their own words.' },
          { id: 'match', label: 'Matcher', detail: 'Counts trigger words for every intent and picks the highest score.' },
          { id: 'greet', label: 'greeting', detail: 'Triggers: hello, hi, hey. Reply: a friendly welcome.' },
          { id: 'hours', label: 'hours', detail: 'Triggers: open, close, when. Reply: 8:00–22:00 every day.' },
          { id: 'menu', label: 'menu', detail: 'Triggers: menu, food, vegan. Reply: today’s highlights.' },
          { id: 'fallback', label: 'Fallback', detail: 'No trigger matched: admit it and suggest what the bot can help with.' },
          { id: 'reply', label: 'Reply sent', detail: 'The chosen intent’s fixed reply, word for word.' },
        ],
        edges: [
          { from: 'msg', to: 'match' },
          { from: 'match', to: 'greet' },
          { from: 'match', to: 'hours' },
          { from: 'match', to: 'menu' },
          { from: 'match', to: 'fallback', label: 'score 0' },
          { from: 'greet', to: 'reply' },
          { from: 'hours', to: 'reply' },
          { from: 'menu', to: 'reply' },
          { from: 'fallback', to: 'reply' },
        ],
      });
  },

  fallbackSeq(c) {
    return step('A fallback that actually helps',
      `${gapNote(c, ['fallback'])}Every bot hits messages it doesn't understand. What matters is what happens next. Step through with **Next →**:
- **admit it**, briefly
- **offer** the things the bot can do
- **log** the message, so you can add the missing intent later

Notice that a bot's fallback log is the best to-do list you'll ever get.`,
      {
        type: 'sequence',
        stages: [
          { label: 'No match', detail: 'A customer asks “anything plant-based?” and no trigger word matches.' },
          { label: 'Admit it', detail: 'Say so plainly: “Sorry, I’m not sure about that one.” Never guess an answer.' },
          { label: 'Offer options', detail: 'Point to what the bot can do: “I can help with hours, menu or bookings.”' },
          { label: 'Log it', detail: 'Save the message. Real questions you didn’t expect are gold.' },
          { label: 'Add an intent', detail: 'Add “plant-based” as a trigger for the menu intent. Next time, it matches.' },
        ],
      });
  },

  groundedDiagram(c) {
    return step('How the LLM bot stays truthful',
      `${gapNote(c, ['grounding', 'hallucination', 'llm'])}The LLM bot isn't free to say anything: it's **grounded**. Click each box, left to right:
- the **knowledge base** is your intents' replies, pasted into the prompt
- the **instructions** say: answer only from these facts, keep it short
- if the answer isn't there, it must say so

Notice this is why it found the vegan bowl but wouldn't invent a refund policy.`,
      {
        type: 'diagram',
        nodes: [
          { id: 'msg', label: 'User message', detail: '“Do you have anything plant-based?”' },
          { id: 'kb', label: 'Knowledge base', detail: 'The facts you approved: hours, menu (kelp noodle bowl, vegan), bookings. Nothing else.' },
          { id: 'prompt', label: 'Prompt', detail: 'Persona + knowledge base + rules: be brief, answer only from the facts, say when you don’t know.' },
          { id: 'llm', label: 'Language model', detail: 'Understands that “plant-based” means vegan, and finds the matching fact.' },
          { id: 'check', label: 'In the facts?', detail: 'If the answer is in the knowledge base, reply. If not, say so instead of guessing.' },
          { id: 'reply', label: 'Grounded reply', detail: '“Yes! Our kelp noodle bowl is vegan.” Every claim traces back to the knowledge base.' },
        ],
        edges: [
          { from: 'msg', to: 'prompt' },
          { from: 'kb', to: 'prompt' },
          { from: 'prompt', to: 'llm' },
          { from: 'llm', to: 'check' },
          { from: 'check', to: 'reply' },
        ],
      });
  },

  coverageSim(c) {
    return step('Why rule bots hit a ceiling',
      `${gapNote(c, ['patterns'])}Real customers phrase the same question dozens of ways. The curve estimates how many messages a rule bot understands as you add trigger phrases (x). **k** is how varied your customers' wording is.
- the first 20 phrases cover a lot
- after that, each new phrase adds less and less
- raise **k** (more varied wording) and the curve flattens further

Notice the diminishing returns: that long tail is exactly what an LLM handles for free.`,
      {
        type: 'simulator',
        title: 'Messages understood vs. trigger phrases written',
        expr: '100*(1 - exp(-x/k))',
        xVar: 'x',
        xRange: [0, 200],
        vars: [{ name: 'k', min: 5, max: 120, init: 40, step: 1 }],
        yLabel: '% of messages matched',
      });
  },

  confidenceSim(c) {
    return step('Answer, or hand off to a person?',
      `${gapNote(c, ['hybrid'])}A production bot should know when to step aside. The x-axis is the bot's **confidence** that it understood; the curve is the chance it answers itself instead of handing off to a person.
- raise **t** and it hands off more: safer, but more work for staff
- raise **k** and the switch gets sharper

Notice you'd set a different **t** per intent: “what time do you open?” can go low, anything about money should go high.`,
      {
        type: 'simulator',
        title: 'Bot answers vs. human handoff',
        expr: 'sigmoid(k*(x - t))',
        xVar: 'x',
        xRange: [0, 1],
        vars: [
          { name: 'k', min: 2, max: 25, init: 12, step: 0.5 },
          { name: 't', min: 0.2, max: 0.95, init: 0.7, step: 0.01 },
        ],
        yLabel: 'chance the bot answers',
      });
  },

  contextSeq(c) {
    return step('Remembering the conversation',
      `${gapNote(c, ['context'])}Single messages are easy. Real conversations aren't. Step through a booking with **Next →**:
- “Friday” means nothing on its own
- the bot has to remember it asked “for when?”
- it fills one **slot** at a time until the booking is complete

Notice a pure keyword bot has no memory at all: each message is scored alone.`,
      {
        type: 'sequence',
        stages: [
          { label: 'Book a table', detail: 'The user starts a booking. The bot opens a form with empty slots: day, time, people.' },
          { label: 'For when?', detail: 'The bot asks for the first missing slot.' },
          { label: '“Friday”', detail: 'On its own this word matches no intent. In context, it fills the day slot.' },
          { label: 'Time & party', detail: 'The bot asks for the remaining slots: 19:30, four people.' },
          { label: 'Confirm', detail: 'Everything is filled, so it reads the booking back: “Friday, 19:30, table for four. Shall I book it?”' },
        ],
      });
  },

  hybridDiagram(c) {
    return step('The hybrid bot most teams ship',
      `${gapNote(c, ['hybrid', 'grounding'])}Production bots are rarely pure rules or pure LLM. Click each box:
- **rules** handle exact, high-stakes flows such as bookings: predictable and auditable
- the **grounded LLM** handles open questions in any phrasing
- a **confidence check** sends anything uncertain or sensitive to a **person**

Notice each part covers the others' weakness.${goalLine(c)}`,
      {
        type: 'diagram',
        nodes: [
          { id: 'msg', label: 'User message', detail: 'Any message, in any wording.' },
          { id: 'router', label: 'Intent router', detail: 'Decides: a known, structured flow, or an open question?' },
          { id: 'rules', label: 'Rule flows', detail: 'Bookings, opening hours: fixed, tested replies. No surprises.' },
          { id: 'llm', label: 'Grounded LLM', detail: 'Open questions, answered only from the approved knowledge base.' },
          { id: 'conf', label: 'Confidence check', detail: 'Low confidence, money or complaints? Don’t answer: escalate.' },
          { id: 'human', label: 'Human agent', detail: 'Gets the conversation with full context, so the customer never repeats themselves.' },
          { id: 'reply', label: 'Reply', detail: 'What the customer sees, whichever path produced it.' },
        ],
        edges: [
          { from: 'msg', to: 'router' },
          { from: 'router', to: 'rules', label: 'known flow' },
          { from: 'router', to: 'llm', label: 'open question' },
          { from: 'rules', to: 'reply' },
          { from: 'llm', to: 'conf' },
          { from: 'conf', to: 'reply', label: 'confident' },
          { from: 'conf', to: 'human', label: 'unsure' },
          { from: 'human', to: 'reply' },
        ],
      });
  },

  evalSeq(c) {
    return step('Testing a bot before launch',
      `${gapNote(c, ['hallucination'])}Bots fail quietly, so you test them loudly. Step through a simple evaluation loop with **Next →**:
- collect real questions, including the awkward ones
- score each answer for correctness and grounding
- track how often the bot says “I don't know” when it should

Notice the most important test cases are the questions your knowledge base can't answer.`,
      {
        type: 'sequence',
        stages: [
          { label: 'Collect', detail: 'Gather 50 real customer messages, plus 10 the knowledge base can’t answer.' },
          { label: 'Expected', detail: 'For each, write the right intent or the right “I’m not sure” response.' },
          { label: 'Run both bots', detail: 'Send every message through the rule bot and the LLM bot.' },
          { label: 'Score', detail: 'Correct? Grounded in the knowledge base? Any invented facts?' },
          { label: 'Fix & repeat', detail: 'Add triggers, tighten the prompt, re-run the whole set and compare scores.' },
        ],
      });
  },

  check(c) {
    const q = (text, options, correctIndex, explanation) => ({ type: 'check', question: { text, options, correctIndex, explanation } });
    if (c.zone === 'sunlight') {
      return step('Check: why did it fall back?',
        'One quick question to lock in the big idea.',
        q('Your menu intent has the trigger “vegan”. Why does “anything plant-based?” get the fallback?',
          ['The bot is broken', 'No trigger word appears in the message', 'The menu reply is too long', 'Plant-based food isn’t on the menu'],
          1,
          'Rule bots count matching words. “Plant-based” isn’t a trigger, so every intent scores 0 and the fallback wins.'));
    }
    if (c.zone === 'midnight') {
      return step('Check: design the escalation',
        'Last one. Think about which messages are worth a person’s time.',
        q('Which message should a well-designed hybrid bot hand to a person?',
          ['“What time do you open?”', '“Do you have vegan options?”', '“You charged me twice, I want my money back.”', '“Hi there!”'],
          2,
          'Money and complaints are high-stakes and emotional. The others are routine questions the knowledge base answers exactly.'));
    }
    return step('Check: the grounded answer',
      'Last one. Think about what the LLM bot is allowed to say.',
      q('A user asks the grounded LLM bot about refunds, and refunds aren’t in its knowledge base. What should it do?',
        ['Say it isn’t sure and offer what it does know', 'Invent a typical 30-day refund policy', 'Reply with the menu', 'Ignore the question'],
        0,
        'Grounded means answering only from approved facts. Admitting the gap keeps trust; an invented policy is a hallucination the café may have to honour.'));
  },
};

const PLANS = {
  sunlight: ['pipeline', 'builder', 'intentsDiagram', 'fallbackSeq', 'check'],
  twilight: ['pipeline', 'builder', 'groundedDiagram', 'coverageSim', 'contextSeq', 'check'],
  midnight: ['hybridDiagram', 'builder', 'coverageSim', 'confidenceSim', 'contextSeq', 'evalSeq', 'check'],
};

function lesson(ctx) {
  const c = makeCtx(ctx);
  const title = `${c.supportNote || c.previousFeedback ? 'Rebuilt for you: ' : ''}${depth(c,
    'Build your first chatbot',
    'Rule bots vs. LLM bots: build both, see the difference',
    'Chatbots in production: grounding, context and escalation')}`;
  const parts = [];
  if (c.supportNote || c.previousFeedback) {
    parts.push(`We rebuilt this dive after your feedback.${c.supportNote ? ` Our support team’s note: “${stripEnd(clip(c.supportNote, 160))}.”` : ''}`);
  }
  if (c.goal) parts.push(c.redesign ? `Lulu rebuilt this dive around your goal: “${quoteGoal(c.goal)}.”` : `You told us: “${quoteGoal(c.goal)}.”`);
  parts.push(depth(c,
    'You’ll see how a rule-based bot turns a message into a reply, chat with one, teach it new intents, and design a fallback that actually helps.',
    'You’ll build a rule-based bot and put it side by side with an LLM bot that shares its knowledge, then see why the LLM understands more, how grounding keeps it truthful, and how conversations carry context.',
    'This dive is about shipping: hybrid designs, the limits of rules, when to hand off to a person, multi-turn context and how to test a bot before customers do.'));
  if (c.missed.length) {
    const noIdea = c.missed.filter((k) => c.noIdea.has(k)).map((k) => LABEL[k]);
    const wrong = c.missed.filter((k) => !c.noIdea.has(k)).map((k) => LABEL[k]);
    const flagged = [noIdea.length ? `said “no idea” to ${list(noIdea)}` : '', wrong.length ? `missed ${list(wrong)}` : ''].filter(Boolean).join(' and ');
    parts.push(`On your depth check you ${flagged}, so ${c.missed.length > 1 ? 'those get' : 'that gets'} extra care along the way. The short version: ${cap(c.missed.slice(0, c.supportNote ? 2 : 3).map((k) => TEACH[k]).join('; '))}.`);
  } else {
    parts.push('You answered every depth-check question correctly, so we go straight to the design decisions.');
  }
  return { title, intro: parts.join(' '), steps: PLANS[c.zone].map((k) => STEPS[k](c)) };
}

/* ------------------------------------------------ Lulu: expansions */

function aboutTitle(about) {
  const a = clean(about).replace(/[?.!]+$/, '').replace(/\s+step by step$/i, ', step by step');
  return clip(cap(a), 70);
}

const EXPANSIONS = [
  {
    match: /ground|hallucin|knowledge|invent|make.{0,6}up|truth/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `Follow one question through a grounded LLM bot with **Next →**:
- the facts go into the prompt **before** the question
- the model is told to answer **only** from them
- when the facts don't cover it, the right answer is “I'm not sure”

Notice grounding doesn't make a model smarter: it makes it honest about what it knows.`,
        {
          type: 'sequence',
          stages: [
            { label: 'Question', detail: 'A customer asks: “Can I get a refund?”' },
            { label: 'Load facts', detail: 'The prompt gets the knowledge base: hours, menu, bookings. No refund policy is in it.' },
            { label: 'Instructions', detail: 'Rules in the prompt: answer only from these facts; if unsure, say so and offer what you know.' },
            { label: 'Model answers', detail: 'It finds no refund fact, so it says it isn’t sure and offers hours, menu or bookings.' },
            { label: 'Without it', detail: 'An ungrounded model might invent a 30-day policy that sounds right and that the café never offered.' },
          ],
        }),
    ],
  },
  {
    match: /fallback|escalat|hand ?off|human|confiden/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The x-axis is how confident the bot is that it understood; the curve is the chance it answers itself instead of passing the chat to a person. Slide **t** (the threshold) and **k** (how sharp the switch is).
- a high **t** is safe but sends more chats to staff
- a low **t** saves staff time but risks confident wrong answers`,
        {
          type: 'simulator',
          title: 'Bot answers vs. human handoff',
          expr: 'sigmoid(k*(x - t))',
          xVar: 'x',
          xRange: [0, 1],
          vars: [
            { name: 'k', min: 2, max: 25, init: 12, step: 0.5 },
            { name: 't', min: 0.2, max: 0.95, init: 0.7, step: 0.01 },
          ],
          yLabel: 'chance the bot answers',
        }),
    ],
  },
  {
    match: /context|memory|follow.?up|remember|multi.?turn|slot/i,
    steps: (x) => [
      step(aboutTitle(x.about),
        `The curve is how many tokens each reply carries when the bot keeps the last **w** turns of the conversation, at **t** tokens per turn.
- it rises, then flattens at the window size
- a bigger **w** remembers more follow-ups but costs more on every reply

Notice why long chats need a summary of older turns: the window can't hold everything forever.`,
        {
          type: 'simulator',
          title: 'Tokens per reply with a sliding window',
          expr: 't*min(x, w)',
          xVar: 'x',
          xRange: [1, 40],
          vars: [
            { name: 't', min: 20, max: 200, init: 60, step: 5 },
            { name: 'w', min: 2, max: 20, init: 6, step: 1 },
          ],
          yLabel: 'tokens per reply',
        }),
    ],
  },
];

const DEFAULT_EXPANSION = (x) => [
  step(aboutTitle(x.about),
    `Here's how a rule bot scores a message, stage by stage. Step through with **Next →** and notice the moment meaning gets lost: it only ever counts words.`,
    {
      type: 'sequence',
      stages: [
        { label: 'Message in', detail: 'A customer types: “Anything plant-based on the menu?”' },
        { label: 'Split words', detail: 'anything, plant, based, on, the, menu.' },
        { label: 'Score intents', detail: 'menu has “menu” → 1 point. hours: 0. greeting: 0.' },
        { label: 'Pick a winner', detail: 'menu wins with 1 point, so the full menu reply goes out.' },
        { label: 'What was lost', detail: 'The customer asked about vegan food. The bot matched “menu” and never noticed.' },
      ],
    }),
  step('Why rule bots hit a ceiling',
    `The curve estimates how many messages a rule bot understands as you add trigger phrases (x). **k** is how varied your customers' wording is. Notice the diminishing returns: each new phrase covers less than the last.`,
    {
      type: 'simulator',
      title: 'Messages understood vs. trigger phrases written',
      expr: '100*(1 - exp(-x/k))',
      xVar: 'x',
      xRange: [0, 200],
      vars: [{ name: 'k', min: 5, max: 120, init: 40, step: 1 }],
      yLabel: '% of messages matched',
    }),
];

function expansion(ctx = {}) {
  const about = clean(ctx.about) || 'how the bot picks a reply, step by step';
  const x = { about, zone: zoneOf(ctx.zone) };
  const hit = EXPANSIONS.find((e) => e.match.test(about));
  const steps = (hit ? hit.steps(x) : DEFAULT_EXPANSION(x)).map((s) => ({ ...s }));
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
  [/intent/i, 'An intent is what the user wants, not the words they use: “when do you open?”, “are you open now?” and “closing time?” are all the hours intent. A bot’s first job is mapping messages to intents; its second is replying well.'],
  [/pattern|keyword|trigger|match/i, 'The rule bot splits the message into words and counts how many of each intent’s trigger words appear. The highest count wins. It’s fast, cheap and predictable, but it only understands phrasings you wrote down.'],
  [/fallback|doesn.?t understand|confus/i, 'A good fallback admits the miss in one line, offers two or three things the bot can do, and logs the message. That log becomes your list of intents to add next.'],
  [/hallucin|\binvent|\bmak(e|es|ing) (things |stuff |facts |it |answers )?up\b|\bmade (things |stuff |it )?up\b|fabricat|\blies?\b|\blying\b|\bwrong\b/i, 'Ground the model: put the approved facts in its prompt and tell it to answer only from them, saying “I’m not sure” otherwise. Then test it with questions the facts don’t cover and check it admits the gap.'],
  [/llm|gpt|language model|ai bot|smarter/i, 'The LLM bot doesn’t match words; it reads meaning, so “plant-based” lands on the vegan dish. It still only knows what you give it, which is why the same intents power both bots.'],
  [/context|follow.?up|remember|memory/i, 'Carry the earlier turns into each new request, or track slots such as day, time and party size. Without that, “Friday” on its own means nothing.'],
  [/refund|money|complain/i, 'Anything about money or complaints is a good candidate for a human handoff. Add a refunds intent that explains the process, and route the actual decision to a person.'],
  [/\bcosts?\b|\bprice|cheap|expens/i, 'Rule bots cost nothing per message. LLM bots cost a little per reply, growing with the size of the knowledge base and the history you send. Many teams answer routine intents with rules and use the LLM for everything else.'],
  [/\btest|evaluat|measur/i, 'Collect 50 real questions plus 10 your knowledge base can’t answer, write the expected answer for each, and score both bots. The unanswerable ones matter most: that’s where hallucinations hide.'],
  [/^((hmm+|um+|oh|ah|alright|right|yeah)[,.!\s]+)?(i think i (get|got) it|got it|makes sense|ok(ay)?[.! ]*$|i see|understood|that helps|perfect)/i, 'Great, that’s the idea. Keep going, and ask me whenever something needs unpacking: I can also add a hands-on step if you ask me to walk you through something step by step. 🐙'],
  [/^(thanks|thank you|cool|great|awesome|nice)/i, 'Anytime! Try adding an intent of your own and see if both bots pick it up. 🐙'],
  [/^(hmm+|um+|uh+|huh)[.!?\s]*$/i, 'Take your time. If something in this step feels fuzzy, ask me about it, or ask me to walk you through it step by step and I’ll add a hands-on step. 🐙'],
];

/** Words that mark a question as being about this dive (anything else gets a polite redirect). */
const ON_TOPIC = /bot|chat|intent|pattern|trigger|keyword|fallback|llm|model|ground|hallucin|reply|message|knowledge|context|refund|caf[eé]|menu|step|block|lesson|rule|ai|customer|convers/i;

const EXPAND_RE = /step[- ]by[- ]step|walk me through|break (it|this|that)? ?down|go deeper|more detail|in detail|clarify|show me how|explain .{0,60}(more|again|slowly|properly)/i;
const REDESIGN_RE = /\bi want to build\b|\bi'?m building\b|\bi am building\b|\bmy (company|business|startup)\b/i;

function tutor(ctx = {}) {
  const msg = clean(ctx.lastUserMessage);
  const here = (ctx.stepTitles ?? [])[ctx.currentStepIndex ?? 0];
  if (REDESIGN_RE.test(msg)) {
    const goal = clip(cap(msg.replace(/[?!.]+$/, '').replace(/^.*?\bi (want|would like|need) to\s+/i, '')), 280);
    return { action: 'redesign', goal, reply: `Love that goal. I’m rebuilding your whole dive around it now, with every step aimed at “${clip(stripEnd(goal), 90)}”. 🌊` };
  }
  if (EXPAND_RE.test(msg)) {
    let about = clean(msg).replace(/[?!.]+$/, '').replace(/^(can|could|would) you (please )?/i, '').replace(/^please /i, '');
    about = about.replace(/^(walk me through|explain|show me how|show me|clarify|break down|tell me more about|help me understand)\s+/i, '');
    about = clip(about, 120) || 'this step, step by step';
    return { action: 'expand', about, reply: `On it. I’m adding interactive steps on ${clip(about, 70)} right after this one, so you can see it happen rather than read about it. 🤿` };
  }
  for (const [re, reply] of ANSWERS) if (re.test(msg)) return { action: 'answer', reply };
  if (!ON_TOPIC.test(msg)) {
    return { action: 'answer', reply: 'That one’s outside this dive, so I’ll leave it to a search engine. 🐙 Ask me anything about chatbots, from intents and fallbacks to grounding, or ask me to walk you through a step and I’ll add a hands-on one.' };
  }
  return {
    action: 'answer',
    reply: `Good question. The short version: rule bots are predictable but only understand what you wrote down; LLM bots understand far more but must be grounded in your facts.${here ? ` Try it in “${clip(here, 60)}” and watch where the two bots differ.` : ''} Ask me to walk you through anything step by step.`,
  };
}

/* ------------------------------------------------ dive-log summary */

function summary(ctx = {}) {
  const steps = (ctx.steps ?? []).map((s) => ({ title: clean(s?.title), type: s?.blockType ?? null }));
  const types = new Set(steps.map((s) => s.type).filter(Boolean));
  const compare = zoneOf(ctx.zone) !== 'sunlight';
  const headline = compare
    ? 'You built a rule bot, raced it against an LLM bot, and saw why grounding matters.'
    : 'You built a working chatbot and taught it new intents with your own hands.';
  const learned = [];
  const gaps = {
    intents: 'You closed your intents gap: many phrasings, one goal behind them.',
    patterns: 'You closed your pattern-matching gap: rule bots count words, they don’t read meaning.',
    fallback: 'You closed your fallback gap: admit the miss, offer options, log it.',
    llm: 'You closed your LLM gap: a model reads meaning, so new phrasings still land.',
    grounding: 'You closed your grounding gap: give the model the facts and tell it to stay inside them.',
    context: 'You closed your context gap: follow-ups only make sense with the earlier turns.',
    hallucination: 'You closed your hallucination gap: an ungrounded model will confidently invent answers.',
    hybrid: 'You closed your escalation gap: rules for exact flows, an LLM for open questions, people when unsure.',
  };
  for (const k of [...new Set((ctx.missed ?? []).map(conceptKey).filter(Boolean))]) if (learned.length < 2 && gaps[k]) learned.push(gaps[k]);
  for (const s of [
    'You know how a rule bot maps a message to an intent by counting trigger words.',
    compare ? 'You saw an LLM bot understand “plant-based” where the rule bot fell back.' : 'You know what a good fallback does when nothing matches.',
    compare ? 'You know how grounding keeps an LLM bot from inventing facts.' : 'You know why a rule bot can only say what you wrote.',
    types.has('sequence') ? 'You can follow a multi-turn conversation that fills slots one at a time.' : null,
  ]) if (s && learned.length < 5 && !learned.includes(s)) learned.push(s);

  const built = [];
  if (types.has('chatbot-builder')) {
    built.push(compare ? 'You chatted with a rule bot and an LLM bot side by side on the same knowledge base.' : 'You chatted with a rule-based bot and watched it fall back on unknown phrasings.');
    built.push('You added a new intent to the bot and tested it straight away.');
  }
  for (const s of steps) {
    if (built.length >= 4) break;
    if (s.type === 'simulator') built.push(`You tuned the “${clip(s.title, 60)}” simulator and watched the curve respond.`);
    else if (s.type === 'sequence' && built.length < 3) built.push(`You stepped through “${clip(s.title, 70)}” stage by stage.`);
    else if (s.type === 'diagram' && built.length < 3) built.push(`You explored “${clip(s.title, 70)}” node by node.`);
  }
  if (built.length < 2) built.push('You answered the check questions and saw why each answer holds.');
  if (built.length < 2) built.push('You read every step and tried each block in turn.');

  const nextSteps = [
    compare ? 'Add three intents for your own business and test both bots with ten real customer questions.' : 'Add three intents of your own and test the bot with ten real customer questions.',
    { sunlight: 'Dive again in the Twilight Zone to race your rule bot against an LLM bot.', twilight: 'Try the Midnight Zone for hybrid designs, escalation and testing.', midnight: 'Write an evaluation set of 50 real questions, including 10 your bot should refuse.' }[zoneOf(ctx.zone)] ?? 'Try the next depth zone to go deeper.',
  ];
  return {
    headline: clip(headline, 120),
    learned: learned.map((s) => clip(s, 140)),
    built: built.slice(0, 4).map((s) => clip(s, 140)),
    nextSteps: nextSteps.map((s) => clip(s, 140)),
  };
}

/* ------------------------------------------------ the ✨ LLM bot (generic chat) */

const STOP = new Set('a an and are at be can could do does for from have how i in is it me my of on or our please that the there this to us we what when where which who will with you your yours any anything something get got just'.split(' '));
const words = (s) => (String(s ?? '').toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) ?? []);
const content = (s) => words(s).filter((w) => w.length > 2 && !STOP.has(w));

/** Meaning groups: user words on the left, the intents they belong to on the right. */
const SYNONYMS = [
  { intent: /greet|hello|welcome|hi\b/, words: ['hi', 'hello', 'hey', 'hiya', 'morning', 'evening', 'afternoon', 'howdy', 'greetings', 'yo'] },
  { intent: /hour|open|time|schedule/, words: ['open', 'opening', 'opens', 'close', 'closing', 'closes', 'hours', 'time', 'late', 'early', 'today', 'tonight', 'tomorrow', 'weekend', 'sunday', 'saturday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'holiday', 'kitchen', 'breakfast', 'dinner'] },
  { intent: /menu|food|dish|eat|special/, words: ['menu', 'food', 'eat', 'dish', 'dishes', 'vegan', 'vegetarian', 'plant', 'plant-based', 'dairy', 'dairy-free', 'gluten', 'gluten-free', 'meat', 'fish', 'seafood', 'dessert', 'cake', 'lunch', 'meal', 'special', 'specials', 'allergy', 'allergies', 'hungry', 'serve', 'options', 'cheesecake', 'noodle', 'noodles', 'bass'] },
  { intent: /book|reserv|table/, words: ['book', 'booking', 'reserve', 'reservation', 'table', 'seat', 'seats', 'party', 'group', 'people', 'tonight'] },
  { intent: /locat|address|where|direct|park|find/, words: ['where', 'address', 'location', 'located', 'directions', 'parking', 'park', 'car', 'pier', 'harbor', 'harbour', 'find', 'near', 'map'] },
  { intent: /refund|return|money|charge/, words: ['refund', 'refunds', 'money', 'back', 'charged', 'charge', 'overcharged', 'return', 'reimburse', 'compensation'] },
];
const PLANT_RE = /\b(vegan|vegetarian|plant[- ]?based|dairy[- ]?free|no meat|meat[- ]?free|veggie)\b/i;
const REFUND_RE = /\b(refund|refunds|money back|overcharged|charged (me )?twice|reimburse)\b/i;

function scoreIntent(item, msg) {
  const msgWords = new Set(words(msg));
  const name = String(item.name ?? '').toLowerCase();
  let score = 0;
  for (const g of SYNONYMS) {
    if (!g.intent.test(name)) continue;
    for (const w of g.words) if (msgWords.has(w)) score += 2;
  }
  const nameWords = content(name.replace(/[-_]/g, ' '));
  for (const w of nameWords) if (msgWords.has(w) || msgWords.has(`${w}s`) || msgWords.has(w.replace(/s$/, ''))) score += 3;
  const replyWords = new Set(content(item.reply));
  for (const w of new Set(content(msg))) if (replyWords.has(w)) score += 1;
  return score;
}

function bestIntent(kb, msg) {
  let best = null;
  let bestScore = 0;
  for (const item of kb) {
    const s = scoreIntent(item, msg);
    if (s > bestScore) { best = item; bestScore = s; }
  }
  return bestScore >= 2 ? best : null;
}

const pretty = (name) => String(name ?? '').replace(/[-_]+/g, ' ').trim();

function offerLine(kb) {
  const names = kb.map((k) => pretty(k.name)).filter((n) => n && !/greet|hello|welcome/i.test(n));
  return names.length ? `I can help with our ${list(names.slice(0, 4))}.` : 'I can help with anything in my knowledge base.';
}

function answerFrom(item, msg) {
  const name = String(item.name ?? '').toLowerCase();
  const reply = clean(item.reply);
  if (/menu|food|dish|eat/.test(name) && PLANT_RE.test(msg)) {
    const dish = reply.match(/([a-z][a-z -]{2,40}?)\s*\((?:vegan|vegetarian|plant[- ]based)\)/i)?.[1]?.replace(/^(and|or)\s+/i, '').trim();
    if (dish) return `Yes! Our ${dish} is vegan, so it’s fully plant-based 🌱 It’s one of today’s highlights.`;
    return `I don’t see a dish marked vegan in what I know, so I won’t promise one. Here’s today’s menu: ${reply}`;
  }
  if (/hour|open|time/.test(name)) {
    const range = reply.match(/(\d{1,2}[:.]\d{2})\s*[–-]\s*(\d{1,2}[:.]\d{2})/);
    const kitchen = reply.match(/kitchen closes at (\d{1,2}[:.]\d{2})/i)?.[1];
    const day = msg.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|today|tonight|tomorrow)\b/i)?.[1];
    if (range && day && /every day|daily|7 days/i.test(reply)) {
      return `Yes, we’re open ${/weekend/i.test(day) ? 'at the weekend' : /today|tonight|tomorrow/i.test(day) ? day.toLowerCase() : `on ${cap(day.toLowerCase())}`}: ${range[1]}–${range[2]}, like every day.${kitchen ? ` The kitchen closes at ${kitchen}.` : ''}`;
    }
    if (range && /\b(close|closing|closes|late)\b/i.test(msg)) {
      return `We close at ${range[2]}${kitchen ? `, and the kitchen takes its last orders at ${kitchen}` : ''}.`;
    }
    if (range && /\b(open|opening|opens|early)\b/i.test(msg)) {
      return `We open at ${range[1]} and stay open until ${range[2]}.${kitchen ? ` The kitchen closes at ${kitchen}.` : ''}`;
    }
    return reply;
  }
  if (/locat|address|where|direct/.test(name) && /\b(park|parking|car)\b/i.test(msg)) {
    const parking = reply.split(/(?<=\.)\s+/).find((s) => /park/i.test(s));
    if (parking) return `${parking.replace(/\.$/, '')}. ${reply.split(/(?<=\.)\s+/).find((s) => !/park/i.test(s)) ?? ''}`.trim();
  }
  return reply;
}

function chat(ctx = {}) {
  const kb = (Array.isArray(ctx.kb) ? ctx.kb : []).filter((k) => k && k.name && k.reply);
  const msg = clean(ctx.lastUserMessage);
  if (!msg) return 'Sorry, I didn’t catch that. What would you like to know?';
  if (!kb.length) return clip(`I’m not sure about that one. I don’t have any facts to go on yet, so I won’t guess. Add some knowledge and ask me again.`, 300);

  let hit = bestIntent(kb, msg);
  // a follow-up ("and the cake?") stays on the previous question's topic, but
  // only when the new message still points at that same intent
  if (!hit && /^(and|what about|how about|also|ok and)\b/i.test(msg)) {
    const prev = [...(ctx.history ?? [])].reverse().filter((m) => m?.role === 'user').map((m) => clean(m.content)).find((t) => t && t !== msg);
    const prevHit = prev ? bestIntent(kb, prev) : null;
    if (prevHit && scoreIntent(prevHit, msg) >= 1) hit = prevHit;
  }
  if (hit && REFUND_RE.test(msg) && !/refund|return|money|charge/i.test(hit.name)) hit = null;

  if (hit) {
    const name = String(hit.name).toLowerCase();
    if (/greet|hello|welcome/.test(name)) return clean(hit.reply);
    return answerFrom(hit, msg);
  }
  if (REFUND_RE.test(msg)) {
    return `I’m not sure about refunds, I’m afraid: that isn’t in what I know about Reef Café, and I don’t want to guess. ${offerLine(kb)} For a refund, the team can help you directly.`;
  }
  return `Hmm, I’m not sure about that one: it isn’t in what I know about Reef Café, so I won’t guess. ${offerLine(kb)}`;
}

export default {
  topicId: 'chatbots',
  knowledgeMap,
  questions,
  lesson,
  expansion,
  tutor,
  summary,
  // agent/flow tasks carry no topic, so the server normally sends them to the
  // ai-agents corpus; delegate lazily in case it routes here
  agentStep: (ctx) => agents.agentStep(ctx),
  flowNode: (ctx) => agents.flowNode(ctx),
  integrationGuide: (ctx) => agents.integrationGuide(ctx),
  chat,
};
