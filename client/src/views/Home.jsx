import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Reveal, Icon, Spinner, Stages, usePacedStages, demoReplyMs, useToast } from '../components/ui.jsx';
import { isDemo, prefersReducedMotion, sleep } from '../lib/motion.js';

// What the agent does between "Dive in" and the knowledge map.
const STAGES = ['Understanding your goal', 'Reading the source material', 'Compiling your knowledge map', 'Writing your placement questions'];
// Examples typed into the empty ask box, one after another.
const EXAMPLES = [
  'I want to understand how neural networks learn',
  'I want to build an AI agent that answers support emails',
  'How do chatbots understand what I mean?',
];
const exampleText = (s) => `e.g. “${s}”`;

/** Types the example goals into the placeholder while the box is empty. */
function useTypingPlaceholder(lines, enabled) {
  const [text, setText] = useState(exampleText(lines[0]));
  useEffect(() => {
    setText(exampleText(lines[0]));
    if (!enabled || prefersReducedMotion()) return undefined;
    let line = 0;
    let n = lines[0].length;
    let phase = 'erase';
    let timer;
    const tick = () => {
      const full = lines[line];
      if (phase === 'type') {
        n += 1;
        if (n >= full.length) {
          setText(exampleText(full));
          phase = 'erase';
          timer = setTimeout(tick, 2200); // hold the finished example
          return;
        }
        setText(`e.g. “${full.slice(0, n)}`);
        timer = setTimeout(tick, 42);
      } else {
        n -= 2;
        if (n <= 0) {
          line = (line + 1) % lines.length;
          n = 0;
          phase = 'type';
          setText('e.g. “');
          timer = setTimeout(tick, 320);
          return;
        }
        setText(`e.g. “${full.slice(0, n)}`);
        timer = setTimeout(tick, 16);
      }
    };
    timer = setTimeout(tick, 2600); // the static first example reads first
    return () => clearTimeout(timer);
  }, [lines, enabled]);
  return text;
}

export default function Home({ user, navigate, aiConfigured }) {
  const toast = useToast();
  const [topics, setTopics] = useState(null);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [noMatch, setNoMatch] = useState(false);
  // matching → compiling → done (then the page hands off to the session)
  const [phase, setPhase] = useState('idle');
  const [leaving, setLeaving] = useState(false);

  const placeholder = useTypingPlaceholder(EXAMPLES, !ask && !busy);
  // Paced to the request: in the demo every stage gets its moment and the last
  // one is reached as the replayed map + questions land; real models tick on
  // the 1.5 s / 7 s cadence and park on the last stage.
  const stages = usePacedStages(STAGES.length, { stepMs: [1500, 7000] });
  const stageAt = stages.at;

  useEffect(() => {
    api('/api/topics')
      .then((d) => setTopics(d.topics))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  // goal = the learner's own words when the dive started from typed text
  const start = async (topicId, title, goal = '') => {
    setBusy(true);
    setPhase('compiling');
    setBusyLabel(`The agent is compiling your ${title} experience…`);
    const expectMs = demoReplyMs('knowledge_map', 'questions');
    // typed dive in the demo: "Understanding your goal" keeps its moment and the
    // rest spread over this request; a pill (or a real model) starts at stage 1
    if (goal && isDemo()) stages.retime(expectMs);
    else stages.start({ startAt: 1, expectMs });
    try {
      const body = goal ? { topicId, goal: goal.slice(0, 300) } : { topicId };
      const { session } = await api('/api/sessions', { method: 'POST', body });
      await stages.finish(); // any stage the reply overtook still shows, then all tick ✓
      // the page glides out, then the map opens
      setPhase('done');
      setBusyLabel(`Your ${title} dive is ready — diving in…`);
      await sleep(300);
      setLeaving(true);
      await sleep(340);
      navigate(`/session/${session.id}`);
    } catch (e) {
      toast(e.message, 'error');
      stages.reset();
      setBusy(false);
      setBusyLabel('');
      setPhase('idle');
    }
  };

  const submitAsk = async (e) => {
    e.preventDefault();
    if (!ask.trim() || busy) return;
    setNoMatch(false);
    setBusy(true);
    setPhase('matching');
    setBusyLabel('Understanding what you want to learn…');
    // stage 0 while the goal is matched; a real model's match can take a while, so it parks there
    stages.start({ startAt: 0, expectMs: demoReplyMs('knowledge_map', 'questions'), park: !isDemo() });
    try {
      const { match } = await api('/api/topics/match', { method: 'POST', body: { text: ask } });
      if (match) {
        toast(`That maps to “${match.title}” — compiling your experience.`, 'success');
        await start(match.id, match.title, ask.trim());
        return;
      }
      setNoMatch(true);
    } catch (err) {
      toast(err.message, 'error');
    }
    stages.reset();
    setBusy(false);
    setBusyLabel('');
    setPhase('idle');
  };

  return (
    <div className={`page page--narrow${leaving ? ' om-v-leave' : ''}`}>
      <Reveal>
        <span className="eyebrow"><Icon.wave size={13} /> Welcome back, {user.name}</span>
        <h1 className="hero-title">What do you want<br />to <em>learn about AI?</em></h1>
        <p className="lede">
          Tell the agent in your own words. It reads the source material, maps the
          knowledge, measures your depth, and builds a lesson that exists only for you.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <form className="ask-row" onSubmit={submitAsk}>
          <input
            className="ask-input"
            value={ask}
            onChange={(e) => { setAsk(e.target.value); setNoMatch(false); }}
            placeholder={placeholder}
            maxLength={300}
            disabled={busy}
            aria-label="What do you want to learn about AI?"
            autoFocus
            data-demo="ask-input"
          />
          <button className="btn btn--primary" type="submit" disabled={busy || !ask.trim()} data-demo="ask-submit">
            {busy ? <Spinner /> : 'Dive in'}
            {!busy && <span className="btn-orb">→</span>}
          </button>
        </form>

        {/* suggested topics — plain suggestions under the input, not cards */}
        {topics && (
          <div className={`suggest-row om-stagger${busy ? ' om-v-gone' : ''}`} aria-label="Suggested topics" aria-hidden={busy || undefined}>
            <span className="suggest-label" style={{ '--i': 0 }}>Suggested:</span>
            {topics.map((t, ti) => (
              <button key={t.id} className="suggest-pill" style={{ '--i': ti + 1 }} onClick={() => start(t.id, t.title)} title={t.tagline}
                disabled={busy} data-demo="suggest-pill" data-topic={t.id}>
                {t.title}
              </button>
            ))}
          </div>
        )}

        {noMatch && (
          <p className="form-error" role="alert" style={{ marginTop: '0.8rem' }}>
            The agent couldn’t map that to one of today’s dives — this MVP currently covers the
            suggested topics above. Try one of them, or different words.
          </p>
        )}

        {busy && (
          <div className="compiling om-v-compiling" role="status" data-demo="compiling"
            data-phase={phase} data-stage-index={Math.min(stageAt, STAGES.length)} data-done={phase === 'done'}>
            <span className="om-v-glyph"><Icon.agent size={22} /></span>
            <div>
              <b key={busyLabel} className="om-swap">{busyLabel}</b>
              <Stages items={STAGES} current={stageAt} />
            </div>
          </div>
        )}

        {!aiConfigured && (
          <p className="form-error" style={{ marginTop: '1rem' }}>
            No AI model is connected yet, so dives can’t start. <button className="linklike" onClick={() => navigate('/admin')}>Connect one in Admin →</button>
          </p>
        )}
      </Reveal>
    </div>
  );
}
