/** Match free-text "what do you want to learn" input to one of the 3 MVP topics. */

const KEYWORDS = {
  'neural-networks': [
    'neural', 'network', 'networks', 'deep learning', 'deeplearning', 'mlp',
    'perceptron', 'backprop', 'backpropagation', 'cnn', 'rnn', 'layers',
    'neuron', 'neurons', 'gradient', 'weights', 'training models', 'nn',
  ],
  'ai-agents': [
    'agent', 'agents', 'agentic', 'autonomous', 'tool use', 'tools',
    'mcp', 'multi-agent', 'multiagent', 'workflow', 'automation',
    'assistant that acts', 'planning', 'autogpt',
  ],
  chatbots: [
    'chatbot', 'chatbots', 'chat bot', 'bot', 'bots', 'conversation',
    'conversational', 'customer support', 'support bot', 'assistant',
    'talking ai', 'dialogue', 'messaging', 'chat',
  ],
};

/**
 * Returns the best-matching topic id, or null when nothing matches.
 * Longer keyword hits weigh more (e.g. "deep learning" beats "chat").
 */
export function matchTopic(text) {
  if (!text || typeof text !== 'string') return null;
  const input = ` ${text.toLowerCase().trim()} `;
  if (input.trim().length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const [topicId, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const w of words) {
      // word-boundary-ish check to avoid "bot" matching inside "robotics" scoring chat too high
      const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`);
      if (re.test(input)) score += w.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = topicId;
    }
  }
  return best;
}
