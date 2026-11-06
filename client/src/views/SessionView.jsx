import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  Card, Reveal, Spinner, EmptyState, DepthGauge, FaceRating, Md, useToast,
  useDive, useStages, usePacedStages, demoReplyMs, demoReplyMaxMs, Stages, BubbleBurst,
} from '../components/ui.jsx';
import { isDemo, sleep, useTypewriter } from '../lib/motion.js';
import BlockRenderer from '../lessons/BlockRenderer.jsx';
import DiveJourney from '../components/DiveJourney.jsx';

const REASONS = ['Too easy', 'Too hard', 'Repetitive', 'Wrong topic', 'Wasn’t helpful'];
// How long a finished agent checklist stays on screen (every stage ticked) before the hand-off.
const HANDOFF_MS = 450;
const handoffMs = () => (isDemo() ? 320 : HANDOFF_MS);
// Clearance for the fixed nav when scrolling a lesson step to the top.
const NAV_CLEARANCE = 100;

export default function SessionView({ sessionId, navigate }) {
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  // stage: map → quiz → reveal → lesson → summary → feedback → happy | sad-sent
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

  // Every stage opens at the top: the CTA that got us here often sits far down
  // a long page, and the next stage's header would otherwise start off-screen.
  useEffect(() => {
    if (stage) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stage]);

  let body = null;
  if (error) {
    body = (
      <div className="page page--narrow">
        <EmptyState emoji="🫧">{error}<br />
          <button className="btn btn--ghost mt-2" onClick={() => navigate('/')}>← Back</button>
        </EmptyState>
      </div>
    );
  } else if (!session || !stage) {
    body = (
      <div className="page center om-v-loading">
        <Spinner />
        <p className="muted mt-1">Opening your dive…</p>
      </div>
    );
  } else {
    const props = { session, setSession, setStage, navigate, toast };
    if (stage === 'map') body = <KnowledgeMapStage {...props} />;
    else if (stage === 'quiz') body = <QuizStage {...props} />;
    else if (stage === 'reveal') body = <RevealStage {...props} />;
    else if (stage === 'lesson') body = <LessonStage {...props} />;
    else if (stage === 'summary') body = <SummaryStage {...props} />;
    else if (stage === 'feedback') body = <FeedbackStage {...props} />;
    else if (stage === 'happy') body = <HappyStage {...props} />;
    else if (stage === 'sad-sent' || stage === 'awaiting_rebuild') body = <AwaitingStage {...props} />;
    else if (stage === 'closed') body = <ClosedStage {...props} />;
  }

  // data-stage lets the demo director always know where the learner is.
  const stageName = error ? 'error' : stage ?? 'loading';
  return (
    <div data-demo="session" data-stage={stageName} data-session-id={session?.id ?? sessionId}>
      <div key={stageName} className="om-v-stage">{body}</div>
    </div>
  );
}

/* ------------------------------------------------ knowledge map (generated) */

/** Concept title box — click to reveal the details. Enters as if just compiled. */
function ConceptBox({ concept, col, order }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={`concept concept--toggle om-v-compile ${open ? 'open' : ''}`} style={{ '--i': order }}
      onClick={() => setOpen(!open)} aria-expanded={open} data-demo="concept-toggle" data-col={col}>
      <b>{concept.name} <span className="chev">▶</span></b>
      <span className="om-v-desc" aria-hidden={!open}><span>{concept.desc}</span></span>
    </button>
  );
}

