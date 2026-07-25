import { useEffect, useRef, useState } from 'react';
import { Card, useToast } from '../components/ui.jsx';
import { api } from '../api.js';

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

/** Token-overlap intent matcher. Returns { intent, score, scores[] }. */
function matchIntent(text, intents) {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const scores = intents.map((it) => {
    const pats = it.patterns.toLowerCase().split(',').map((p) => p.trim()).filter(Boolean);
    let score = 0;
    for (const p of pats) {
      if (p.includes(' ')) {
        if (text.toLowerCase().includes(p)) score += 2;
      } else if (words.includes(p)) {
        score += 1;
      }
    }
    return { name: it.name, score };
  });
  const best = [...scores].sort((a, b) => b.score - a.score)[0];
  const intent = best && best.score > 0 ? intents.find((i) => i.name === best.name) : null;
  return { intent, score: best?.score ?? 0, scores };
}

function ChatWindow({ title, messages, onSend, disabled, placeholder }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft('');
    onSend(text);
  };
  return (
    <div>
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <b style={{ fontSize: '0.92rem' }}>{title}</b>
      </div>
      <div className="chat-window">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && <p className="muted center" style={{ margin: 'auto' }}>Say hello 👋</p>}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.text}
              {m.meta && <span className="meta">{m.meta}</span>}
            </div>
          ))}
        </div>
        <div className="chat-input-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={placeholder ?? 'Type a message…'}
            aria-label={`Message ${title}`}
            disabled={disabled}
          />
          <button className="btn btn--primary" onClick={send} disabled={disabled || !draft.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default function ChatbotLesson({ config }) {
  const toast = useToast();
  const [intents, setIntents] = useState(STARTERS[config.starterIntents] ?? STARTERS.basic);
  const [ruleMsgs, setRuleMsgs] = useState([]);
  const [llmMsgs, setLlmMsgs] = useState([]);
  const [llmBusy, setLlmBusy] = useState(false);
  const [form, setForm] = useState({ name: '', patterns: '', reply: '' });
  const [formError, setFormError] = useState('');

  const showMatching = config.showMatching;
  const compare = config.liveCompare;

  const sendRule = (text) => {
    const { intent, score, scores } = matchIntent(text, intents);
    const reply = intent ? intent.reply : FALLBACK;
    const meta = showMatching
      ? intent
        ? `matched “${intent.name}” (score ${score}) · runners-up: ${scores.filter((s) => s.name !== intent.name && s.score > 0).map((s) => `${s.name}:${s.score}`).join(', ') || 'none'}`
        : 'no intent matched → fallback'
      : null;
    setRuleMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', text: reply, meta }]);
  };

  const sendLlm = async (text) => {
    setLlmMsgs((m) => [...m, { role: 'user', text }]);
    setLlmBusy(true);
    try {
      const history = [...llmMsgs, { role: 'user', text }].map((m) => ({
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: m.text,
      }));
      const system =
        `You are the Reef Café assistant — warm, brief (under 60 words). ` +
        `Your knowledge base:\n` +
        intents.map((i) => `- ${i.name}: ${i.reply}`).join('\n') +
        `\nIf asked something outside this knowledge, say you're not sure and offer what you do know. Never invent facts about the café.`;
      const { text: reply } = await api('/api/ai/chat', { method: 'POST', body: { system, messages: history } });
      setLlmMsgs((m) => [...m, { role: 'bot', text: reply || '…' }]);
    } catch (e) {
      toast(e.message || 'Live AI unavailable.', 'error');
      setLlmMsgs((m) => [...m, { role: 'bot', text: '(The live model is unavailable right now.)' }]);
    } finally {
      setLlmBusy(false);
    }
  };

  const addIntent = () => {
    const name = form.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !form.patterns.trim() || !form.reply.trim()) {
      setFormError('All three fields are needed: a name, some trigger words, and a reply.');
      return;
    }
    if (intents.some((i) => i.name === name)) {
      setFormError(`An intent called “${name}” already exists.`);
      return;
    }
    setIntents((list) => [...list, { name, patterns: form.patterns.trim(), reply: form.reply.trim() }]);
    setForm({ name: '', patterns: '', reply: '' });
    setFormError('');
    toast(`Intent “${name}” added — try triggering it!`, 'success');
  };

  const removeIntent = (name) => {
    setIntents((list) => list.filter((i) => i.name !== name));
    toast(`Intent “${name}” removed.`);
  };

  return (
    <div className="lesson-grid">
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Your bot’s brain</h3>
        <p className="muted" style={{ marginBottom: '0.9rem' }}>
          Each intent = trigger words → a reply. The matcher picks the intent with the most word overlap.
        </p>
        {intents.map((it) => (
          <div key={it.name} className="intent-card">
            <div className="intent-head">
              <b>{it.name}</b>
              <button className="icon-btn" onClick={() => removeIntent(it.name)} aria-label={`Delete intent ${it.name}`}>✕</button>
            </div>
            <div className="patterns">triggers: {it.patterns}</div>
            <div className="reply">→ {it.reply}</div>
          </div>
        ))}

        <div className="field mt-2">
          <label>New intent name</label>
          <input className="input" value={form.name} placeholder="e.g. refunds"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Trigger words (comma-separated)</label>
          <input className="input" value={form.patterns} placeholder="refund, money back, return"
            onChange={(e) => setForm({ ...form, patterns: e.target.value })} />
        </div>
        <div className="field">
          <label>Bot’s reply</label>
          <textarea className="textarea" value={form.reply} placeholder="Of course! Refunds take 3–5 days…"
            onChange={(e) => setForm({ ...form, reply: e.target.value })} style={{ minHeight: '4.5rem' }} />
        </div>
        {formError && <p className="form-error">{formError}</p>}
        <button className="btn" onClick={addIntent}>+ Add intent</button>
      </Card>

      <div style={{ display: 'grid', gap: '1.1rem' }}>
        <Card>
          <ChatWindow
            title={compare ? '🤖 Rule-based bot (yours)' : '🤖 Your bot'}
            messages={ruleMsgs}
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
              title="✨ LLM bot (same knowledge, live model)"
              messages={llmBusy ? [...llmMsgs, { role: 'bot', text: '…thinking' }] : llmMsgs}
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
