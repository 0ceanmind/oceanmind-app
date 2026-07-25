/**
 * Topic metadata for the three MVP topics. All learning CONTENT (knowledge
 * maps, questions, lessons) is generated per-session by the connected LLM,
 * grounded in the resource files in ./resources. What lives here is only
 * identity + the interactive widget each topic ships and its per-zone tuning.
 */

export const ZONES = {
  sunlight: { id: 'sunlight', label: 'Sunlight Zone', range: '0–200 m', levelLabel: 'Beginner' },
  twilight: { id: 'twilight', label: 'Twilight Zone', range: '200–1,000 m', levelLabel: 'Intermediate' },
  midnight: { id: 'midnight', label: 'Midnight Zone', range: '1,000–4,000 m', levelLabel: 'Advanced' },
};

export const TOPICS = [
  {
    id: 'neural-networks',
    title: 'Neural Networks',
    icon: 'network',
    tagline: 'Train a real neural network with your own hands.',
    widget: 'nn-playground',
    widgetDescription:
      'An in-browser trainable neural network: the learner places 2-D data points, trains a real MLP live, watches the decision boundary move, and can change dataset, hidden layers, and learning rate.',
    widgetConfig: {
      sunlight: { dataset: 'blobs', hidden: [4], lr: 0.03, showLayers: false, showLR: true },
      twilight: { dataset: 'circle', hidden: [6], lr: 0.03, showLayers: true, showLR: true },
      midnight: { dataset: 'spiral', hidden: [8, 8], lr: 0.05, showLayers: true, showLR: true },
    },
  },
  {
    id: 'ai-agents',
    title: 'AI Agents',
    icon: 'agent',
    tagline: 'Build an agent, hand it tools, and watch it think for real.',
    widget: 'agent-runner',
    widgetDescription:
      'A live agent the learner assembles: they set a goal and a toolkit, and the connected LLM actually runs the think→act→observe loop — every decision is generated, tools are really executed.',
    widgetConfig: {
      sunlight: { maxSteps: 8 },
      twilight: { maxSteps: 10 },
      midnight: { maxSteps: 14 },
    },
  },
  {
    id: 'chatbots',
    title: 'Chatbots',
    icon: 'chat',
    tagline: 'Build a working chatbot and chat with it live.',
    widget: 'chatbot-builder',
    widgetDescription:
      'A chatbot builder: the learner authors intents (patterns → replies) for a rule-based bot and chats with it; side-by-side, an LLM bot built from the same knowledge answers via the connected model.',
    widgetConfig: {
      sunlight: { starterIntents: 'basic', showMatching: false, liveCompare: false },
      twilight: { starterIntents: 'basic', showMatching: true, liveCompare: true },
      midnight: { starterIntents: 'extended', showMatching: true, liveCompare: true },
    },
  },
];

export function getTopic(id) {
  return TOPICS.find((t) => t.id === id) ?? null;
}
