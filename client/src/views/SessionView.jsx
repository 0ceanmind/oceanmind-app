import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Card, Reveal, Spinner, EmptyState, DepthGauge, FaceRating, Md, Accordion, useToast } from '../components/ui.jsx';
import BlockRenderer from '../lessons/BlockRenderer.jsx';
import DiveJourney from '../components/DiveJourney.jsx';

const REASONS = ['Too easy', 'Too hard', 'Repetitive', 'Wrong topic', 'Wasn’t helpful'];

export default function SessionView({ sessionId, navigate }) {
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  // stage: map → quiz → reveal → lesson → feedback → happy | sad-sent
  const [stage, setStage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setStage(null);
    api(`/api/sessions/${sessionId}`)
      .then(({ session: s }) => {
        if (cancelled) return;
        setSession(s);
        if (s.status === 'assessment') setStage(s.answered?.length > 0 ? 'quiz' : 'map');
        else if (s.status === 'lesson') setStage(s.rebuiltFrom ? 'reveal' : 'lesson');
        else setStage(s.status); // closed | awaiting_rebuild
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (session?.zone && ['reveal', 'lesson', 'feedback'].includes(stage)) {
      document.body.dataset.zone = session.zone;
    }
    return () => { delete document.body.dataset.zone; };
  }, [session?.zone, stage]);

  if (error) {
    return (
      <div className="page page--narrow">
        <EmptyState emoji="🫧">{error}<br />
          <button className="btn btn--ghost mt-2" onClick={() => navigate('/')}>← Back</button>
        </EmptyState>
      </div>
    );
  }
  if (!session || !stage) return <div className="page center"><Spinner /></div>;

  const props = { session, setSession, setStage, navigate, toast };
  if (stage === 'map') return <KnowledgeMapStage {...props} />;
  if (stage === 'quiz') return <QuizStage {...props} />;
  if (stage === 'reveal') return <RevealStage {...props} />;
  if (stage === 'lesson') return <LessonStage {...props} />;
  if (stage === 'summary') return <SummaryStage {...props} />;
  if (stage === 'feedback') return <FeedbackStage {...props} />;
  if (stage === 'happy') return <HappyStage {...props} />;
  if (stage === 'sad-sent' || stage === 'awaiting_rebuild') return <AwaitingStage {...props} />;
  if (stage === 'closed') return <ClosedStage {...props} />;
  return null;
}

/* ------------------------------------------------ knowledge map (generated) */

/** Concept title box — click to reveal the details. */
function ConceptBox({ concept }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={`concept concept--toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
      <b>{concept.name} <span className="chev">▶</span></b>
      {open && <span>{concept.desc}</span>}
    </button>
  );
}

function KnowledgeMapStage({ session, setStage }) {
  const km = session.knowledgeMap;
  return (
    <div className="page">
      <Reveal>
        <span className="eyebrow">Step 1 · The agent compiled your knowledge map</span>
        <h1 className="hero-title">{session.topicTitle}</h1>
        <p className="lede">
          The agent read the source material and mapped this topic for you — what you
          <b> must know</b> to understand it, and what will <b>deepen</b> it. Next, a short
          depth check finds where you are. You’ll see the right answer after every question.
        </p>
      </Reveal>
      <Reveal delay={140}>
        <div className="map-grid">
          <Card className="map-col">
            <h3><span className="chip chip--must">Must know</span></h3>
            {km.mustKnow.map((c) => <ConceptBox key={c.name} concept={c} />)}
          </Card>
          <Card className="map-col">
            <h3><span className="chip chip--need">Need to know</span></h3>
            {km.needToKnow.map((c) => <ConceptBox key={c.name} concept={c} />)}
          </Card>
        </div>
      </Reveal>
      <Reveal delay={260}>
        <div className="center mt-3">
          <button className="btn btn--primary" onClick={() => setStage('quiz')}>
            Measure my depth — {session.questions.length} questions
            <span className="btn-orb">→</span>
          </button>
        </div>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------ quiz with immediate feedback */

function QuizStage({ session, setSession, setStage, toast }) {
  const questions = session.questions;
  const answeredMap = useMemo(() => {
    const m = new Map();
    for (const a of session.answered ?? []) m.set(a.questionId, a);
    return m;
  }, [session.answered]);

  const firstUnanswered = questions.findIndex((q) => !answeredMap.has(q.id));
  const [i, setI] = useState(firstUnanswered === -1 ? questions.length - 1 : firstUnanswered);
  const [busyChoice, setBusyChoice] = useState(null);
  const [summary, setSummary] = useState(null);

  const q = questions[i];
  const result = answeredMap.get(q.id) ?? null; // {choice, correct, correctIndex, explanation}

  const answer = async (choice) => {
    if (result || busyChoice !== null) return;
    setBusyChoice(choice);
    try {
      const r = await api(`/api/sessions/${session.id}/answer`, {
        method: 'POST',
        body: { questionId: q.id, choice },
      });
      setSession((s) => ({
        ...s,
        answered: [...(s.answered ?? []), { questionId: q.id, choice, correct: r.correct, correctIndex: r.correctIndex, explanation: r.explanation }],
      }));
      if (r.done) setSummary(r.summary);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyChoice(null);
    }
  };

  const allAnswered = (session.answered?.length ?? 0) === questions.length;

  const finish = () => {
    setSession((s) => ({ ...s, ...(summary ?? {}), score: summary?.scorePct ?? s.score, zone: summary?.zone ?? s.zone, depth: summary?.depth ?? s.depth }));
    setStage('reveal');
  };

  const optClass = (idx) => {
    if (!result) return busyChoice === idx ? 'option selected' : 'option';
    let cls = 'option locked';
    if (idx === result.correctIndex) cls += ' reveal-correct';
    else if (idx === result.choice) cls += ' reveal-wrong';
    return cls;
  };

  return (
    <div className="page page--narrow">
      <span className="eyebrow">Step 2 · Depth check · {session.topicTitle}</span>
      <div className="progress-track" aria-label={`Question ${i + 1} of ${questions.length}`}>
        <div className="progress-fill" style={{ transform: `scaleX(${(session.answered?.length ?? 0) / questions.length})` }} />
      </div>
      <Reveal key={q.id}>
        <Card>
          <p className="q-concept">Concept: {q.concept} · {i + 1} / {questions.length}</p>
          <h2 className="q-text">{q.text}</h2>
          {q.options.map((opt, idx) => (
            <button key={idx} className={optClass(idx)} onClick={() => answer(idx)} disabled={busyChoice !== null && !result}>
              <span className="key">
                {result && idx === result.correctIndex ? '✓' : result && idx === result.choice && !result.correct ? '✗' : 'ABCD'[idx]}
              </span>
              {busyChoice === idx && !result ? <Spinner /> : opt}
            </button>
          ))}
          {!result && (
            <button className={`option option--noidea ${busyChoice === -1 ? 'selected' : ''}`} onClick={() => answer(-1)} disabled={busyChoice !== null}>
              <span className="key">?</span> I don’t have any idea — and that’s completely fine
            </button>
          )}

          {result && (
            <div className={`answer-explain ${result.correct ? 'good' : 'bad'}`} role="status">
              <b>{result.correct ? '✓ Correct!' : result.choice === -1 ? 'No worries — here’s the answer:' : '✗ Not quite.'}</b>{' '}
              {!result.correct && <>The right answer is <b>{q.options[result.correctIndex]}</b>. </>}
              {result.explanation}
            </div>
          )}

          <div className="row-between mt-2">
            <button className="btn btn--ghost" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>← Back</button>
            {allAnswered && i === questions.length - 1 ? (
              <button className="btn btn--primary" onClick={finish}>
                Reveal my depth <span className="btn-orb">→</span>
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => setI(Math.min(questions.length - 1, i + 1))} disabled={!result}>
                Next <span className="btn-orb">→</span>
              </button>
            )}
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------ depth reveal → build lesson */

function RevealStage({ session, setSession, setStage, toast }) {
  const zone = session.zones[session.zone];
  const rebuilt = Boolean(session.rebuiltFrom);
  const [building, setBuilding] = useState(false);

  const enterLesson = async () => {
    if (session.lesson) {
      setStage('lesson');
      return;
    }
    setBuilding(true);
    try {
      const { session: s } = await api(`/api/sessions/${session.id}/build-lesson`, { method: 'POST' });
      setSession(s);
      setStage('lesson');
    } catch (e) {
      toast(e.message, 'error');
      setBuilding(false);
    }
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">{rebuilt ? 'Rebuilt just for you' : 'Step 3 · Your depth'}</span>
        <h1 className="hero-title">{rebuilt ? 'A new dive awaits.' : 'Taking you down…'}</h1>
        {rebuilt && (
          <p className="lede">
            Our support team reviewed your feedback and the agent rebuilt this {session.topicTitle} experience from scratch.
            {session.supportNote ? <> Their note: <em>“{session.supportNote}”</em></> : null}
          </p>
        )}
      </Reveal>
      <Reveal delay={120}>
        <Card>
          <div className="gauge-wrap">
            <DepthGauge depth={session.depth} zoneLabel={zone.label} />
            <div className="depth-readout" style={{ alignSelf: 'center' }}>
              <div className="depth-num">{session.depth.toLocaleString()} <small>meters</small></div>
              <div className="zone-pill">🤿 {zone.label} · {zone.range} · {zone.levelLabel}</div>
              <p className="lede mt-2" style={{ fontSize: '0.98rem' }}>
                {session.zone === 'sunlight' && 'Plenty of light up here — the agent will build your lesson from first principles, repairing exactly what the quiz surfaced.'}
                {session.zone === 'twilight' && 'You know the surface — the agent will build your lesson around the mechanics, focused on what you missed.'}
                {session.zone === 'midnight' && 'Deep water. The agent will skip the basics and build your lesson around the hard parts.'}
              </p>
              <button className="btn btn--primary mt-3" onClick={enterLesson} disabled={building}>
                {building ? <Spinner /> : session.lesson ? 'Enter the lesson' : 'Build my lesson'}
                {!building && <span className="btn-orb">→</span>}
              </button>
              {building && (
                <p className="muted mt-1">The agent is writing your personalized walkthrough from the source material — usually 10–30 seconds.</p>
              )}
            </div>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------ the generated walkthrough */

function LessonStage({ session, setSession, setStage, toast }) {
  const zone = session.zones[session.zone];
  const lesson = session.lesson;
  const steps = Array.isArray(lesson?.steps) && lesson.steps.length ? lesson.steps : [{ title: 'Loading…', body: '' }];
  const [rawI, setI] = useState(0);
  const [checkPicks, setCheckPicks] = useState({}); // step key → chosen idx
  // clamp the index into range — the lesson can shrink when Lulu reshapes it,
  // and reading steps[out-of-range] would crash / freeze the page.
  const i = Math.max(0, Math.min(rawI, steps.length - 1));
  const step = steps[i];
  const atEnd = i === steps.length - 1;
  const checkKey = `${i}:${step.title}`;
  const goTo = (idx) => setI(Math.max(0, Math.min(idx, steps.length - 1)));

  const pick = (idx) => {
    if (checkPicks[checkKey] !== undefined) return;
    setCheckPicks((m) => ({ ...m, [checkKey]: idx }));
  };
  const isCheck = step.block?.type === 'check';
  const checkQ = isCheck ? step.block.question : null;
  const picked = checkPicks[checkKey];
  const checkAnswered = !isCheck || picked !== undefined;

  // The guide (tutor agent) can mutate the lesson live.
  const onLessonUpdated = (newSession, updated, addedCount) => {
    if (updated === 'redesigned') {
      setI(0);
      setCheckPicks({});
      setSession(newSession);
      toast('🌊 Lulu rebuilt your experience around your goal — starting the new dive.', 'success');
    } else if (updated === 'expanded') {
      setCheckPicks({});
      setSession(newSession);
      // jump to the first newly-inserted step (right after the current one)
      setI(i + 1);
      toast(`🤿 Lulu added ${addedCount} new step${addedCount > 1 ? 's' : ''} — here they are.`, 'success');
    } else {
      setSession(newSession);
    }
  };

  return (
    <div className="page">
      <Reveal>
        <div className="lesson-head">
          <div>
            <span className="eyebrow">🤿 {zone.label} · {session.depth.toLocaleString()} m · {session.topicTitle}{session.version > 1 ? ` · rebuilt v${session.version}` : ''}</span>
            <h1 className="hero-title" style={{ fontSize: 'clamp(1.8rem,4vw,2.5rem)' }}>{lesson.title}</h1>
            <p className="lede">{lesson.intro}</p>
          </div>
          <span className="badge badge--live" title="This lesson was generated for you by the connected model">✦ Built for you</span>
        </div>
      </Reveal>

      <DiveJourney steps={steps} current={i} onJump={goTo} />

      <div className="walk-progress" aria-label={`Step ${i + 1} of ${steps.length}`}>
        {steps.map((_, si) => (
          <span key={si} className={si < i ? 'done' : si === i ? 'now' : ''} />
        ))}
      </div>

      <Reveal key={`${i}-${steps.length}-${step.title}`}>
        <Card>
          <div className="step-kind">
            {isCheck ? `Step ${i + 1} · Check yourself` : step.block ? `Step ${i + 1} · Interact` : `Step ${i + 1} · Learn`}
          </div>
          <h2 className="walk-title">{step.title}</h2>
          <Md text={step.body} />

          {isCheck ? (
            <div className="mt-2">
              <h3 style={{ fontSize: '1.02rem', marginBottom: '0.8rem', color: '#fff' }}>{checkQ.text}</h3>
              {checkQ.options.map((opt, idx) => {
                let cls = 'option';
                if (picked !== undefined) {
                  cls += ' locked';
                  if (idx === checkQ.correctIndex) cls += ' reveal-correct';
                  else if (idx === picked) cls += ' reveal-wrong';
                }
                return (
                  <button key={idx} className={cls} onClick={() => pick(idx)}>
                    <span className="key">
                      {picked !== undefined && idx === checkQ.correctIndex ? '✓'
                        : picked !== undefined && idx === picked ? '✗' : 'ABCD'[idx]}
                    </span>
                    {opt}
                  </button>
                );
              })}
              {picked !== undefined && (
                <div className={`answer-explain ${picked === checkQ.correctIndex ? 'good' : 'bad'}`}>
                  <b>{picked === checkQ.correctIndex ? '✓ Exactly.' : '✗ Not quite.'}</b> {checkQ.explanation}
                </div>
              )}
            </div>
          ) : (
            <BlockRenderer block={step.block} session={session} />
          )}

          <div className="row-between mt-3">
            <button className="btn btn--ghost" onClick={() => goTo(i - 1)} disabled={i === 0}>← Previous step</button>
            {atEnd ? (
              <button className="btn btn--primary" onClick={() => setStage('summary')}>
                Surface — open your dive log <span className="btn-orb">🧭</span>
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => goTo(i + 1)} disabled={!checkAnswered}
                title={checkAnswered ? '' : 'Answer the check question first'}>
                Next step <span className="btn-orb">→</span>
              </button>
            )}
          </div>
        </Card>
      </Reveal>

      <Tutor sessionId={session.id} stepIndex={i} onLessonUpdated={onLessonUpdated} />
    </div>
  );
}

/* ------------------------------------------------ dive log (summary) */

function SummaryStage({ session, setSession, setStage, toast }) {
  const [summary, setSummary] = useState(session.summary ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const zone = session.zones[session.zone];

  const logMarkdown = () => {
    if (!summary) return '';
    const line = (arr) => arr.map((x) => `- ${x}`).join('\n');
    return `# OceanMind Dive Log — ${session.topicTitle}\n\n` +
      `**${summary.headline}**\n\n` +
      `${zone.label} · ${session.depth.toLocaleString()} m · placement ${session.score}%\n\n` +
      `## 🌊 What you learned\n${line(summary.learned)}\n\n` +
      `## 🔧 What you built\n${line(summary.built)}\n\n` +
      `## 🧭 Where to dive next\n${line(summary.nextSteps)}\n\n` +
      `_Generated by OceanMind on ${new Date().toLocaleDateString()}_\n`;
  };

  const downloadLog = () => {
    const blob = new Blob([logMarkdown()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dive-log-${session.topicId}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Dive log downloaded 📥', 'success');
  };

  const saveLog = async () => {
    setSaving(true);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: { kind: 'summary', name: `Dive log · ${session.topicTitle}`, topicId: session.topicId, sessionId: session.id, data: summary },
      });
      setSaved(true);
      toast('Dive log saved to your Projects 🗂️', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (summary) return;
    let cancelled = false;
    api(`/api/sessions/${session.id}/summary`, { method: 'POST' })
      .then((r) => {
        if (cancelled) return;
        setSummary(r.summary);
        setSession((s) => ({ ...s, summary: r.summary }));
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="page page--narrow">
        <EmptyState emoji="🫧">{error}
          <br />
          <button className="btn btn--primary mt-2" onClick={() => { setError(''); setSummary(null); setStage('lesson'); }}>← Back to the lesson</button>
          <button className="btn btn--ghost mt-2" onClick={() => setStage('feedback')} style={{ marginLeft: '0.6rem' }}>Skip to feedback →</button>
        </EmptyState>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="page page--narrow center" style={{ paddingTop: '20vh' }}>
        <Spinner />
        <p className="lede mt-2" style={{ margin: '1rem auto 0' }}>Writing your dive log — what you learned, what you built…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <Reveal>
        <div className="center">
          <span className="eyebrow">🪙 Treasure found · your dive log</span>
          <h1 className="hero-title" style={{ fontSize: 'clamp(1.9rem,4.5vw,2.8rem)' }}>{summary.headline}</h1>
          <p className="lede" style={{ margin: '0 auto' }}>
            {session.topicTitle} · {zone.label} · {session.depth.toLocaleString()} m
          </p>
        </div>
      </Reveal>
      <Reveal delay={140}>
        <div className="log-cols">
          <div className="log-col learned">
            <h4>🌊 What you learned</h4>
            <ul>{summary.learned.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="log-col built">
            <h4>🔧 What you built</h4>
            <ul>{summary.built.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="log-col next">
            <h4>🧭 Where to dive next</h4>
            <ul>{summary.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      </Reveal>
      <Reveal delay={240}>
        <div className="center mt-3">
          <button className="btn btn--ghost" onClick={() => setStage('lesson')}>← Back to the lesson</button>
          <button className="btn" onClick={downloadLog} style={{ marginLeft: '0.7rem' }}>⬇ Download dive log</button>
          <button className="btn" onClick={saveLog} disabled={saving} style={{ marginLeft: '0.7rem' }}>
            {saving ? <Spinner /> : saved ? '✓ Saved' : '🗂️ Save to Projects'}
          </button>
          <button className="btn btn--primary" onClick={() => setStage('feedback')} style={{ marginLeft: '0.7rem' }}>
            Rate the dive <span className="btn-orb">→</span>
          </button>
        </div>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------ tutor chat */

function Tutor({ sessionId, stepIndex, onLessonUpdated }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setBusy(true);
    try {
      const r = await api(`/api/sessions/${sessionId}/tutor`, {
        method: 'POST',
        body: { messages: next, stepIndex },
      });
      setMsgs((m) => [...m, { role: 'assistant', content: r.text }]);
      if (r.updated && r.session) onLessonUpdated(r.session, r.updated, r.addedCount ?? 0);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `(${e.message})` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="tutor-panel">
          <div className="chat-window">
            <div className="lulu-head">
              <span className="lulu-avatar">🐙</span>
              <div>
                <b>Lulu</b>
                <span className="lulu-sub">your dive guide · can reshape this lesson</span>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close Lulu" style={{ marginLeft: 'auto' }}>✕</button>
            </div>
            <div className="chat-scroll" ref={scrollRef}>
              {msgs.length === 0 && (
                <p className="muted center" style={{ margin: 'auto' }}>
                  Hi, I’m <b>Lulu</b> 🐙 — I don’t just chat, I <b>act</b>. Ask me to clarify something
                  step by step (“explain the objective function”) and I’ll add fresh interactive steps
                  right here. Tell me your own goal (“build a marketing agent for my company”) and I’ll
                  rebuild the whole dive around it.
                </p>
              )}
              {msgs.map((m, mi) => (
                <div key={mi} className={`bubble ${m.role === 'user' ? 'user' : 'bot'}`}>{m.content}</div>
              ))}
              {busy && <div className="bubble bot">Lulu is working…</div>}
            </div>
            <div className="chat-input-row">
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Ask Lulu, or tell her your goal…" aria-label="Ask Lulu" disabled={busy} />
              <button className="btn btn--primary" onClick={send} disabled={busy || !draft.trim()}>Send</button>
            </div>
          </div>
        </div>
      )}
      <button className="tutor-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Close Lulu ✕' : '🐙 Ask Lulu'}
      </button>
    </>
  );
}

/* ------------------------------------------------ feedback + end states */

function FeedbackStage({ session, setStage, toast }) {
  const [rating, setRating] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const unhappy = rating !== null && rating <= 3;

  const toggleReason = (r) => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const submit = async () => {
    setBusy(true);
    try {
      const { happy } = await api(`/api/sessions/${session.id}/feedback`, {
        method: 'POST', body: { rating, reasons, note },
      });
      setStage(happy ? 'happy' : 'sad-sent');
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <div className="center">
          <span className="eyebrow">Back at the surface</span>
          <h1 className="hero-title">How was the dive?</h1>
          <p className="lede" style={{ margin: '0 auto' }}>
            Your honest rating tunes every future lesson — for you and every diver after you.
          </p>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <Card>
          <FaceRating value={rating} onChange={setRating} />
          {unhappy && (
            <div style={{ animation: 'stepIn 0.5s var(--ease) both' }}>
              <p className="center muted" style={{ marginBottom: '1rem' }}>
                Sorry it missed the mark. What went wrong? (pick any that apply)
              </p>
              <div className="reason-row">
                {REASONS.map((r) => (
                  <button key={r} className={`reason-chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => toggleReason(r)}>{r}</button>
                ))}
              </div>
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Tell us more in your own words (optional, but it really helps)…" maxLength={2000} />
            </div>
          )}
          <div className="center mt-2">
            <button className="btn btn--primary" onClick={submit}
              disabled={busy || rating === null || (unhappy && reasons.length === 0 && !note.trim())}>
              {busy ? <Spinner /> : 'Send feedback'}
            </button>
            {unhappy && reasons.length === 0 && !note.trim() && (
              <p className="muted mt-1">Pick at least one reason or write a note, so support can actually fix it.</p>
            )}
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

function HappyStage({ navigate }) {
  return (
    <div className="page page--narrow">
      <Reveal>
        <EmptyState emoji="🎉">
          <h1 className="hero-title" style={{ fontSize: '2.2rem' }}>We’re happy we helped you!</h1>
          <p className="lede" style={{ margin: '0.8rem auto 0' }}>
            Thanks for diving with OceanMind. The ocean is deep — come back for another topic anytime.
          </p>
          <button className="btn btn--primary mt-3" onClick={() => navigate('/')}>
            Explore another dive <span className="btn-orb">→</span>
          </button>
        </EmptyState>
      </Reveal>
    </div>
  );
}

function AwaitingStage({ navigate }) {
  return (
    <div className="page page--narrow">
      <Reveal>
        <EmptyState emoji="🛟">
          <h1 className="hero-title" style={{ fontSize: '2.1rem' }}>Your report reached our support team.</h1>
          <p className="lede" style={{ margin: '0.8rem auto 0' }}>
            A human will review your session and the agent will rebuild the experience from
            scratch — delivered by <b>email</b> and waiting <b>right here</b> in your account.
            Watch the bell at the top.
          </p>
          <button className="btn btn--ghost mt-3" onClick={() => navigate('/')}>← Back to topics</button>
        </EmptyState>
      </Reveal>
    </div>
  );
}

function ClosedStage({ session, navigate }) {
  const summary = session.summary;
  return (
    <div className="page">
      <Reveal>
        <div className="center">
          <span className="eyebrow">📦 Dive complete</span>
          <h1 className="hero-title" style={{ fontSize: '2.1rem' }}>
            {summary ? summary.headline : 'This dive is complete.'}
          </h1>
          <p className="lede" style={{ margin: '0.6rem auto 0' }}>
            {session.topicTitle} · {session.zone ? session.zones[session.zone].label : ''} — thanks for diving with us.
          </p>
        </div>
      </Reveal>
      {summary && (
        <Reveal delay={120}>
          <div className="log-cols">
            <div className="log-col learned"><h4>🌊 What you learned</h4><ul>{summary.learned.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div className="log-col built"><h4>🔧 What you built</h4><ul>{summary.built.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div className="log-col next"><h4>🧭 Where to dive next</h4><ul>{summary.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
        </Reveal>
      )}
      <Reveal delay={200}>
        <div className="center mt-3">
          <button className="btn btn--primary" onClick={() => navigate('/')}>Start a new dive <span className="btn-orb">→</span></button>
        </div>
      </Reveal>
    </div>
  );
}
