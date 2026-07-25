import { useEffect, useMemo, useRef, useState } from 'react';

/* ============ MemoryBlock: context window & memory management ============ */

const TURNS = [
  'User: I need a laptop under $1000',
  'Agent: What will you use it for?',
  'User: Video editing, mostly 4K',
  'Agent: Then prioritise CPU + 16GB RAM',
  'User: Any recommendations?',
  'Agent: SwiftBook at $849 fits',
  'User: What about battery life?',
  'Agent: ~11 hours on that model',
  'User: And warranty?',
];

export function MemoryBlock() {
  const [strategy, setStrategy] = useState('window');
  const [budget, setBudget] = useState(5);

  const kept = useMemo(() => {
    if (strategy === 'all') return TURNS.map((t, i) => ({ t, kind: 'full', i }));
    if (strategy === 'window') {
      return TURNS.map((t, i) => ({ t, kind: i >= TURNS.length - budget ? 'full' : 'dropped', i }));
    }
    // summary: old turns collapse into one synthetic memory line
    const cut = TURNS.length - budget;
    const out = TURNS.map((t, i) => ({ t, kind: i >= cut ? 'full' : 'summarised', i }));
    return out;
  }, [strategy, budget]);

  const usedTokens = kept.filter((k) => k.kind === 'full').length * 12 + (strategy === 'summary' ? 14 : 0);
  const lost = kept.some((k) => k.kind === 'dropped' && /laptop|\$1000|video/.test(k.t));

  return (
    <div className="block-frame">
      <div className="seg" role="group" aria-label="Memory strategy">
        <button className={strategy === 'all' ? 'on' : ''} onClick={() => setStrategy('all')}>Keep everything</button>
        <button className={strategy === 'window' ? 'on' : ''} onClick={() => setStrategy('window')}>Sliding window</button>
        <button className={strategy === 'summary' ? 'on' : ''} onClick={() => setStrategy('summary')}>Summarise old turns</button>
      </div>
      <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {strategy === 'summary' && (
          <div className="mem-line summarised">🧠 <i>[summary of earlier turns: user wants a ≤$1000 laptop for 4K video editing]</i></div>
        )}
        {kept.map((k) => (
          <div key={k.i} className={`mem-line ${k.kind}`}>
            {k.kind === 'dropped' ? '🕳️ ' : k.kind === 'summarised' ? '· ' : '💬 '}{k.t}
          </div>
        ))}
      </div>
      <div className="stepper-row">
        {strategy !== 'all' && (
          <label className="dial">context budget <b>{budget} turns</b>
            <input type="range" min="2" max="8" step="1" value={budget} onChange={(e) => setBudget(+e.target.value)} /></label>
        )}
        <div className="stepper-msg">
          ~<b>{usedTokens}</b> tokens in context ·{' '}
          {strategy === 'all' ? 'Nothing is lost — but context grows forever and eventually overflows (and costs scale with every turn).'
            : lost ? <span style={{ color: 'var(--coral)' }}>The budget dropped the turns holding the price and the use-case — ask “and warranty?” now and the agent has forgotten what product you mean.</span>
            : strategy === 'summary' ? 'Old turns are compressed into one line: the key facts survive at a fraction of the tokens. This is what production agents do.'
            : 'Recent turns fit. Shrink the budget until the important early facts fall out.'}
        </div>
      </div>
      <p className="block-hint">Memory is a budget problem: every strategy trades <b>fidelity</b> against <b>tokens</b>. Shrink the window and watch the conversation break.</p>
    </div>
  );
}

/* ============ GuardrailsBlock: what happens when autonomy has no limits ============ */

const RAILS = {
  stepBudget: { label: 'Step budget', desc: 'Hard cap on loop iterations. Stops infinite think→act cycles.' },
  toolAllow: { label: 'Tool allow-list', desc: 'The agent may only call approved tools — no arbitrary side effects.' },
  humanApproval: { label: 'Human approval', desc: 'Risky actions (payments, deletions, emails) pause for a person.' },
  spendCap: { label: 'Spend cap', desc: 'Aborts the run when token/API cost crosses a threshold.' },
  observability: { label: 'Observability', desc: 'Every thought, tool call and result is logged and traceable.' },
};

const SCRIPT = [
  { t: 'Goal: clean up the customer database', risk: false },
  { t: 'Searching for duplicate records…', risk: false },
  { t: 'Found 1,284 possible duplicates', risk: false },
  { t: 'Calling delete_records(1284 rows)', risk: true, rail: 'humanApproval' },
  { t: 'Retrying delete with broader filter…', risk: true, rail: 'toolAllow' },
  { t: 'Looping: re-scanning database (iteration 47)', risk: true, rail: 'stepBudget' },
  { t: 'Token spend: $38 and climbing', risk: true, rail: 'spendCap' },
  { t: '…no record of which rows changed', risk: true, rail: 'observability' },
];

