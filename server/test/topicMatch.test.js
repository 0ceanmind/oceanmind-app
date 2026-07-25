import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTopic } from '../lib/topicMatch.js';

test('matches neural network phrasings', () => {
  assert.equal(matchTopic('I want to learn about neural networks'), 'neural-networks');
  assert.equal(matchTopic('deep learning basics'), 'neural-networks');
  assert.equal(matchTopic('how does backpropagation work?'), 'neural-networks');
});

test('matches agent phrasings', () => {
  assert.equal(matchTopic('building AI agents'), 'ai-agents');
  assert.equal(matchTopic('autonomous tool use'), 'ai-agents');
});

test('matches chatbot phrasings', () => {
  assert.equal(matchTopic('I want to make a chatbot'), 'chatbots');
  assert.equal(matchTopic('customer support bot'), 'chatbots');
});

test('returns null when nothing matches', () => {
  assert.equal(matchTopic('quantum entanglement'), null);
  assert.equal(matchTopic(''), null);
  assert.equal(matchTopic(null), null);
});
