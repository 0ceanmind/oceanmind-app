/**
 * Deterministic mock provider — ONLY active when OCEANMIND_TEST_AI=1.
 * Exists so automated tests can exercise the real pipeline (prompt → JSON →
 * validation → storage → UI) without a network or a paid key. It is never
 * used in normal operation; without a configured key the app requires setup.
 *
 * Generation prompts embed a "TASK: <name>" marker that this mock switches on.
 */

export function mockChat(system, messages) {
  const prompt = `${system}\n${messages.map((m) => m.content).join('\n')}`;
  const task = prompt.match(/TASK:\s*([a-z_]+)/)?.[1];

  if (task === 'knowledge_map') {
    return JSON.stringify({
      mustKnow: [
        { name: 'Core concept A', desc: 'The first thing you cannot skip.' },
        { name: 'Core concept B', desc: 'The second load-bearing idea.' },
        { name: 'Core concept C', desc: 'The mechanism that ties A and B together.' },
        { name: 'Core concept D', desc: 'How it behaves in practice.' },
      ],
      needToKnow: [
        { name: 'Deeper concept E', desc: 'Sharpens understanding of A.' },
        { name: 'Deeper concept F', desc: 'The common failure mode.' },
        { name: 'Deeper concept G', desc: 'How practitioners evaluate it.' },
      ],
    });
  }

  if (task === 'questions') {
    return JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({
        text: `Mock question ${i + 1}: which option is correct?`,
        concept: `Core concept ${'ABCDEF'[i] ?? 'A'}`,
        options: ['The correct answer', 'A plausible distractor', 'Another distractor', 'A clearly wrong option'],
        correctIndex: 0,
        explanation: `Explanation ${i + 1}: the first option is right because the resource says so.`,
      }))
    );
  }

  if (task === 'lesson') {
    const isNN = prompt.includes('Neural Networks');
    const isAgents = prompt.includes('AI Agents');
    const blockA = isNN ? { type: 'neuron' } : isAgents ? { type: 'agent-loop' } : { type: 'chatbot-builder' };
    const blockB = isNN
      ? { type: 'nn-playground' }
      : isAgents
        ? { type: 'flow-builder', template: prompt.includes('marketing') ? 'marketing' : 'starter', goalHint: 'test the flow' }
        : { type: 'diagram', nodes: [{ id: 'a', label: 'User message', detail: 'Incoming text.' }, { id: 'b', label: 'Matcher', detail: 'Scores intents.' }, { id: 'c', label: 'Reply', detail: 'Best response.' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };
    return JSON.stringify({
      title: prompt.includes('STATED GOAL') ? 'Mock redesigned lesson around your goal' : 'Mock interactive lesson',
      intro: 'A personalized mock lesson intro referencing your gaps.',
      steps: [
        { title: 'See it live', body: 'Play with this **interactive** block and notice the output change.', block: blockA },
        {
          title: 'Quick check', body: 'Confirm you got it.',
          block: { type: 'check', question: { text: 'Mock check: pick the right one', options: ['Right', 'Wrong', 'Also wrong'], correctIndex: 0, explanation: 'Right is right.' } },
        },
        { title: 'Build it yourself', body: 'Now build one with your own hands.', block: blockB },
        { title: 'Wrapping up', body: 'Final synthesis of the walkthrough.' },
      ],
    });
  }

  if (task === 'expand_steps') {
    // use a simulator (authorable mini-app) so expansion always brings something new
    return JSON.stringify({
      steps: [
        {
          title: 'Deeper: the objective function itself',
          body: 'Drag the sliders and watch the squared error curve respond to your prediction.',
          block: {
            type: 'simulator', title: 'Objective function J', expr: '(y - (w*x + b))^2', xVar: 'x', xRange: [-3, 3],
            vars: [{ name: 'w', min: -2, max: 2, init: 1, step: 0.1 }, { name: 'b', min: -2, max: 2, init: 0, step: 0.1 }, { name: 'y', min: -2, max: 2, init: 1, step: 0.1 }],
            yLabel: 'squared error',
          },
        },
        {
          title: 'Check the clarification', body: 'Did that land?',
          block: { type: 'check', question: { text: 'Clarified now?', options: ['Yes', 'No', 'Maybe'], correctIndex: 0, explanation: 'Great.' } },
        },
      ],
    });
  }

  if (task === 'tutor_decide') {
    // scan only the CONVERSATION section, not the prompt's own instructions
    const convo = prompt.match(/CONVERSATION[^\n]*\n([\s\S]*?)\n\s*SOURCE MATERIAL/);
    const userText = (convo ? convo[1] : '').toLowerCase();
    if (userText.includes('marketing') || userText.includes('my company') || userText.includes('i want to build')) {
      return JSON.stringify({ action: 'redesign', goal: 'build a marketing AI agent for their company', reply: 'Love it — rebuilding your experience around that goal now. 🌊' });
    }
    if (userText.includes('step by step') || userText.includes('clarify') || userText.includes('more detail')) {
      return JSON.stringify({ action: 'expand', about: 'the requested concept, step by step', reply: 'Adding a step-by-step interactive walkthrough right after this step. 🤿' });
    }
    return JSON.stringify({ action: 'answer', reply: 'Mock guide answer: here is a short, grounded explanation.' });
  }

  if (task === 'summary') {
    return JSON.stringify({
      headline: 'You dove deep and came back with real treasure.',
      learned: ['You now understand mock concept A.', 'You closed your gap on concept B.', 'You can explain concept C.'],
      built: ['You trained an interactive model live.', 'You wired and ran a working flow.'],
      nextSteps: ['Try the next depth zone.', 'Rebuild your flow with an extra tool.'],
    });
  }

  if (task === 'integration_guide') {
    return 'Mock **integration guide**:\n- Map each node to a function\n- Call your provider API for LLM steps\n- Loop the JSON in a runner\n- Test end-to-end';
  }

  if (task === 'agent_step') {
    const already = (prompt.match(/OBSERVATION/g) ?? []).length;
    if (already >= 2) {
      return JSON.stringify({ thought: 'I have everything I need to finish.', done: true, final: 'Goal accomplished using the gathered results.' });
    }
    return JSON.stringify({
      thought: `I should use a tool next (step ${already + 1}).`,
      done: false,
      action: { tool: prompt.includes('"calculator"') ? 'calculator' : 'notes', input: already === 0 ? '2+2*10' : 'write plan summary' },
    });
  }

  if (task === 'topic_match') {
    return prompt.toLowerCase().includes('brain') ? 'neural-networks' : 'none';
  }

  // tutor / generic chat
  return 'Mock tutor reply: here is a short, grounded answer to your question.';
}
