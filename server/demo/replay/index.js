/**
 * The pitch-demo replay corpus, one module per topic (written by the corpus
 * team; see each file). Every export is pure and deterministic and returns
 * plain values that pass the real validators on the first attempt; the
 * replay provider (server/aireplay.js) stringifies them like a model reply.
 * Static imports on purpose: serverless bundlers trace these files.
 */
import aiAgents from './ai-agents.js';
import neuralNetworks from './neural-networks.js';
import chatbots from './chatbots.js';

export const CORPUS = {
  'ai-agents': aiAgents,
  'neural-networks': neuralNetworks,
  chatbots,
};

/** The corpus for a topic id, or null. */
export function getCorpus(topicId) {
  return CORPUS[topicId] ?? null;
}
