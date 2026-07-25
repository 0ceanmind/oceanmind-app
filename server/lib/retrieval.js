/**
 * Lightweight retrieval over the topic resource files (the uploaded PDFs,
 * extracted to text). Chunks by paragraph, scores by keyword overlap, and
 * returns the best chunks within a character budget — used to ground every
 * generation call in the actual source material.
 */
import { RESOURCES } from '../content/resourcesData.js';

const cache = new Map();

const STOP = new Set(
  'the a an and or of to in on for with is are was were be been it its this that these those as at by from into over under how what why when which who not no can could should would will do does'.split(' ')
);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z-]+/g) ?? []).filter((w) => !STOP.has(w));
}

export function loadResource(topicId) {
  if (cache.has(topicId)) return cache.get(topicId);
  const raw = RESOURCES[topicId];
  if (!raw) {
    cache.set(topicId, null);
    return null;
  }
  // paragraph chunks, merged up to ~700 chars so slide bullets stay together
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > 700 && cur) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  const indexed = chunks.map((text) => ({ text, tokens: new Set(tokenize(text)) }));
  cache.set(topicId, indexed);
  return indexed;
}

/**
 * Best-matching resource excerpts for a query, within maxChars.
 * Falls back to the leading chunks when the query matches nothing.
 */
export function topChunks(topicId, query, maxChars = 6000) {
  const chunks = loadResource(topicId);
  if (!chunks || chunks.length === 0) return '';
  const qTokens = tokenize(query);
  const scored = chunks.map((c, i) => {
    let score = 0;
    for (const t of qTokens) if (c.tokens.has(t)) score++;
    return { i, score, text: c.text };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = [];
  let used = 0;
  const pool = scored[0]?.score === 0 ? scored.sort((a, b) => a.i - b.i) : scored;
  for (const c of pool) {
    if (used + c.text.length > maxChars) continue;
    picked.push(c);
    used += c.text.length;
    if (used > maxChars * 0.9) break;
  }
  // restore document order for readability
  picked.sort((a, b) => a.i - b.i);
  return picked.map((c) => c.text).join('\n\n---\n\n');
}
