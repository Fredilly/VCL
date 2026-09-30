import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { sanitizeLearningText } = loadModule(
  new URL('../src/feedback-ledger.ts', import.meta.url).pathname,
  {},
);

test('learning text redacts common personal identifiers before durable storage', () => {
  const input = 'label alpha@example.com +1 (312) 555-0199 https://example.com/order/abc';
  const output = sanitizeLearningText(input, 300);
  assert.equal(output.includes('alpha@example.com'), false);
  assert.equal(output.includes('555-0199'), false);
  assert.equal(output.includes('https://example.com'), false);
  assert.equal(output.includes('[redacted-email]'), true);
  assert.equal(output.includes('[redacted-phone]'), true);
  assert.equal(output.includes('[redacted-url]'), true);
});

test('product text survives privacy sanitization', () => {
  assert.equal(sanitizeLearningText('CREED AVENTUS 100ml'), 'CREED AVENTUS 100ml');
  assert.equal(sanitizeLearningText('Nike Air Max 90'), 'Nike Air Max 90');
});