function KnowledgeMapStage({ session, setStage }) {
  const km = session.knowledgeMap;
  const mustCount = km.mustKnow.length;
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
            {km.mustKnow.map((c, ci) => <ConceptBox key={c.name} concept={c} col="must" order={ci} />)}
          </Card>
          <Card className="map-col">
            <h3><span className="chip chip--need">Need to know</span></h3>
            {km.needToKnow.map((c, ci) => <ConceptBox key={c.name} concept={c} col="need" order={mustCount + ci} />)}
          </Card>
        </div>
      </Reveal>
      <Reveal delay={260}>
        <div className="center mt-3">
          <button className="btn btn--primary" onClick={() => setStage('quiz')} data-demo="map-cta">
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
  const [dir, setDir] = useState(1); // slide direction of the question swap
  const [fresh, setFresh] = useState(null); // question answered on screen just now → pop / shake once
  const [busyChoice, setBusyChoice] = useState(null);
  const [summary, setSummary] = useState(null);

  const q = questions[i];
  const result = answeredMap.get(q.id) ?? null; // {choice, correct, correctIndex, explanation}
  const go = (to) => {
    setDir(to >= i ? 1 : -1);
    setFresh(null);
    setI(to);
  };

  const answer = async (choice) => {
    if (result || busyChoice !== null) return;
    setBusyChoice(choice);
    try {
      const r = await api(`/api/sessions/${session.id}/answer`, {
        method: 'POST',
        body: { questionId: q.id, choice },
      });
      setFresh(q.id);
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

  const answeredCount = session.answered?.length ?? 0;
  const allAnswered = answeredCount === questions.length;

  const finish = () => {
    setSession((s) => ({ ...s, ...(summary ?? {}), score: summary?.scorePct ?? s.score, zone: summary?.zone ?? s.zone, depth: summary?.depth ?? s.depth }));
    setStage('reveal');
  };

  const animate = fresh === q.id;
  const optClass = (idx) => {
    if (!result) return busyChoice === idx ? 'option selected' : 'option';
    let cls = 'option locked';
    if (idx === result.correctIndex) cls += ` reveal-correct${animate ? ` om-correct${result.correct ? '' : ' om-v-late'}` : ''}`;
    else if (idx === result.choice) cls += ` reveal-wrong${animate ? ' om-wrong' : ''}`;
    return cls;
  };

  // one pip per question: correct / wrong / no idea / current / to come
  const pip = (qq, qi) => {
    const a = answeredMap.get(qq.id);
    if (a) return a.correct ? 'right' : a.choice === -1 ? 'skip' : 'wrong';
    return qi === i ? 'now' : '';
  };

  return (
    <div className="page page--narrow">
      <span className="eyebrow">Step 2 · Depth check · {session.topicTitle}</span>
      <div className="progress-track" aria-label={`Question ${i + 1} of ${questions.length}`}>
        <div className="progress-fill" style={{ transform: `scaleX(${answeredCount / questions.length})` }} />
      </div>
      <div className="om-v-tally" aria-hidden="true" data-demo="quiz-tally" data-answered={answeredCount}>
        {questions.map((qq, qi) => <i key={qq.id} className={pip(qq, qi)} />)}
      </div>
      <div key={q.id} className={`om-v-swap${dir < 0 ? ' om-v-back' : ''}`} data-demo="quiz" data-qid={q.id} data-index={i}
        data-answered={Boolean(result)} data-correct={result ? String(result.correct) : undefined} data-busy={busyChoice !== null}>
        <Card>
          <p className="q-concept">Concept: {q.concept} · {i + 1} / {questions.length}</p>
          <h2 className="q-text">{q.text}</h2>
          {q.options.map((opt, idx) => (
            <button key={idx} className={optClass(idx)} onClick={() => answer(idx)} disabled={busyChoice !== null && !result}
              data-demo="quiz-option" data-idx={idx}>
              <span className="key">
                {busyChoice === idx && !result ? <Spinner />
                  : result && idx === result.correctIndex ? '✓' : result && idx === result.choice && !result.correct ? '✗' : 'ABCD'[idx]}
              </span>
              {opt}
            </button>
          ))}
          {!result && (
            <button className={`option option--noidea ${busyChoice === -1 ? 'selected' : ''}`} onClick={() => answer(-1)} disabled={busyChoice !== null}
              data-demo="quiz-noidea">
              <span className="key">{busyChoice === -1 ? <Spinner /> : '?'}</span> I don’t have any idea — and that’s completely fine
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
            <button className="btn btn--ghost" onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} data-demo="quiz-back">← Back</button>
            {allAnswered && i === questions.length - 1 ? (
              <button className="btn btn--primary" onClick={finish} data-demo="quiz-reveal">
                Reveal my depth <span className="btn-orb">→</span>
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => go(Math.min(questions.length - 1, i + 1))} disabled={!result} data-demo="quiz-next">
                Next <span className="btn-orb">→</span>
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------ depth reveal → build lesson */

const ZONE_ORDER = ['sunlight', 'twilight', 'midnight'];

function RevealStage({ session, setSession, setStage, toast }) {
  const zone = session.zones[session.zone];
  const rebuilt = Boolean(session.rebuiltFrom);
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(false);
  const dive = useDive(session.depth);
  const buildSteps = [
    `Placing you at ${session.depth.toLocaleString()} m`,
    'Choosing interactive blocks for your gaps',
    'Writing each step',
    'Checking it against the sources',
  ];
  // paced to the build request (see usePacedStages); real models: 1.4 s / 2.6 s / 9 s
  const build = usePacedStages(buildSteps.length, { stepMs: [1400, 2600, 9000] });
  const buildAt = build.at;

  // which zone the diver is passing through right now (for the callouts)
  const passing = dive.done ? session.zone : dive.pct >= 0.65 ? 'midnight' : dive.pct >= 0.3 ? 'twilight' : 'sunlight';
  const zoneName = (id) => session.zones[id]?.label ?? id;
  const callout = dive.done
    ? `✓ Settled in the ${zone.label}`
    : passing === 'sunlight'
      ? `↓ Descending through the ${zoneName('sunlight')}`
      : passing === 'twilight'
        ? `↓ Passing 200 m — entering the ${zoneName('twilight')}`
        : `↓ Passing 1,000 m — entering the ${zoneName('midnight')}`;

  const enterLesson = async () => {
    if (session.lesson) {
      setStage('lesson');
      return;
    }
    setBuilding(true);
    build.start({ expectMs: demoReplyMs('lesson') });
    try {
      const { session: s } = await api(`/api/sessions/${session.id}/build-lesson`, { method: 'POST' });
      await build.finish(); // every stage has had its moment, then all tick ✓
      setBuilt(true);
      await sleep(handoffMs());
      setSession(s);
      setStage('lesson');
    } catch (e) {
      toast(e.message, 'error');
      build.reset();
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
            <DepthGauge depth={session.depth} zoneLabel={zone.label} dive={dive} />
            <div className="depth-readout" style={{ alignSelf: 'center' }} data-demo="depth-readout"
              data-done={dive.done} data-depth={session.depth} data-zone={session.zone}
              data-passing={passing} data-zone-index={ZONE_ORDER.indexOf(passing)}>
              <div key={dive.done ? 'done' : passing} className="om-v-callout om-swap">{callout}</div>
              <div className="depth-num">{Math.round(dive.meters).toLocaleString()} <small>meters</small></div>
              <div className={`zone-pill om-v-settle${dive.done ? ' in' : ''}`}>🤿 {zone.label} · {zone.range} · {zone.levelLabel}</div>
              <p className={`lede mt-2 om-v-settle${dive.done ? ' in' : ''}`} style={{ fontSize: '0.98rem' }}>
                {session.zone === 'sunlight' && 'Plenty of light up here — the agent will build your lesson from first principles, repairing exactly what the quiz surfaced.'}
                {session.zone === 'twilight' && 'You know the surface — the agent will build your lesson around the mechanics, focused on what you missed.'}
                {session.zone === 'midnight' && 'Deep water. The agent will skip the basics and build your lesson around the hard parts.'}
              </p>
              <button className="btn btn--primary mt-3" onClick={enterLesson} disabled={building} data-demo="build-lesson"
                data-state={building ? (built ? 'built' : 'building') : session.lesson ? 'ready' : 'idle'}>
                {building ? <Spinner /> : session.lesson ? 'Enter the lesson' : 'Build my lesson'}
                {!building && <span className="btn-orb">→</span>}
              </button>
              {building && (
                <div className="om-v-build" role="status" data-demo="build-stages">
                  <p className="muted">The agent is writing your personalized walkthrough from the source material.</p>
                  <Stages items={buildSteps} current={buildAt} />
                </div>
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
  const [dir, setDir] = useState(1); // slide direction of the step swap
  const [checkPicks, setCheckPicks] = useState({}); // step key → chosen idx
  const [freshPick, setFreshPick] = useState(null); // check picked on screen just now → pop / shake once
  const [inserted, setInserted] = useState(null); // { from, count } steps Lulu just added → flash them
  const progressRef = useRef(null);
  // clamp the index into range — the lesson can shrink when Lulu reshapes it,
  // and reading steps[out-of-range] would crash / freeze the page.
  const i = Math.max(0, Math.min(rawI, steps.length - 1));
  const step = steps[i];
  const atEnd = i === steps.length - 1;
  const checkKey = `${i}:${step.title}`;
  const goTo = (idx) => {
    const to = Math.max(0, Math.min(idx, steps.length - 1));
    setDir(to >= i ? 1 : -1);
    setFreshPick(null);
    setI(to);
  };

  const pick = (idx) => {
    if (checkPicks[checkKey] !== undefined) return;
    setFreshPick(checkKey);
    setCheckPicks((m) => ({ ...m, [checkKey]: idx }));
  };
  const isCheck = step.block?.type === 'check';
  const checkQ = isCheck ? step.block.question : null;
  const picked = checkPicks[checkKey];
  const checkAnswered = !isCheck || picked !== undefined;
  const stepKind = isCheck ? 'check' : step.block ? 'interact' : 'learn';
  const isNew = (si) => Boolean(inserted) && si >= inserted.from && si < inserted.from + inserted.count;

  // Each new step starts at the top of its card (just under the nav); step 0
  // and a redesigned lesson start at the very top of the page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const bar = progressRef.current;
    const top = i === 0 || !bar ? 0 : bar.getBoundingClientRect().top + window.scrollY - NAV_CLEARANCE;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [i, lesson?.title]);

  // the insertion flash (.om-flash runs 2 × 1.4s) clears itself
  useEffect(() => {
    if (!inserted) return undefined;
    const t = setTimeout(() => setInserted(null), 3000);
    return () => clearTimeout(t);
  }, [inserted]);

  // The guide (tutor agent) can mutate the lesson live.
  const onLessonUpdated = (newSession, updated, addedCount) => {
    if (updated === 'redesigned') {
      setDir(1);
      setI(0);
      setCheckPicks({});
      setFreshPick(null);
      setSession(newSession);
      toast('🌊 Lulu rebuilt your experience around your goal — starting the new dive.', 'success');
    } else if (updated === 'expanded') {
      setCheckPicks({});
      setFreshPick(null);
      setSession(newSession);
      // jump to the first newly-inserted step (right after the current one)
      setDir(1);
      setI(i + 1);
      setInserted({ from: i + 1, count: Math.max(1, addedCount), at: Date.now() });
      toast(`🤿 Lulu added ${addedCount} new step${addedCount > 1 ? 's' : ''} — here they are.`, 'success');
    } else {
      setSession(newSession);
    }
  };

  const checkClass = (idx) => {
    if (picked === undefined) return 'option';
    const animate = freshPick === checkKey;
    let cls = 'option locked';
    if (idx === checkQ.correctIndex) cls += ` reveal-correct${animate ? ` om-correct${picked === checkQ.correctIndex ? '' : ' om-v-late'}` : ''}`;
    else if (idx === picked) cls += ` reveal-wrong${animate ? ' om-wrong' : ''}`;
    return cls;
  };

  return (
    <div className="page om-v-lesson">
      <Reveal>
        <div className="lesson-head">
          <div>
            <span className="eyebrow">🤿 {zone.label} · {session.depth.toLocaleString()} m · {session.topicTitle}{session.version > 1 ? ` · rebuilt v${session.version}` : ''}</span>
            <h1 className="hero-title" style={{ fontSize: 'clamp(1.8rem,4vw,2.5rem)' }}>{lesson.title}</h1>
            <p className="lede">{lesson.intro}</p>
          </div>
          <span className="badge badge--live om-v-shimmer" title="This lesson was generated for you by the connected model">✦ Built for you</span>
        </div>
      </Reveal>

      <DiveJourney steps={steps} current={i} onJump={goTo} fresh={inserted} />

      <div className="walk-progress" ref={progressRef} aria-label={`Step ${i + 1} of ${steps.length}`}>
        {steps.map((_, si) => (
          <span key={si} className={`${si < i ? 'done' : si === i ? 'now' : ''}${isNew(si) ? ' om-v-new' : ''}`} />
        ))}
      </div>

      <div key={`${i}-${steps.length}-${step.title}`} className={`om-v-swap${dir < 0 ? ' om-v-back' : ''}`}
        data-demo="lesson-step" data-step-index={i} data-step-count={steps.length} data-step-kind={stepKind}
        data-block-type={step.block?.type ?? 'none'} data-check-answered={isCheck ? String(picked !== undefined) : undefined}>
        <Card className={isNew(i) ? 'om-flash' : ''}>
          <div className="step-kind">
            {isCheck ? `Step ${i + 1} · Check yourself` : step.block ? `Step ${i + 1} · Interact` : `Step ${i + 1} · Learn`}
          </div>
          <h2 className="walk-title">{step.title}</h2>
          <Md text={step.body} stagger />

          {isCheck ? (
            <div className="mt-2">
              <h3 style={{ fontSize: '1.02rem', marginBottom: '0.8rem', color: '#fff' }}>{checkQ.text}</h3>
              {checkQ.options.map((opt, idx) => (
                <button key={idx} className={checkClass(idx)} onClick={() => pick(idx)} data-demo="check-option" data-idx={idx}>
                  <span className="key">
                    {picked !== undefined && idx === checkQ.correctIndex ? '✓'
                      : picked !== undefined && idx === picked ? '✗' : 'ABCD'[idx]}
                  </span>
                  {opt}
                </button>
              ))}
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
            <button className="btn btn--ghost" onClick={() => goTo(i - 1)} disabled={i === 0} data-demo="step-prev">← Previous step</button>
            {atEnd ? (
              <button className="btn btn--primary" onClick={() => setStage('summary')} data-demo="step-next" data-last="true">
                Surface — open your dive log <span className="btn-orb">🧭</span>
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => goTo(i + 1)} disabled={!checkAnswered}
                title={checkAnswered ? '' : 'Answer the check question first'} data-demo="step-next" data-last="false">
                Next step <span className="btn-orb">→</span>
              </button>
            )}
          </div>
        </Card>
      </div>

      <Tutor sessionId={session.id} stepIndex={i} onLessonUpdated={onLessonUpdated} />
    </div>
  );
}

/* ------------------------------------------------ dive log (summary) */

// One request per session even when React StrictMode runs the effect twice.
const summaryRequests = new Map();
function requestSummary(sessionId) {
  if (!summaryRequests.has(sessionId)) {
    const p = api(`/api/sessions/${sessionId}/summary`, { method: 'POST' });
    summaryRequests.set(sessionId, p);
    p.catch(() => {}).finally(() => summaryRequests.delete(sessionId));
  }
  return summaryRequests.get(sessionId);
}

const LOG_STAGES = ['Reading back your dive', 'Collecting what you learned', 'Logging what you built', 'Charting where to dive next'];

/** The three log columns; items surface one by one like treasure. */
function LogCols({ summary }) {
  const cols = [
    { cls: 'learned', title: '🌊 What you learned', items: summary.learned },
    { cls: 'built', title: '🔧 What you built', items: summary.built },
    { cls: 'next', title: '🧭 Where to dive next', items: summary.nextSteps },
  ];
  let n = 0;
  return (
    <div className="log-cols om-v-log">
      {cols.map((c, ci) => (
        <div key={c.cls} className={`log-col ${c.cls}`} style={{ '--c': ci }}>
          <h4>{c.title}</h4>
          <ul>{(c.items ?? []).map((x, xi) => <li key={xi} style={{ '--i': n++ }}>{x}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function SummaryStage({ session, setSession, setStage, toast }) {
  const [summary, setSummary] = useState(session.summary ?? null);
  const [showLog, setShowLog] = useState(Boolean(session.summary));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const zone = session.zones[session.zone];
  // paced to the summary request (see usePacedStages); real models: 1.2 s / 2.2 s / 6 s
  const writing = usePacedStages(LOG_STAGES.length, { stepMs: [1200, 2200, 6000] });
  const writingAt = writing.at;

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
    if (saved) return; // one project per log — repeat clicks used to create duplicates
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
    writing.start({ expectMs: demoReplyMs('summary') });
    requestSummary(session.id)
      .then(async (r) => {
        if (cancelled) return;
        setSession((s) => ({ ...s, summary: r.summary }));
        await writing.finish(); // every stage has had its moment, then all tick ✓
        if (cancelled) return;
        setSummary(r.summary);
        await sleep(handoffMs());
        if (!cancelled) setShowLog(true);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="page page--narrow" data-demo="summary" data-ready="false">
        <EmptyState emoji="🫧">{error}
          <br />
          <button className="btn btn--primary mt-2" onClick={() => { setError(''); setSummary(null); setStage('lesson'); }} data-demo="summary-back">← Back to the lesson</button>
          <button className="btn btn--ghost mt-2" onClick={() => setStage('feedback')} style={{ marginLeft: '0.6rem' }} data-demo="summary-rate">Skip to feedback →</button>
        </EmptyState>
      </div>
    );
  }
  if (!showLog) {
    return (
      <div className="page page--narrow center om-v-writing" data-demo="summary" data-ready="false">
        <span className="eyebrow">🪙 Surfacing</span>
        <p className="lede mt-2" style={{ margin: '1rem auto 0' }}>Writing your dive log — what you learned, what you built…</p>
        <div className="om-v-writing-list" role="status">
          <Stages items={LOG_STAGES} current={writingAt} />
        </div>
      </div>
    );
  }

  return (
    <div className="page" data-demo="summary" data-ready="true">
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
        <LogCols summary={summary} />
      </Reveal>
      <Reveal delay={240}>
        <div className="center mt-3">
          <button className="btn btn--ghost" onClick={() => setStage('lesson')} data-demo="summary-back">← Back to the lesson</button>
          <button className="btn" onClick={downloadLog} style={{ marginLeft: '0.7rem' }} data-demo="summary-download">⬇ Download dive log</button>
          <button className="btn" onClick={saveLog} disabled={saving || saved} style={{ marginLeft: '0.7rem' }} data-demo="summary-save" data-saved={saved}>
            {saving ? <Spinner /> : saved ? <span className="om-pop">✓ Saved</span> : '🗂️ Save to Projects'}
          </button>
          <button className="btn btn--primary" onClick={() => setStage('feedback')} style={{ marginLeft: '0.7rem' }} data-demo="summary-rate">
            Rate the dive <span className="btn-orb">→</span>
          </button>
        </div>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------ tutor chat */

const PANEL_EXIT_MS = 260; // matches .tutor-panel.om-v-leaving
// What Lulu is doing while a reply is in flight. The 3rd stage appears only when
// the reply outlasts a plain answer (demo), i.e. she is writing new steps.
const LULU_STAGES = ['Reading your question', 'Checking this step’s sources', 'Writing new steps into your lesson'];

/** Lulu's reply bubble; the newest one streams in like it is being written. */
function BotBubble({ text, typing, onGrow, onDone }) {
  const shown = useTypewriter(text, { enabled: typing, cps: 120 });
  const finished = !typing || shown.length >= text.length;
  useEffect(() => {
    if (typing) onGrow?.();
  }, [typing, shown, onGrow]);
  useEffect(() => {
    if (typing && finished) onDone?.();
  }, [typing, finished, onDone]);
  return <div className={`bubble bot${finished ? '' : ' om-caret'}`}>{typing ? shown : text}</div>;
}

function Tutor({ sessionId, stepIndex, onLessonUpdated }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [typingIdx, setTypingIdx] = useState(-1); // the reply currently being typed out
  const [longRun, setLongRun] = useState(false); // the reply outlasted a plain answer → new steps
  const thinking = usePacedStages(longRun ? 3 : 2, { stepMs: 1600 });
  const scrollRef = useRef(null);
  const closeTimer = useRef(null);
  const longTimer = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open, busy]);
  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    clearTimeout(longTimer.current);
  }, []);

  // keep the growing reply in view while it types
  const stickToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const doneTyping = useCallback(() => setTypingIdx(-1), []);

  const shown = open && !closing;
  const openPanel = () => {
    clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  };
  const closePanel = () => {
    if (!open || closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, PANEL_EXIT_MS);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setBusy(true);
    setLongRun(false);
    const decideMs = demoReplyMs('tutor_decide');
    thinking.start({ expectMs: decideMs });
    clearTimeout(longTimer.current);
    if (decideMs != null) {
      // still thinking after the slowest plain answer: she is expanding the lesson
      longTimer.current = setTimeout(() => {
        setLongRun(true);
        thinking.retime(demoReplyMs('expand_steps'), { count: 3 });
      }, demoReplyMaxMs(decideMs) + 60);
    }
    try {
      const r = await api(`/api/sessions/${sessionId}/tutor`, {
        method: 'POST',
        body: { messages: next, stepIndex },
      });
      clearTimeout(longTimer.current);
      await thinking.finish();
      setTypingIdx(next.length);
      setMsgs((m) => [...m, { role: 'assistant', content: r.text }]);
      if (r.updated && r.session) onLessonUpdated(r.session, r.updated, r.addedCount ?? 0);
    } catch (e) {
      clearTimeout(longTimer.current);
      setMsgs((m) => [...m, { role: 'assistant', content: `(${e.message})` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className={`tutor-panel${closing ? ' om-v-leaving' : ''}`} data-demo="tutor-panel"
          data-busy={busy} data-typing={typingIdx >= 0} data-count={msgs.length}>
          <div className="chat-window">
            <div className="lulu-head">
              <span className={`lulu-avatar${busy ? ' om-v-thinking-avatar' : ''}`}>🐙</span>
              <div>
                <b>Lulu</b>
                <span className="lulu-sub">{busy ? 'thinking…' : 'your dive guide · can reshape this lesson'}</span>
              </div>
              <button className="icon-btn" onClick={closePanel} aria-label="Close Lulu" style={{ marginLeft: 'auto' }} data-demo="tutor-close">✕</button>
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
              {msgs.map((m, mi) => (m.role === 'user'
                ? <div key={mi} className="bubble user">{m.content}</div>
                : <BotBubble key={mi} text={m.content} typing={mi === typingIdx} onGrow={stickToBottom} onDone={doneTyping} />
              ))}
              {busy && (
                <div className="bubble bot om-v-thinking" data-demo="tutor-thinking">
                  <Stages items={LULU_STAGES.slice(0, longRun ? 3 : 2)} current={thinking.at} className="om-v-mini" />
                  <span className="om-v-sr">Lulu is working…</span>
                </div>
              )}
            </div>
            <div className="chat-input-row">
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Ask Lulu, or tell her your goal…" aria-label="Ask Lulu" disabled={busy} autoFocus
                data-demo="tutor-input" />
              <button className="btn btn--primary" onClick={send} disabled={busy || !draft.trim()} data-demo="tutor-send">Send</button>
            </div>
          </div>
        </div>
      )}
      <button className="tutor-toggle" onClick={() => (shown ? closePanel() : openPanel())} aria-expanded={shown}
        data-demo="tutor-toggle" data-open={shown}>
        {shown ? 'Close Lulu ✕' : '🐙 Ask Lulu'}
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
                  <button key={r} className={`reason-chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => toggleReason(r)}
                    data-demo="reason-chip" data-reason={r}>{r}</button>
                ))}
              </div>
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Tell us more in your own words (optional, but it really helps)…" maxLength={2000}
                data-demo="feedback-note" />
            </div>
          )}
          <div className="center mt-2">
            <button className="btn btn--primary" onClick={submit}
              disabled={busy || rating === null || (unhappy && reasons.length === 0 && !note.trim())} data-demo="feedback-send">
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
    <div className="page page--narrow om-v-cheer">
      <BubbleBurst seed="happy" count={30} />
      <Reveal>
        <EmptyState emoji="🎉">
          <h1 className="hero-title" style={{ fontSize: '2.2rem' }}>We’re happy we helped you!</h1>
          <p className="lede" style={{ margin: '0.8rem auto 0' }}>
            Thanks for diving with OceanMind. The ocean is deep — come back for another topic anytime.
          </p>
          <button className="btn btn--primary mt-3" onClick={() => navigate('/')} data-demo="happy-explore">
            Explore another dive <span className="btn-orb">→</span>
          </button>
        </EmptyState>
      </Reveal>
    </div>
  );
}

const SUPPORT_TRACK = ['Report sent to support', 'A human reviews your session', 'The agent rebuilds your dive', 'Delivered by email and right here'];

function AwaitingStage({ navigate }) {
  // the report visibly "lands": sent ticks, then review is in progress
  const at = useStages(2, { running: true, stepMs: 900 });
  return (
    <div className="page page--narrow om-v-await">
      <Reveal>
        <EmptyState emoji="🛟">
          <h1 className="hero-title" style={{ fontSize: '2.1rem' }}>Your report reached our support team.</h1>
          <p className="lede" style={{ margin: '0.8rem auto 0' }}>
            A human will review your session and the agent will rebuild the experience from
            scratch — delivered by <b>email</b> and waiting <b>right here</b> in your account.
            Watch the bell at the top.
          </p>
          <div className="om-v-track" role="status" data-demo="support-track">
            <Stages items={SUPPORT_TRACK} current={at} />
          </div>
          <button className="btn btn--ghost mt-3" onClick={() => navigate('/')} data-demo="awaiting-back">← Back to topics</button>
        </EmptyState>
      </Reveal>
    </div>
  );
}

function ClosedStage({ session, navigate }) {
  const summary = session.summary;
  return (
    <div className="page om-v-closed">
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
          <LogCols summary={summary} />
        </Reveal>
      )}
      <Reveal delay={200}>
        <div className="center mt-3">
          <button className="btn btn--primary" onClick={() => navigate('/')} data-demo="closed-new">Start a new dive <span className="btn-orb">→</span></button>
        </div>
      </Reveal>
    </div>
  );
}
