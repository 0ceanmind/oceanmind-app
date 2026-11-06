import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, useToast } from '../components/ui.jsx';
import { api } from '../api.js';
import { demoRandom, useTypewriter } from '../lib/motion.js';
import './agents.css';

const STARTERS = {
  basic: [
    { name: 'greeting', patterns: 'hello, hi, hey, good morning', reply: 'Hi there! I’m the Reef Café bot 🐠 Ask me about hours, menu, or bookings.' },
    { name: 'hours', patterns: 'hours, open, opening, close, closing, when', reply: 'We’re open 8:00–22:00 every day, kitchen closes at 21:30.' },
    { name: 'menu', patterns: 'menu, food, eat, dishes, vegan', reply: 'Today’s highlights: grilled sea bass, kelp noodle bowl (vegan), and coral-berry cheesecake.' },
  ],
  extended: [
    { name: 'greeting', patterns: 'hello, hi, hey, good morning', reply: 'Hi there! I’m the Reef Café bot 🐠 Ask me about hours, menu, or bookings.' },
    { name: 'hours', patterns: 'hours, open, opening, close, closing, when', reply: 'We’re open 8:00–22:00 every day, kitchen closes at 21:30.' },
    { name: 'menu', patterns: 'menu, food, eat, dishes, vegan', reply: 'Today’s highlights: grilled sea bass, kelp noodle bowl (vegan), and coral-berry cheesecake.' },
    { name: 'booking', patterns: 'book, reservation, table, reserve', reply: 'I can hold a table for you! Call 555-REEF or book online at reefcafe.example.' },
    { name: 'location', patterns: 'where, address, location, directions, parking', reply: 'We’re at 12 Harbor Walk, right by the pier. Free parking after 18:00.' },
  ],
};

const FALLBACK = 'Hmm, I’m not sure about that one. Could you rephrase, or ask about hours, menu, or bookings? 🤿';

// The rule bot "types" for 300-600ms before its canned reply lands (seeded per message in demo mode).
const RULE_TYPING_MIN_MS = 300;
const RULE_TYPING_SPAN_MS = 300;
const LEAVE_MS = 320; // .om-ag-leave fold-away
const LLM_CPS = 140; // the LLM bot's reply streams in
/** How long a reply takes to stream (useTypewriter reveals round(cps/30) chars every 33ms). */
const streamMs = (text) => Math.ceil(String(text ?? '').length / Math.round(LLM_CPS / 30)) * 33 + 100;

/** Token-overlap intent matcher. Returns { intent, score, scores[] }; each score lists the patterns it hit. */
function matchIntent(text, intents) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z']+/g) ?? [];
  const scores = intents.map((it) => {
    const pats = it.patterns.toLowerCase().split(',').map((p) => p.trim()).filter(Boolean);
    let score = 0;
    const hits = [];
    for (const p of pats) {
      if (p.includes(' ')) {
        if (lower.includes(p)) { score += 2; hits.push(p); }
      } else if (words.includes(p)) {
        score += 1;
        hits.push(p);
      }
    }
    return { name: it.name, score, hits };
  });
  const best = [...scores].sort((a, b) => b.score - a.score)[0];
  const intent = best && best.score > 0 ? intents.find((i) => i.name === best.name) : null;
  return { intent, score: best?.score ?? 0, scores };
}

/** The trigger list exactly as typed, with the words that matched the last message highlighted. */
function Triggers({ patterns, hits }) {
  return patterns.split(',').map((seg, i) => {
    const lead = seg.match(/^\s*/)[0];
    const word = seg.trim();
    const tail = seg.slice(lead.length + word.length);
    const hit = word && hits?.includes(word.toLowerCase());
    return (
      <span key={i}>{i > 0 ? ',' : ''}{lead}{hit ? <span className="om-ag-hit">{word}</span> : word}{tail}</span>
    );
  });
}

