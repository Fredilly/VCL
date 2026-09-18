import assert from 'node:assert/strict';
import test from 'node:test';
import { JevJudgmentProvider } from '../dist/src/jev.js';

test('JevJudgmentProvider calls Cloudflare Workers AI with typesafe/jev', async () => {
  const calls = [];
  const ai = {
    async run(model, input) {
      calls.push({ model, input });
      return { is_relevant: { answer: true, probability: 0.98 } };
    },
  };

  const provider = new JevJudgmentProvider(ai);
  const input = {
    state: {
      source: { category: 'watch', brand_candidate: 'CASIO' },
      candidate: { title: 'CASIO F-91W' },
    },
    questions: {
      is_relevant: {
        type: 'noul',
        instructions: 'Is the candidate relevant to the selected object?',
        criteria: {
          true: 'The candidate is compatible with the available source evidence.',
          false: 'The candidate contradicts the available source evidence.',
        },
      },
    },
  };

  const result = await provider.evaluate(input);

  assert.deepEqual(result, { is_relevant: { answer: true, probability: 0.98 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'typesafe/jev');
  assert.deepEqual(calls[0].input, input);
});
