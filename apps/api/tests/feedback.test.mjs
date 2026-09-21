import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const {
  FEEDBACK_TYPES,
  normalizeUserFeedback,
  normalizeVerifiedProductAssertion,
} = loadModule(new URL('../src/feedback.ts', import.meta.url).pathname);

const now = new Date('2026-09-21T00:00:00.000Z');

test('feedback contract accepts only supported labels and binds event/result ids', () => {
  for (const feedback_type of FEEDBACK_TYPES) {
    assert.deepEqual(
      normalizeUserFeedback({ event_id: 'evt-1', result_id: 'result-1', feedback_type }, now),
      { event_id: 'evt-1', result_id: 'result-1', feedback_type, created_at: now.toISOString() },
    );
  }

  assert.throws(
    () => normalizeUserFeedback({ event_id: 'evt-1', result_id: 'result-1', feedback_type: 'paid_boost' }, now),
    /feedback_type is invalid/,
  );
  assert.throws(
    () => normalizeUserFeedback({ event_id: '', result_id: 'result-1', feedback_type: 'useful' }, now),
    /event_id is invalid/,
  );
});

test('verified assertion preserves provenance and validates time range', () => {
  const assertion = normalizeVerifiedProductAssertion({
    content_id: 'youtube:abc',
    timestamp_start_ms: 1000,
    timestamp_end_ms: 5000,
    object_descriptor: 'brown leather jacket',
    region_reference: 'selection:42',
    canonical_product_id: 'product:123',
    creator_or_publisher: 'Example Creator',
    verification_source: 'creator-declared',
    verification_status: 'verified',
  }, now);

  assert.equal(assertion.verification_status, 'verified');
  assert.equal(assertion.verification_source, 'creator-declared');
  assert.equal(assertion.canonical_product_id, 'product:123');
  assert.equal(assertion.created_at, now.toISOString());

  assert.throws(
    () => normalizeVerifiedProductAssertion({
      content_id: 'youtube:abc',
      timestamp_start_ms: 5000,
      timestamp_end_ms: 1000,
      canonical_product_id: 'product:123',
      creator_or_publisher: 'Example Creator',
      verification_source: 'creator-declared',
      verification_status: 'verified',
    }, now),
    /timestamp range is invalid/,
  );
});

test('verified assertion cannot invent an unsupported status', () => {
  assert.throws(
    () => normalizeVerifiedProductAssertion({
      content_id: 'youtube:abc',
      timestamp_start_ms: 1000,
      timestamp_end_ms: 5000,
      canonical_product_id: 'product:123',
      creator_or_publisher: 'Example Creator',
      verification_source: 'sponsor',
      verification_status: 'paid',
    }, now),
    /verification_status is invalid/,
  );
});