function StreamText({ text, onGrow }) {
  const shown = useTypewriter(text, { cps: LLM_CPS });
  useEffect(() => { onGrow?.(); }, [shown, onGrow]);
  return shown;
}

function ChatWindow({ id, title, messages, onSend, disabled, placeholder, busy }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const follow = useCallback(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);
  useEffect(() => { follow(); }, [messages, follow]);
  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft('');
    onSend(text);
  };
  return (
    <div data-demo={`chat-${id}`} data-busy={String(Boolean(busy))} data-count={messages.filter((m) => !m.typing).length}>
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <b style={{ fontSize: '0.92rem' }}>{title}</b>
      </div>
      <div className="chat-window">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && <p className="muted center" style={{ margin: 'auto' }}>Say hello 👋</p>}
          {messages.map((m, i) => (m.typing ? (
            <div key="typing" className="bubble bot om-ag-typing-bubble" aria-label="Typing">
              <span className="om-typing"><i /><i /><i /></span>
            </div>
          ) : (
            <div key={i} className={`bubble ${m.role}`}>
              {m.stream ? <StreamText text={m.text} onGrow={follow} /> : m.text}
              {m.meta && <span className="meta">{m.meta}</span>}
            </div>
          )))}
        </div>
        <div className="chat-input-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={placeholder ?? 'Type a message…'}
            aria-label={`Message ${title}`}
            disabled={disabled}
            data-demo={`chat-${id}-input`}
          />
          <button className="btn btn--primary" onClick={send} disabled={disabled || !draft.trim()} data-demo={`chat-${id}-send`}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default function ChatbotLesson({ config }) {
  const toast = useToast();
  const [intents, setIntents] = useState(() => (STARTERS[config.starterIntents] ?? STARTERS.basic).map((i) => ({ ...i })));
  const [ruleMsgs, setRuleMsgs] = useState([]);
  const [ruleTyping, setRuleTyping] = useState(0);
  const [llmMsgs, setLlmMsgs] = useState([]);
  const [llmBusy, setLlmBusy] = useState(false); // a request is in flight (typing dots)
  const [llmStreaming, setLlmStreaming] = useState(false); // the newest reply is still typing out
  const [form, setForm] = useState({ name: '', patterns: '', reply: '' });
  const [formError, setFormError] = useState('');
  const [lit, setLit] = useState(null); // last rule-bot decision: { name | null, hits: {intent: [pattern]}, nonce, text }
  const [ghosts, setGhosts] = useState([]); // deleted intents folding away: { intent, index, key }

  const intentsRef = useRef(intents);
  const llmRef = useRef([]); // mirror of llmMsgs, so queued sends always see the full history
  const queueRef = useRef(Promise.resolve());
  const llmPending = useRef(0);
  const nonceRef = useRef(0);
  const streamSeq = useRef(0);
  const ruleDueRef = useRef(0); // when the last queued rule reply lands, so replies never overtake each other
  const timers = useRef(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const pending = timers.current;
    return () => {
      mountedRef.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      if (mountedRef.current) fn();
    }, ms);
    timers.current.add(t);
  };
  const commitIntents = (next) => { intentsRef.current = next; setIntents(next); };
  const pushLlm = (m) => { llmRef.current = [...llmRef.current, m]; setLlmMsgs(llmRef.current); };

  const showMatching = config.showMatching;
  const compare = config.liveCompare;

  const sendRule = (text) => {
    const { intent, score, scores } = matchIntent(text, intentsRef.current);
    const reply = intent ? intent.reply : FALLBACK;
    const meta = showMatching
      ? intent
        ? `matched “${intent.name}” (score ${score}) · runners-up: ${scores.filter((s) => s.name !== intent.name && s.score > 0).map((s) => `${s.name}:${s.score}`).join(', ') || 'none'}`
        : 'no intent matched → fallback'
      : null;
    setRuleMsgs((m) => [...m, { role: 'user', text }]);
    setRuleTyping((c) => c + 1);
    const now = performance.now();
    const typing = RULE_TYPING_MIN_MS + Math.round(demoRandom(`chat-rule:${text}`)() * RULE_TYPING_SPAN_MS);
    const due = Math.max(now + typing, ruleDueRef.current + 150);
    ruleDueRef.current = due;
    later(() => {
      setRuleTyping((c) => Math.max(0, c - 1));
      setRuleMsgs((m) => [...m, { role: 'bot', text: reply, meta }]);
      setLit({
        name: intent?.name ?? null,
        hits: Object.fromEntries(scores.filter((s) => s.hits.length).map((s) => [s.name, s.hits])),
        nonce: ++nonceRef.current,
        text,
      });
    }, due - now);
  };

  // LLM messages go through a queue: a message sent while a reply is pending waits its
  // turn, so every request carries the complete conversation so far.
  const sendLlm = (text) => {
    llmPending.current += 1;
    setLlmBusy(true);
    queueRef.current = queueRef.current.then(async () => {
      if (!mountedRef.current) return;
      pushLlm({ role: 'user', text });
      try {
        const history = llmRef.current.map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }));
        const system =
          `You are the Reef Café assistant — warm, brief (under 60 words). ` +
          `Your knowledge base:\n` +
          intentsRef.current.map((i) => `- ${i.name}: ${i.reply}`).join('\n') +
          `\nIf asked something outside this knowledge, say you're not sure and offer what you do know. Never invent facts about the café.`;
        const { text: reply } = await api('/api/ai/chat', { method: 'POST', body: { system, messages: history } });
        if (mountedRef.current) {
          const text = reply || '…';
          pushLlm({ role: 'bot', text, stream: true });
          const seq = ++streamSeq.current;
          setLlmStreaming(true);
          later(() => { if (streamSeq.current === seq) setLlmStreaming(false); }, streamMs(text));
        }
      } catch (e) {
        if (!mountedRef.current) return;
        toast(e.message || 'Live AI unavailable.', 'error');
        pushLlm({ role: 'bot', text: '(The live model is unavailable right now.)' });
      } finally {
        llmPending.current -= 1;
        if (mountedRef.current && llmPending.current === 0) setLlmBusy(false);
      }
    });
  };

  const addIntent = () => {
    const name = form.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !form.patterns.trim() || !form.reply.trim()) {
      setFormError('All three fields are needed: a name, some trigger words, and a reply.');
      return;
    }
    if (intentsRef.current.some((i) => i.name === name)) {
      setFormError(`An intent called “${name}” already exists.`);
      return;
    }
    commitIntents([...intentsRef.current, { name, patterns: form.patterns.trim(), reply: form.reply.trim(), added: true }]);
    setForm({ name: '', patterns: '', reply: '' });
    setFormError('');
    toast(`Intent “${name}” added — try triggering it!`, 'success');
  };

  const removeIntent = (name) => {
    const list = intentsRef.current;
    const index = list.findIndex((i) => i.name === name);
    if (index < 0) return;
    const key = `${name}:${++nonceRef.current}`;
    setGhosts((g) => [...g, { intent: list[index], index, key }]);
    commitIntents(list.filter((i) => i.name !== name));
    setLit((l) => (l?.name === name ? null : l));
    later(() => setGhosts((g) => g.filter((x) => x.key !== key)), LEAVE_MS);
    toast(`Intent “${name}” removed.`);
  };

  // live cards, with any just-deleted ones still folding away where they were
  const cards = intents.map((it, i) => ({ it, i, key: it.name, ghost: false }));
  for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
    cards.splice(Math.min(g.index, cards.length), 0, { it: g.intent, i: g.index, key: g.key, ghost: true });
  }

  return (
    <div className="lesson-grid" data-llm-busy={String(llmBusy || llmStreaming)} data-rule-typing={String(ruleTyping > 0)}
      data-last-match={lit ? lit.name ?? 'fallback' : ''} data-intents={intents.length}>
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Your bot’s brain</h3>
        <p className="muted" style={{ marginBottom: '0.9rem' }}>
          Each intent = trigger words → a reply. The matcher picks the intent with the most word overlap.
        </p>
        {cards.map(({ it, i, key, ghost }) => {
          if (ghost) {
            return (
              <div key={key} className="intent-card om-ag-leave" aria-hidden="true">
                <div className="intent-head"><b>{it.name}</b></div>
                <div className="patterns">triggers: {it.patterns}</div>
                <div className="reply">→ {it.reply}</div>
              </div>
            );
          }
          const isLit = lit?.name === it.name;
          return (
            <div key={key} className={`intent-card om-ag-intent ${it.added ? 'om-ag-new' : ''} ${isLit ? 'om-ag-lit' : ''}`}
              style={{ '--i': i }} data-demo="intent-card" data-intent={it.name} data-lit={String(isLit)}>
              {isLit && <span key={lit.nonce} className="om-ag-lit-pulse" />}
              <div className="intent-head">
                <b>{it.name}</b>
                <button className="icon-btn" onClick={() => removeIntent(it.name)} aria-label={`Delete intent ${it.name}`}
                  data-demo="intent-delete" data-intent={it.name}>✕</button>
              </div>
              <div className="patterns">triggers: <Triggers patterns={it.patterns} hits={showMatching ? lit?.hits[it.name] : null} /></div>
              <div className="reply">→ {it.reply}</div>
            </div>
          );
        })}
        {lit && !lit.name && (
          <p key={lit.nonce} className="om-ag-miss om-swap" data-demo="intent-miss">
            No trigger word matched “{lit.text}”, so the bot fell back to its default reply. Add an intent below to teach it.
          </p>
        )}

        <div className="field mt-2">
          <label>New intent name</label>
          <input className="input" value={form.name} placeholder="e.g. refunds"
            onChange={(e) => setForm({ ...form, name: e.target.value })} data-demo="intent-name" />
        </div>
        <div className="field">
          <label>Trigger words (comma-separated)</label>
          <input className="input" value={form.patterns} placeholder="refund, money back, return"
            onChange={(e) => setForm({ ...form, patterns: e.target.value })} data-demo="intent-triggers" />
        </div>
        <div className="field">
          <label>Bot’s reply</label>
          <textarea className="textarea" value={form.reply} placeholder="Of course! Refunds take 3–5 days…"
            onChange={(e) => setForm({ ...form, reply: e.target.value })} style={{ minHeight: '4.5rem' }} data-demo="intent-reply" />
        </div>
        {formError && <p className="form-error" data-demo="intent-error">{formError}</p>}
        <button className="btn" onClick={addIntent} data-demo="intent-add">+ Add intent</button>
      </Card>

      <div style={{ display: 'grid', gap: '1.1rem' }}>
        <Card>
          <ChatWindow
            id="rule"
            title={compare ? '🤖 Rule-based bot (yours)' : '🤖 Your bot'}
            messages={ruleTyping > 0 ? [...ruleMsgs, { role: 'bot', typing: true }] : ruleMsgs}
            busy={ruleTyping > 0}
            onSend={(t) => {
              sendRule(t);
              if (compare) sendLlm(t);
            }}
            placeholder={compare ? 'One message goes to both bots…' : 'Ask about hours, menu…'}
          />
        </Card>
        {compare && (
          <Card>
            <ChatWindow
              id="llm"
              title="✨ LLM bot (same knowledge, live model)"
              messages={llmBusy ? [...llmMsgs, { role: 'bot', typing: true }] : llmMsgs}
              busy={llmBusy || llmStreaming}
              onSend={sendLlm}
              disabled={llmBusy}
              placeholder="Or talk to the LLM bot alone…"
            />
          </Card>
        )}
      </div>
    </div>
  );
}
