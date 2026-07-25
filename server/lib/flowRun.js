/**
 * Executes a learner-built agent flow for real: topological order, LLM nodes
 * call the connected model, tool nodes run server-side. Cycles and oversized
 * flows are rejected with friendly errors.
 */
import { aiChat } from '../ai.js';
import { runTool } from './agentTools.js';

export function validateFlow(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) return 'The flow has no steps.';
  if (nodes.length > 12) return 'Flows are limited to 12 steps in the MVP.';
  if (!Array.isArray(edges) || edges.length > 24) return 'Too many connections.';
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return 'Duplicate step ids.';
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return 'A wire points at a missing step.';
  }
  if (!nodes.some((n) => n.type === 'trigger')) return 'Every flow needs a ⚡ Trigger step to start from.';
  for (const n of nodes) {
    if (!['trigger', 'llm', 'tool', 'output'].includes(n.type)) return `Unknown step type "${n.type}".`;
  }
  return null;
}

/** Kahn topological sort; returns null when the flow has a cycle. */
function topoOrder(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of edges) {
      if (e.from !== id) continue;
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  return order.length === nodes.length ? order : null;
}

export async function runFlow(nodes, edges, input) {
  const problem = validateFlow(nodes, edges);
  if (problem) return { trace: [], error: problem };
  const order = topoOrder(nodes, edges);
  if (!order) return { trace: [], error: 'This flow has a loop — data must move forward. Remove the circular wire.' };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outputs = new Map();
  const notes = [];
  const trace = [];
  let error = null;

  for (const id of order) {
    const node = byId.get(id);
    const upstream = edges.filter((e) => e.to === id).map((e) => outputs.get(e.from)).filter(Boolean);
    const nodeInput = upstream.length ? upstream.join('\n\n') : String(input ?? '');
    let out;
    let status = 'ok';
    try {
      if (node.type === 'trigger') {
        out = String(input ?? '').slice(0, 2000) || '(empty input)';
      } else if (node.type === 'llm') {
        out = await aiChat(
          `You are one step inside a small automation flow named "${node.config?.label ?? 'LLM step'}". Do exactly your job, concisely (under 150 words). Your instruction: ${String(node.config?.prompt ?? '').slice(0, 600)}`,
          [{ role: 'user', content: nodeInput.slice(0, 6000) }],
          { maxTokens: 1200 }
        );
      } else if (node.type === 'tool') {
        out = runTool(node.config?.tool, nodeInput.slice(0, 400), { topicId: 'ai-agents', notes });
      } else {
        out = nodeInput; // output node collects
      }
    } catch (e) {
      status = 'error';
      out = e.message;
      error = `Step "${node.config?.label ?? node.id}" failed: ${e.message}`;
    }
    outputs.set(id, String(out));
    trace.push({ id, status, output: String(out).slice(0, 1500) });
    if (error) break;
  }
  return { trace, error };
}
