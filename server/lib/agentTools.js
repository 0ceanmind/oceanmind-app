/**
 * Tools the in-lesson agent can ACTUALLY execute. The LLM makes every
 * decision; these functions carry them out and return real observations.
 */
import { topChunks } from './retrieval.js';

export const AGENT_TOOLS = {
  calculator: {
    name: 'Calculator',
    icon: '🧮',
    description: 'Evaluate an arithmetic expression, e.g. "1200 + 80*8". Supports + - * / ( ) . %',
    run(input) {
      const expr = String(input ?? '').trim();
      if (!/^[\d+\-*/().\s%]+$/.test(expr) || expr.length > 120) {
        return `Calculator error: "${expr.slice(0, 40)}" is not a plain arithmetic expression.`;
      }
      try {
        // expression is regex-restricted to arithmetic characters only
        const value = Function(`"use strict"; return (${expr.replaceAll('%', '/100')});`)();
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'Calculator error: expression did not produce a number.';
        return `${expr} = ${Math.round(value * 10000) / 10000}`;
      } catch {
        return `Calculator error: could not evaluate "${expr.slice(0, 40)}".`;
      }
    },
  },
  docsearch: {
    name: 'Document search',
    icon: '🔎',
    description: 'Search the course source documents for a phrase and get the most relevant passages back.',
    run(input, ctx) {
      const q = String(input ?? '').trim();
      if (!q) return 'Search error: empty query.';
      const found = topChunks(ctx.topicId, q, 900);
      return found ? `Top passages for "${q}":\n${found}` : `No passages found for "${q}".`;
    },
  },
  notes: {
    name: 'Notes',
    icon: '📝',
    description: 'Append a note to the scratchpad. Input is the note text.',
    run(input, ctx) {
      const note = String(input ?? '').trim().slice(0, 300);
      if (!note) return 'Notes error: nothing to save.';
      ctx.notes.push(note);
      return `Saved note #${ctx.notes.length}: "${note}"`;
    },
  },
  clock: {
    name: 'Clock',
    icon: '🕐',
    description: 'Get the current date and time.',
    run() {
      return `Current time: ${new Date().toString()}`;
    },
  },
};

/** Execute one tool call; always returns an observation string. */
export function runTool(toolId, input, ctx) {
  const tool = AGENT_TOOLS[toolId];
  if (!tool) return `Unknown tool "${toolId}" — available: ${Object.keys(AGENT_TOOLS).join(', ')}.`;
  try {
    return tool.run(input, ctx);
  } catch (e) {
    return `Tool "${toolId}" crashed: ${e.message}`;
  }
}
