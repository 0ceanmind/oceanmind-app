import { useEffect, useRef, useState } from 'react';
import { ease, useTweenedNumber } from '../../lib/motion.js';
import { useProgress } from './DiagramBlocks.jsx';
import './generic.css';

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
const TOKENS_PER_TURN = 12;
const MAX_TOKENS = TURNS.length * TOKENS_PER_TURN;
// The facts the rest of the conversation leans on, and the turn that carries each one.
const FACTS = [
  { turn: 0, icon: '💰', name: 'price cap', note: 'user wants a ≤$1000 laptop', key: true },
  { turn: 2, icon: '🎬', name: 'use-case', note: 'for 4K video editing', key: true },
  { turn: 3, note: 'needs a strong CPU + 16GB RAM' },
  { turn: 5, icon: '💻', name: 'product', note: 'SwiftBook ($849) recommended', key: true },
  { turn: 7, note: 'battery ~11 h' },
];
const factAt = (i) => FACTS.find((f) => f.turn === i);

export function MemoryBlock() {
  const [strategy, setStrategy] = useState('window');
  // Starts with everything in the window, so shrinking it is what breaks the conversation.
  const [budget, setBudget] = useState(TURNS.length);

  const cut = strategy === 'all' ? 0 : TURNS.length - budget; // turns before `cut` leave the raw context
  const kindOf = (i) => (i >= cut ? 'full' : strategy === 'summary' ? 'summarised' : 'dropped');
  const summarised = strategy === 'summary' ? FACTS.filter((f) => f.turn < cut) : [];
  const hasSummary = strategy === 'summary' && cut > 0;
  const summaryTokens = hasSummary ? 6 + summarised.length * 5 : 0;
  const usedTokens = (TURNS.length - cut) * TOKENS_PER_TURN + summaryTokens;
  const shownTokens = useTweenedNumber(usedTokens, { duration: 450 });
  const lostFacts = strategy === 'window' ? FACTS.filter((f) => f.key && f.turn < cut) : [];
  const severity = lostFacts.some((f) => f.name === 'product') ? 'product' : lostFacts.length ? 'context' : 'none';

  const message = strategy === 'all'
    ? 'Nothing is lost — but context grows forever and eventually overflows (and costs scale with every turn).'
    : severity === 'product'
      ? <span style={{ color: 'var(--coral)' }}>The budget dropped the turns holding the price, the use-case and the product — ask “and warranty?” now and the agent has forgotten what product you mean.</span>
      : severity === 'context'
        ? <span style={{ color: '#ffce6b' }}>The window dropped the {lostFacts.map((f) => f.name).join(' and the ')} — it can still answer “and warranty?” about the SwiftBook, but no longer knows why it was picked. Keep shrinking.</span>
        : strategy === 'summary'
          ? hasSummary
            ? `Old turns are compressed into one line: the key facts survive at a fraction of the tokens (${cut * TOKENS_PER_TURN - summaryTokens} saved). This is what production agents do.`
            : 'Everything still fits, so there is nothing to summarise yet — shrink the budget.'
          : 'Recent turns fit. Shrink the budget until the important early facts fall out.';

  return (
    <div className="block-frame" data-running="false" data-done={severity === 'product' ? 'true' : 'false'}
      data-phase={strategy} data-budget={budget} data-lost={severity} data-tokens={usedTokens}>
      <div className="seg" role="group" aria-label="Memory strategy">
        <button className={strategy === 'all' ? 'on' : ''} aria-pressed={strategy === 'all'} data-demo="strategy-all" onClick={() => setStrategy('all')}>Keep everything</button>
        <button className={strategy === 'window' ? 'on' : ''} aria-pressed={strategy === 'window'} data-demo="strategy-window" onClick={() => setStrategy('window')}>Sliding window</button>
        <button className={strategy === 'summary' ? 'on' : ''} aria-pressed={strategy === 'summary'} data-demo="strategy-summary" onClick={() => setStrategy('summary')}>Summarise old turns</button>
      </div>

      {/* the context window: one cell per turn, oldest left; the summary collapses old cells into one */}
      <div className="om-gen-meter" data-demo="meter" role="img"
        aria-label={`Context window: about ${usedTokens} of ${MAX_TOKENS} tokens`}>
        <span className="om-gen-meter-label">context window</span>
        <div className="om-gen-meter-track">
          <span className="om-gen-cell sum" style={{ width: `${(summaryTokens / MAX_TOKENS) * 100}%` }}>{hasSummary && '🧠'}</span>
          {TURNS.map((t, i) => {
            const kind = kindOf(i);
            const fact = factAt(i);
            return (
              <span key={i} className={`om-gen-cell ${kind}`} style={{ width: kind === 'summarised' ? '0%' : `${100 / TURNS.length}%` }}>
                {fact?.icon && <i className={kind === 'dropped' ? 'lost' : ''} title={fact.name}>{fact.icon}</i>}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {hasSummary && (
          <div className="mem-line summarised om-gen-mem-summary" data-demo="summary-line">
            🧠 <i key={cut} className="om-swap">[summary of earlier turns: {summarised.map((f) => f.note).join(', ')}]</i>
          </div>
        )}
        {TURNS.map((t, i) => {
          const kind = kindOf(i);
          return (
            <div key={i} className={`mem-line ${kind} ${kind === 'summarised' ? 'om-gen-folded' : ''}`}
              data-demo="mem-row" data-idx={i} data-kind={kind}
              style={{ transitionDelay: strategy === 'summary' ? `${i * 35}ms` : '0ms' }}>
              {kind === 'dropped' ? '🕳️ ' : kind === 'summarised' ? '· ' : '💬 '}{t}
            </div>
          );
        })}
      </div>
      <div className="stepper-row">
        {strategy !== 'all' && (
          <label className="dial">context budget <b>{budget} turns</b>
            <input type="range" min="2" max={TURNS.length} step="1" value={budget} data-demo="budget"
              onChange={(e) => setBudget(+e.target.value)} /></label>
        )}
        <div className="stepper-msg" data-demo="verdict">
          ~<b data-demo="tokens">{Math.round(shownTokens)}</b> tokens in context ·{' '}
          <span key={`${strategy}-${severity}-${lostFacts.length}-${hasSummary}`} className="om-swap">{message}</span>
        </div>
      </div>
      <p className="block-hint">Memory is a budget problem: every strategy trades <b>fidelity</b> against <b>tokens</b>. Shrink the window and watch the conversation break.</p>
    </div>
  );
}

/* ============ GuardrailsBlock: what happens when autonomy has no limits ============ */

const RAILS = {
  stepBudget: { label: 'Step budget', demo: 'rail-step-budget', desc: 'Hard cap on loop iterations. Stops infinite think→act cycles.' },
  toolAllow: { label: 'Tool allow-list', demo: 'rail-tool-allow', desc: 'The agent may only call approved tools — no arbitrary side effects.' },
  humanApproval: { label: 'Human approval', demo: 'rail-human-approval', desc: 'Risky actions (payments, deletions, emails) pause for a person.' },
  spendCap: { label: 'Spend cap', demo: 'rail-spend-cap', desc: 'Aborts the run when token/API cost crosses a threshold.' },
  observability: { label: 'Observability', demo: 'rail-observability', desc: 'Every thought, tool call and result is logged and traceable.' },
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
// What the run has done to the world once each line has executed (cumulative).
const EFFECTS = [
  { iter: 1, cost: 0.02, rows: 0 },
  { iter: 2, cost: 0.05, rows: 0 },
  { iter: 3, cost: 0.09, rows: 0 },
  { iter: 4, cost: 0.14, rows: 1284 },
  { iter: 6, cost: 0.31, rows: 1284 },
  { iter: 47, cost: 21.4, rows: 1284 },
  { iter: 47, cost: 38, rows: 1284 },
  { iter: 47, cost: 38, rows: 1284 },
];
const GR_FIRST_MS = 350; // first line appears quickly…
const GR_LINE_MS = 750;  // …then one line per beat

export function GuardrailsBlock() {
  const [on, setOn] = useState({ stepBudget: false, toolAllow: false, humanApproval: false, spendCap: false, observability: false });
  // Each revealed line is frozen with its verdict at the moment it ran, so toggling a
  // rail after the run can never relabel history.
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { stoppedBy, armedLater, rails } once a run ends
  const [runId, setRunId] = useState(0);
  const timer = useRef(null);
  const onRef = useRef(on);
  onRef.current = on;

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = () => {
    clearTimeout(timer.current);
    setLog([]);
    setResult(null);
    setRunning(true);
    setRunId((r) => r + 1);
    let i = -1;
    const tick = () => {
      i += 1;
      const s = SCRIPT[i];
      const rails = onRef.current; // rails are read live while the run is going
      const blocked = !!(s.risk && rails[s.rail]);
      const line = { i, blocked };
      setLog((l) => [...l, line]);
      if (blocked || i >= SCRIPT.length - 1) {
        setRunning(false);
        setResult({
          stoppedBy: blocked ? s.rail : null,
          armedLater: blocked ? SCRIPT.slice(i + 1).filter((x) => x.risk && rails[x.rail]).map((x) => x.rail) : [],
          rails: { ...rails },
        });
        return;
      }
      timer.current = setTimeout(tick, GR_LINE_MS);
    };
    timer.current = setTimeout(tick, GR_FIRST_MS);
  };

  const lastRan = [...log].reverse().find((l) => !l.blocked);
  const eff = lastRan ? EFFECTS[lastRan.i] : { iter: 0, cost: 0, rows: 0 };
  const iter = useTweenedNumber(eff.iter, { duration: 700 });
  const cost = useTweenedNumber(eff.cost, { duration: 700 });
  const rows = useTweenedNumber(eff.rows, { duration: 700 });
  const stale = result && !running && Object.keys(RAILS).some((k) => result.rails[k] !== on[k]);
  const phase = running ? 'running' : result ? (result.stoppedBy ? 'stopped' : 'failed') : 'idle';

  return (
    <div className="block-frame" data-running={running ? 'true' : 'false'} data-done={result ? 'true' : 'false'}
      data-phase={phase} data-stopped-by={result?.stoppedBy ?? ''} data-lines={log.length}>
      <div className="fb-wrap" style={{ gridTemplateColumns: '220px 1fr' }}>
        <div className="fb-palette">
          <h4>Guardrails</h4>
          {Object.entries(RAILS).map(([k, v]) => {
            const fired = result?.stoppedBy === k;
            return (
              <button key={k} className={`tool-pick ${on[k] ? 'on' : ''} ${fired ? 'om-gen-rail-fired' : ''}`}
                aria-pressed={on[k]} data-demo={v.demo} data-on={on[k] ? 'true' : 'false'} data-fired={fired ? 'true' : 'false'}
                onClick={() => setOn((s) => ({ ...s, [k]: !s[k] }))} title={v.desc}>
                <span className="box">{on[k] ? '✓' : ''}</span>{v.label}
              </button>
            );
          })}
        </div>
        <div>
          {/* what the agent has done so far: these climb while it runs */}
          <div className="om-gen-stats" aria-live="polite">
            <span>iterations <b data-demo="stat-iterations" className={eff.iter > 10 ? 'hot' : ''}>{Math.round(iter)}</b></span>
            <span>spent <b data-demo="stat-spend" className={eff.cost > 10 ? 'hot' : ''}>${cost.toFixed(2)}</b></span>
            <span>rows deleted <b data-demo="stat-rows" className={eff.rows > 0 ? 'hot' : ''}>{Math.round(rows).toLocaleString('en-US')}</b></span>
          </div>
          <div style={{ minHeight: 230 }}>
            {log.length === 0 && <p className="muted">Turn guardrails on or off, then run the agent and watch what it’s allowed to do.</p>}
            {log.map(({ i, blocked }) => {
              const s = SCRIPT[i];
              return (
                <div key={`${runId}-${i}`} className={`agent-step ${blocked ? 'fail om-gen-blocked' : s.risk ? 'act' : 'think'}`}
                  data-demo="log-line" data-idx={i} data-blocked={blocked ? 'true' : 'false'}>
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
            <button className="btn btn--primary" data-demo="run" onClick={run} disabled={running}>{running ? 'Running…' : '▶ Run the agent'}</button>
            <div className="stepper-msg" data-demo="verdict">
              <span key={phase} className="om-swap">
                {result?.stoppedBy
                  ? <span style={{ color: 'var(--kelp)' }}>Stopped safely by <b>{RAILS[result.stoppedBy].label}</b> — {RAILS[result.stoppedBy].desc}
                    {result.armedLater.length > 0 && ` (${result.armedLater.map((k) => RAILS[k].label).join(', ')} ${result.armedLater.length > 1 ? 'were' : 'was'} armed further down, too.)`}</span>
                  : result
                    ? <span style={{ color: 'var(--danger)' }}>With no guardrails the agent deleted 1,284 rows, looped 47 times, burned $38, and left no audit trail. This is the failure mode the source warns about.</span>
                    : 'Autonomy without limits is the risk — switch rails on and re-run.'}
              </span>
              {stale && <span className="muted"> Rails changed since this run — press Run again.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ MultiAgentBlock: centralized vs decentralized topologies ============ */

const MA_W = 620, MA_H = 280;
const MA_TICK = 1200;                         // one hop per beat
const MA_TRAVEL = { delay: 60, duration: 640 }; // packet flight inside each beat
const HUB = { x: MA_W / 2, y: MA_H / 2, r: 40 };
const WORKERS = [0, 1, 2, 3].map((i) => ({
  x: MA_W / 2 + Math.cos((i / 4) * Math.PI * 2 - Math.PI / 2) * 175,
  y: MA_H / 2 + Math.sin((i / 4) * Math.PI * 2 - Math.PI / 2) * 95,
  r: 32,
  label: `Agent ${i + 1}`,
}));
const SPOKES = WORKERS.map((w, i) => ({ id: `s${i}`, a: HUB, b: w }));
const MESH = WORKERS.flatMap((w, i) => WORKERS.slice(i + 1).map((w2, j) => ({ id: `m${i}${i + j + 1}`, a: w, b: w2 })));
// Peer-to-peer: two messages in flight at once; six beats cover every mesh link both ways.
const MATCHINGS = [[[0, 1], [2, 3]], [[1, 2], [3, 0]], [[0, 2], [1, 3]]];
const nodeAt = (k) => (k === 'hub' ? HUB : WORKERS[k]);

function hopsAt(mode, tick) {
  if (mode === 'centralized') {
    // the orchestrator hands a task to each agent in turn, and the result comes back
    const w = Math.floor(tick / 2) % 4;
    return tick % 2 === 0
      ? [{ from: 'hub', to: w, line: `s${w}`, reverse: false, kind: 'task' }]
      : [{ from: w, to: 'hub', line: `s${w}`, reverse: true, kind: 'result' }];
  }
  const flip = Math.floor(tick / 3) % 2 === 1;
  return MATCHINGS[tick % 3].map(([a, b]) => {
    const [from, to] = flip ? [b, a] : [a, b];
    return { from, to, line: `m${Math.min(from, to)}${Math.max(from, to)}`, reverse: from > to, kind: 'msg' };
  });
}

/** A point `t` of the way along a hop, from the sender's rim to the receiver's rim. */
function alongHop(h, t) {
  const A = nodeAt(h.from), B = nodeAt(h.to);
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
  const sx = A.x + (dx / L) * A.r, sy = A.y + (dy / L) * A.r;
  const ex = B.x - (dx / L) * B.r, ey = B.y - (dy / L) * B.r;
  return { x: sx + (ex - sx) * t, y: sy + (ey - sy) * t };
}

export function MultiAgentBlock() {
  const [mode, setMode] = useState('centralized');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTick((k) => k + 1), MA_TICK);
    return () => clearTimeout(t);
  }, [tick, mode]);
  const pick = (m) => {
    if (m === mode) return;
    setMode(m);
    setTick(0);
  };

  const central = mode === 'centralized';
  const hops = hopsAt(mode, tick);
  const p = useProgress(`${mode}:${tick}`, MA_TRAVEL);
  const k = ease.inOutCubic(p);
  const arrived = p >= 1;
  const hot = new Map(hops.map((h) => [h.line, h]));
  const receivers = new Set(arrived ? hops.map((h) => h.to) : []);
  const lineClass = (id, active) => {
    const h = active && hot.get(id);
    return h ? `flow-anim om-flow-hot ${h.reverse ? 'om-flow-reverse' : ''}` : '';
  };

  return (
    <div className="block-frame" data-running="true" data-done="false" data-phase={mode} data-tick={tick}>
      <div className="seg" role="group" aria-label="Topology">
        <button className={central ? 'on' : ''} aria-pressed={central} data-demo="topology-centralized" onClick={() => pick('centralized')}>Centralized (orchestrator)</button>
        <button className={!central ? 'on' : ''} aria-pressed={!central} data-demo="topology-decentralized" onClick={() => pick('decentralized')}>Decentralized (peer-to-peer)</button>
      </div>
      <svg className="viz-svg" viewBox={`0 0 ${MA_W} ${MA_H}`} style={{ marginTop: '0.6rem' }} role="img" aria-label="Multi-agent topology">
        {/* both topologies stay mounted and crossfade */}
        <g className="om-gen-ma-set" style={{ opacity: central ? 1 : 0 }}>
          {SPOKES.map((e) => (
            <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="rgba(127,216,232,0.45)" strokeWidth="2" className={lineClass(e.id, central)} />
          ))}
        </g>
        <g className="om-gen-ma-set" style={{ opacity: central ? 0 : 1 }}>
          {MESH.map((e) => (
            <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="rgba(127,216,232,0.45)" strokeWidth="2" className={lineClass(e.id, !central)} />
          ))}
        </g>
        <g className={`om-gen-ma-hub om-gen-fillbox ${central ? '' : 'off'}`} aria-hidden={!central} data-demo="orchestrator"
          data-receiving={central && receivers.has('hub') ? 'true' : 'false'}>
          <circle cx={HUB.x} cy={HUB.y} r={HUB.r} fill="rgba(22,184,216,0.25)" stroke="#2acbe9" strokeWidth="2.4" className="glow" />
          {central && receivers.has('hub') && (
            <circle key={`ring-${tick}`} cx={HUB.x} cy={HUB.y} r={HUB.r} fill="none" stroke="#35d0a5" strokeWidth="2" className="om-gen-ring" />
          )}
          <text x={HUB.x} y={HUB.y + 4} textAnchor="middle" fill="#fff" fontSize="11">Orchestrator</text>
        </g>
        {WORKERS.map((w, i) => {
          const recv = receivers.has(i);
          return (
            <g key={i} data-demo={`agent-${i + 1}`} data-receiving={recv ? 'true' : 'false'}>
              <circle cx={w.x} cy={w.y} r={w.r} fill="rgba(8,26,42,0.92)"
                stroke={recv ? '#7fd8e8' : 'rgba(127,216,232,0.55)'} strokeWidth={recv ? 2.4 : 1.5} className="om-gen-loop-dot" />
              {recv && <circle key={`ring-${mode}-${tick}`} cx={w.x} cy={w.y} r={w.r} fill="none" stroke="#7fd8e8" strokeWidth="2" className="om-gen-ring" />}
              <text x={w.x} y={w.y + 4} textAnchor="middle" fill={recv ? '#fff' : '#9db8c6'} fontSize="10.5">{w.label}</text>
            </g>
          );
        })}
        {/* message packets in flight */}
        {p > 0 && !arrived && hops.map((h, i) => {
          const pt = alongHop(h, k);
          return (
            <g key={`${mode}-${tick}-${i}`} className="om-gen-token" style={{ color: h.kind === 'result' ? '#35d0a5' : '#2ee6ff' }} data-demo="packet">
              <circle cx={pt.x} cy={pt.y} r="6" fill="currentColor" />
              <text x={pt.x} y={pt.y - 11} textAnchor="middle" fill="#9db8c6" fontSize="9" className="om-gen-halo">{h.kind}</text>
            </g>
          );
        })}
      </svg>
      <div key={mode} className="dg-detail" data-demo="detail">
        {central
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
  workflow: { label: 'Use a fixed workflow', short: 'Workflow', color: '#35d0a5', text: 'Predictable steps → prompt chaining or plain code. Cheaper, faster, fully testable. The source is blunt: use the simplest thing that works, and only add agentic complexity when it pays for itself.' },
  agent: { label: 'An agent is justified', short: 'Agent', color: '#2ee6ff', text: 'Open-ended, decision-dependent work with tolerable failure cost — this is where autonomous loops genuinely beat fixed pipelines.' },
  'workflow-hitl': { label: 'Workflow + human in the loop', short: 'Workflow + HITL', color: '#ffce6b', text: 'The task is dynamic but mistakes are expensive. Keep the loop, but gate risky actions behind human approval.' },
};
const WVA_SWAP_MS = 200; // the answered question slides out before the next slides in

/** The route taken so far: one dot per question, then the verdict it led to. */
function DecisionPath({ trail, idx, verdict }) {
  const X = [58, 178, 298, 418], VX = 548, Y = 24;
  const answered = trail.length;
  const reached = verdict ? answered : answered + 1; // dots on the route, incl. the open question
  const vc = verdict ? VERDICTS[verdict].color : null;
  const from = X[Math.max(0, answered - 1)];
  const exitD = answered >= 4
    ? `M${from + 11} ${Y} L${VX - 62} ${Y}`
    : `M${from} ${Y + 10} C ${from + 34} ${Y + 30}, ${VX - 96} ${Y + 30}, ${VX - 60} ${Y + 5}`;
  return (
    <svg className="viz-svg om-gen-path" viewBox="0 0 620 56" role="img" data-demo="path"
      aria-label={`Decision path: ${trail.map((t, i) => `Q${i + 1} ${t.a}`).join(', ') || 'not started'}${verdict ? ` → ${VERDICTS[verdict].short}` : ''}`}>
      <line x1={X[0]} y1={Y} x2={X[3]} y2={Y} stroke="rgba(127,216,232,0.14)" strokeWidth="2" />
      <line x1={X[3] + 11} y1={Y} x2={VX - 62} y2={Y} stroke="rgba(127,216,232,0.1)" strokeWidth="2" strokeDasharray="3 5" />
      {X.slice(0, Math.max(0, reached - 1)).map((x, i) => (
        <path key={`seg${i}`} d={`M${x + 11} ${Y} L${X[i + 1] - 11} ${Y}`} stroke="#7fd8e8" strokeWidth="2" fill="none"
          pathLength="1" className="om-draw-in" style={{ animationDuration: '0.4s' }} />
      ))}
      {verdict && (
        <path key={`exit-${verdict}`} d={exitD} stroke={vc} strokeWidth="2" fill="none" pathLength="1" className="om-draw-in"
          style={{ animationDuration: '0.45s' }} />
      )}
      {X.map((x, i) => {
        const t = trail[i];
        const now = !verdict && i === idx;
        const skipped = verdict && i >= answered;
        const yes = t?.a === 'Yes';
        return (
          <g key={i} className="om-gen-fade" style={{ opacity: skipped ? 0.28 : 1 }}>
            <circle cx={x} cy={Y} r={now ? 11 : 9}
              fill={t ? (yes ? 'rgba(22,184,216,0.35)' : 'rgba(157,184,198,0.16)') : 'rgba(8,26,42,0.9)'}
              stroke={t ? (yes ? '#2acbe9' : '#9db8c6') : now ? '#2acbe9' : 'rgba(127,216,232,0.3)'}
              strokeWidth={now ? 2 : 1.3} className={`om-gen-loop-dot ${now ? 'glow' : ''}`} />
            <text x={x} y={Y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight={t ? 700 : 400}
              fill={t || now ? '#fff' : '#5d7a8c'}>{t ? t.a[0] : `Q${i + 1}`}</text>
          </g>
        );
      })}
      {verdict ? (
        <g key={verdict} className="om-pop om-gen-fillbox">
          <rect x={VX - 60} y={Y - 14} width="120" height="28" rx="14" fill={`${vc}26`} stroke={vc} strokeWidth="1.6" />
          <text x={VX} y={Y + 4} textAnchor="middle" fill={vc} fontSize="11" fontWeight="700">{VERDICTS[verdict].short}</text>
        </g>
      ) : (
        <g>
          <rect x={VX - 60} y={Y - 14} width="120" height="28" rx="14" fill="none" stroke="rgba(127,216,232,0.22)" strokeDasharray="4 4" />
          <text x={VX} y={Y + 4} textAnchor="middle" fill="#5d7a8c" fontSize="10.5">verdict ?</text>
        </g>
      )}
    </svg>
  );
}

export function WorkflowVsAgentBlock() {
  const [idx, setIdx] = useState(0);
  const [verdict, setVerdict] = useState(null);
  const [trail, setTrail] = useState([]);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const answer = (a) => {
    if (busy.current || verdict) return;
    busy.current = true;
    const q = QUESTIONS[idx];
    const next = a ? q.yes : q.no;
    setTrail((t) => [...t, { q: q.q, a: a ? 'Yes' : 'No' }]);
    setLeaving(true);
    timer.current = setTimeout(() => {
      if (next === 'next') {
        if (idx + 1 >= QUESTIONS.length) setVerdict('agent');
        else setIdx(idx + 1);
      } else setVerdict(next);
      setLeaving(false);
      busy.current = false;
    }, WVA_SWAP_MS);
  };
  const reset = () => {
    clearTimeout(timer.current);
    busy.current = false;
    setLeaving(false);
    setIdx(0);
    setVerdict(null);
    setTrail([]);
  };
  const v = verdict ? VERDICTS[verdict] : null;

  return (
    <div className="block-frame" data-running={leaving ? 'true' : 'false'} data-done={verdict ? 'true' : 'false'}
      data-phase={verdict ? 'verdict' : `q${idx + 1}`} data-verdict={verdict ?? ''} data-answers={trail.map((t) => t.a[0]).join('')}>
      <DecisionPath trail={trail} idx={idx} verdict={verdict} />
      {trail.map((t, i) => (
        <div key={i} className="mem-line full om-gen-trail-row" data-demo="trail-row" data-idx={i}>
          <b style={{ color: 'var(--accent-soft)' }}>{t.a}</b> — {t.q}
        </div>
      ))}
      {!verdict ? (
        <div key={idx} className={`om-gen-q ${leaving ? 'leaving' : ''}`}>
          <h3 className="walk-title" style={{ fontSize: '1.15rem', marginTop: '0.8rem' }} data-demo="question">{QUESTIONS[idx].q}</h3>
          <div className="stepper-row">
            <button className="btn btn--primary" data-demo="answer-yes" onClick={() => answer(true)}>Yes</button>
            <button className="btn" data-demo="answer-no" onClick={() => answer(false)}>No</button>
            <span className="muted">question {idx + 1} of {QUESTIONS.length}</span>
          </div>
        </div>
      ) : (
        <div key={verdict} className="dg-detail om-gen-verdict" data-demo="verdict"
          style={{ borderLeftColor: v.color, '--om-gen-glow': `${v.color}55` }}>
          <b style={{ color: v.color }}>{v.label}</b> — {v.text}
          <div className="stepper-row"><button className="btn btn--ghost" data-demo="restart" onClick={reset}>↺ Run it again</button></div>
        </div>
      )}
      <p className="block-hint">Answer honestly about your own project — the most common mistake in the source is reaching for an autonomous agent when a fixed workflow would be cheaper, faster and safer.</p>
    </div>
  );
}