export function GuardrailsBlock() {
  const [on, setOn] = useState({ stepBudget: false, toolAllow: false, humanApproval: false, spendCap: false, observability: false });
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const timer = useRef(null);
  const onRef = useRef(on);
  onRef.current = on;

  useEffect(() => () => clearInterval(timer.current), []);

  const run = () => {
    clearInterval(timer.current);
    setStep(-1);
    setRunning(true);
    let i = -1;
    timer.current = setInterval(() => {
      i += 1;
      const s = SCRIPT[i];
      setStep(i);
      const blocked = s && s.risk && onRef.current[s.rail];
      if (!s || i >= SCRIPT.length - 1 || blocked) { clearInterval(timer.current); setRunning(false); }
    }, 750);
  };

  const shown = SCRIPT.slice(0, step + 1);
  const stoppedAt = shown.find((s) => s.risk && on[s.rail]);

  return (
    <div className="block-frame">
      <div className="fb-wrap" style={{ gridTemplateColumns: '220px 1fr' }}>
        <div className="fb-palette">
          <h4>Guardrails</h4>
          {Object.entries(RAILS).map(([k, v]) => (
            <button key={k} className={`tool-pick ${on[k] ? 'on' : ''}`} onClick={() => setOn((s) => ({ ...s, [k]: !s[k] }))} title={v.desc}>
              <span className="box">{on[k] ? '✓' : ''}</span>{v.label}
            </button>
          ))}
        </div>
        <div>
          <div style={{ minHeight: 230 }}>
            {shown.length === 0 && <p className="muted">Turn guardrails on or off, then run the agent and watch what it’s allowed to do.</p>}
            {shown.map((s, i) => {
              const blocked = s.risk && on[s.rail];
              return (
                <div key={i} className={`agent-step ${blocked ? 'fail' : s.risk ? 'act' : 'think'}`}>
                  <span className="glyph">{blocked ? '🛑' : s.risk ? '⚠️' : '⚙️'}</span>
                  <div>
                    <div className="kind">{blocked ? `blocked by ${RAILS[s.rail].label}` : s.risk ? 'risky action' : 'step'}</div>
                    <p>{s.t}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="stepper-row">
            <button className="btn btn--primary" onClick={run} disabled={running}>{running ? 'Running…' : '▶ Run the agent'}</button>
            <div className="stepper-msg">
              {stoppedAt
                ? <span style={{ color: 'var(--kelp)' }}>Stopped safely by <b>{RAILS[stoppedAt.rail].label}</b> — {RAILS[stoppedAt.rail].desc}</span>
                : step >= SCRIPT.length - 1
                  ? <span style={{ color: 'var(--danger)' }}>With no guardrails the agent deleted 1,284 rows, looped 47 times, burned $38, and left no audit trail. This is the failure mode the source warns about.</span>
                  : 'Autonomy without limits is the risk — switch rails on and re-run.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ MultiAgentBlock: centralized vs decentralized topologies ============ */

export function MultiAgentBlock() {
  const [mode, setMode] = useState('centralized');
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPulse((p) => p + 1), 1200);
    return () => clearInterval(t);
  }, []);

  const W = 620, H = 280;
  const workers = [0, 1, 2, 3].map((i) => ({
    x: W / 2 + Math.cos((i / 4) * Math.PI * 2 - Math.PI / 2) * 175,
    y: H / 2 + Math.sin((i / 4) * Math.PI * 2 - Math.PI / 2) * 95,
    label: `Agent ${i + 1}`,
  }));

  const edges = mode === 'centralized'
    ? workers.map((w, i) => ({ from: { x: W / 2, y: H / 2 }, to: w, i }))
    : workers.flatMap((w, i) => workers.slice(i + 1).map((w2, j) => ({ from: w, to: w2, i: i * 10 + j })));

  return (
    <div className="block-frame">
      <div className="seg" role="group" aria-label="Topology">
        <button className={mode === 'centralized' ? 'on' : ''} onClick={() => setMode('centralized')}>Centralized (orchestrator)</button>
        <button className={mode === 'decentralized' ? 'on' : ''} onClick={() => setMode('decentralized')}>Decentralized (peer-to-peer)</button>
      </div>
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} style={{ marginTop: '0.6rem' }} role="img" aria-label="Multi-agent topology">
        {edges.map((e, i) => (
          <line key={i} x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
            stroke="rgba(127,216,232,0.45)" strokeWidth="2"
            className={pulse % edges.length === i ? 'flow-anim' : ''} />
        ))}
        {mode === 'centralized' && (
          <g>
            <circle cx={W / 2} cy={H / 2} r="40" fill="rgba(22,184,216,0.25)" stroke="#2acbe9" strokeWidth="2.4" className="glow" />
            <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fill="#fff" fontSize="11">Orchestrator</text>
          </g>
        )}
        {workers.map((w, i) => (
          <g key={i}>
            <circle cx={w.x} cy={w.y} r="32" fill="rgba(8,26,42,0.92)" stroke="rgba(127,216,232,0.55)" strokeWidth="1.5" />
            <text x={w.x} y={w.y + 4} textAnchor="middle" fill="#9db8c6" fontSize="10.5">{w.label}</text>
          </g>
        ))}
      </svg>
      <div className="dg-detail">
        {mode === 'centralized'
          ? <><b>Centralized</b> (supervisory / orchestrator / router): one controller decomposes the goal and delegates. Predictable, easy to trace and debug — but the orchestrator is a bottleneck and a single point of failure.</>
          : <><b>Decentralized</b>: peers coordinate directly, sharing state or messages. Resilient and highly parallel, with <b>emergent</b> coordination rather than imposed control — but far harder to predict, trace, and stop.</>}
      </div>
    </div>
  );
}

/* ============ WorkflowVsAgentBlock: should this even be an agent? ============ */

const QUESTIONS = [
  { q: 'Are the steps known in advance and always the same?', yes: 'workflow', no: 'next' },
  { q: 'Does the task need decisions that depend on intermediate results?', yes: 'next', no: 'workflow' },
  { q: 'Is the search space open-ended (unknown number of steps)?', yes: 'agent', no: 'next' },
  { q: 'Is the cost of a wrong autonomous action acceptable / reversible?', yes: 'agent', no: 'workflow-hitl' },
];
const VERDICTS = {
  workflow: { label: 'Use a fixed workflow', color: '#35d0a5', text: 'Predictable steps → prompt chaining or plain code. Cheaper, faster, fully testable. The source is blunt: use the simplest thing that works, and only add agentic complexity when it pays for itself.' },
  agent: { label: 'An agent is justified', color: '#2ee6ff', text: 'Open-ended, decision-dependent work with tolerable failure cost — this is where autonomous loops genuinely beat fixed pipelines.' },
  'workflow-hitl': { label: 'Workflow + human in the loop', color: '#ffce6b', text: 'The task is dynamic but mistakes are expensive. Keep the loop, but gate risky actions behind human approval.' },
};

export function WorkflowVsAgentBlock() {
  const [idx, setIdx] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [trail, setTrail] = useState([]);

  const answer = (a) => {
    const q = QUESTIONS[idx];
    const next = a ? q.yes : q.no;
    setTrail((t) => [...t, { q: q.q, a: a ? 'Yes' : 'No' }]);
    if (next === 'next') {
      if (idx + 1 >= QUESTIONS.length) setVerdict('agent');
      else setIdx(idx + 1);
    } else setVerdict(next);
  };
  const reset = () => { setIdx(0); setVerdict(null); setTrail([]); };

  return (
    <div className="block-frame">
      {trail.map((t, i) => (
        <div key={i} className="mem-line full" style={{ opacity: 0.7 }}>
          <b style={{ color: 'var(--accent-soft)' }}>{t.a}</b> — {t.q}
        </div>
      ))}
      {!verdict ? (
        <>
          <h3 className="walk-title" style={{ fontSize: '1.15rem', marginTop: '0.8rem' }}>{QUESTIONS[idx].q}</h3>
          <div className="stepper-row">
            <button className="btn btn--primary" onClick={() => answer(true)}>Yes</button>
            <button className="btn" onClick={() => answer(false)}>No</button>
            <span className="muted">question {idx + 1} of {QUESTIONS.length}</span>
          </div>
        </>
      ) : (
        <div className="dg-detail" style={{ borderLeftColor: VERDICTS[verdict].color }}>
          <b style={{ color: VERDICTS[verdict].color }}>{VERDICTS[verdict].label}</b> — {VERDICTS[verdict].text}
          <div className="stepper-row"><button className="btn btn--ghost" onClick={reset}>↺ Run it again</button></div>
        </div>
      )}
      <p className="block-hint">Answer honestly about your own project — the most common mistake in the source is reaching for an autonomous agent when a fixed workflow would be cheaper, faster and safer.</p>
    </div>
  );
}
