import { useState } from 'react';
import { DiagramBlock } from './DiagramBlocks.jsx';

/**
 * The agent architecture patterns from the source whitepaper, as one
 * interactive explorer: pick a pattern, see its animated diagram, when to use
 * it, and its tradeoff.
 */
const PATTERNS = {
  'augmented-llm': {
    label: 'Augmented LLM',
    use: 'The basic building block: one model call, strengthened with retrieval, tools, and memory.',
    tradeoff: 'Simple and cheap — but a single call can’t decompose or verify complex work.',
    nodes: [
      { id: 'in', label: 'Input', detail: 'The user request.' },
      { id: 'llm', label: 'LLM', detail: 'One model call, augmented with retrieval, tools, and memory.' },
      { id: 'ret', label: 'Retrieval', detail: 'Pulls relevant documents into context.' },
      { id: 'tools', label: 'Tools', detail: 'Functions the model may call.' },
      { id: 'out', label: 'Output', detail: 'The final answer.' },
    ],
    edges: [
      { from: 'in', to: 'llm' }, { from: 'ret', to: 'llm' }, { from: 'tools', to: 'llm' }, { from: 'llm', to: 'out' },
    ],
  },
  chaining: {
    label: 'Prompt chaining',
    use: 'Decompose a task into fixed sequential steps, each LLM call handling one — with optional gates checking intermediate output.',
    tradeoff: 'More accurate per step, but latency adds up and the sequence is fixed at design time.',
    nodes: [
      { id: 'in', label: 'Input' },
      { id: 's1', label: 'LLM: outline', detail: 'First subtask.' },
      { id: 'gate', label: 'Gate ✓', detail: 'Programmatic check on intermediate output — fail fast, cheap.' },
      { id: 's2', label: 'LLM: write', detail: 'Second subtask builds on the first.' },
      { id: 'out', label: 'Output' },
    ],
    edges: [{ from: 'in', to: 's1' }, { from: 's1', to: 'gate' }, { from: 'gate', to: 's2' }, { from: 's2', to: 'out' }],
  },
  routing: {
    label: 'Routing',
    use: 'Classify the input first, then send it to a specialized handler — separate prompts for refunds vs. tech support, small models for easy questions.',
    tradeoff: 'Great separation of concerns; needs a reliable classifier up front.',
    nodes: [
      { id: 'in', label: 'Input' },
      { id: 'router', label: 'Router LLM', detail: 'Classifies the request type.' },
      { id: 'a', label: 'Specialist A', detail: 'e.g. refund handler with its own prompt.' },
      { id: 'b', label: 'Specialist B', detail: 'e.g. technical support handler.' },
      { id: 'out', label: 'Output' },
    ],
    edges: [{ from: 'in', to: 'router' }, { from: 'router', to: 'a', label: 'type A' }, { from: 'router', to: 'b', label: 'type B' }, { from: 'a', to: 'out' }, { from: 'b', to: 'out' }],
  },
  parallel: {
    label: 'Parallelization',
    use: 'Run several LLM calls at once — either splitting the task into independent sections, or voting: same task many times, aggregate the answers.',
    tradeoff: 'Fast and robust to single-call errors; costs multiply with each parallel branch.',
    nodes: [
      { id: 'in', label: 'Input' },
      { id: 'p1', label: 'LLM ①', detail: 'Independent section or vote #1.' },
      { id: 'p2', label: 'LLM ②', detail: 'Independent section or vote #2.' },
      { id: 'p3', label: 'LLM ③', detail: 'Independent section or vote #3.' },
      { id: 'agg', label: 'Aggregator', detail: 'Merges sections or tallies the votes.' },
    ],
    edges: [{ from: 'in', to: 'p1' }, { from: 'in', to: 'p2' }, { from: 'in', to: 'p3' }, { from: 'p1', to: 'agg' }, { from: 'p2', to: 'agg' }, { from: 'p3', to: 'agg' }],
  },
  orchestrator: {
    label: 'Orchestrator–workers',
    use: 'A central LLM dynamically breaks the task down and delegates to worker LLMs — the subtasks aren’t known in advance.',
    tradeoff: 'Handles unpredictable, multi-part work; the orchestrator becomes the quality bottleneck.',
    nodes: [
      { id: 'in', label: 'Task' },
      { id: 'orch', label: 'Orchestrator', detail: 'Plans subtasks on the fly and assigns them.' },
      { id: 'w1', label: 'Worker ①', detail: 'Executes one delegated subtask.' },
      { id: 'w2', label: 'Worker ②', detail: 'Executes another in parallel.' },
      { id: 'synth', label: 'Synthesizer', detail: 'Combines worker results into the final output.' },
    ],
    edges: [{ from: 'in', to: 'orch' }, { from: 'orch', to: 'w1' }, { from: 'orch', to: 'w2' }, { from: 'w1', to: 'synth' }, { from: 'w2', to: 'synth' }],
  },
  evaluator: {
    label: 'Evaluator–optimizer',
    use: 'One LLM generates, another evaluates against criteria and demands revisions — a loop until the output passes.',
    tradeoff: 'Big quality gains when good evaluation criteria exist; each round costs another call.',
    nodes: [
      { id: 'in', label: 'Input' },
      { id: 'gen', label: 'Generator', detail: 'Produces a draft.' },
      { id: 'eval', label: 'Evaluator', detail: 'Scores the draft against explicit criteria; sends feedback back.' },
      { id: 'out', label: 'Accepted ✓', detail: 'Only outputs that pass evaluation get through.' },
    ],
    edges: [{ from: 'in', to: 'gen' }, { from: 'gen', to: 'eval' }, { from: 'eval', to: 'gen', label: 'revise' }, { from: 'eval', to: 'out', label: 'pass' }],
  },
  agent: {
    label: 'Autonomous agent',
    use: 'The model plans, acts with tools, observes real results, and loops — deciding its own path until the goal is done, with guardrails and step budgets.',
    tradeoff: 'Maximum flexibility for open-ended tasks; needs sandboxing, budgets, and human checkpoints for safety.',
    nodes: [
      { id: 'goal', label: 'Goal' },
      { id: 'llm', label: 'LLM plan', detail: 'Thinks: decides the next action.' },
      { id: 'act', label: 'Tool action', detail: 'Acts on the real environment.' },
      { id: 'env', label: 'Environment', detail: 'Returns real feedback — success, data, or errors.' },
      { id: 'done', label: 'Done ✓', detail: 'Loop exits when the goal is met or budget runs out.' },
    ],
    edges: [{ from: 'goal', to: 'llm' }, { from: 'llm', to: 'act' }, { from: 'act', to: 'env' }, { from: 'env', to: 'llm', label: 'observe' }, { from: 'llm', to: 'done', label: 'goal met' }],
  },
};

export default function PatternExplorerBlock({ initial = 'chaining' }) {
  const [sel, setSel] = useState(PATTERNS[initial] ? initial : 'chaining');
  const p = PATTERNS[sel];
  return (
    <div className="block-frame">
      <div className="suggest-row" style={{ marginTop: 0, marginBottom: '0.6rem' }}>
        {Object.entries(PATTERNS).map(([k, v]) => (
          <button key={k} className="suggest-pill" onClick={() => setSel(k)}
            style={sel === k ? { borderColor: 'var(--accent)', color: 'var(--accent-soft)', background: 'rgba(22,184,216,0.1)' } : {}}>
            {v.label}
          </button>
        ))}
      </div>
      <DiagramBlock key={sel} nodes={p.nodes} edges={p.edges} bare />
      <div className="dg-detail">
        <b>When to use:</b> {p.use}<br />
        <b>Tradeoff:</b> {p.tradeoff}
      </div>
    </div>
  );
}
