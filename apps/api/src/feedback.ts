export const FEEDBACK_TYPES = [
  'useful',
  'wrong_item',
  'wrong_category',
  'not_similar',
  'correct_match',
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type UserFeedback = {
  event_id: string;
  result_id: string;
  feedback_type: FeedbackType;
  created_at: string;
};

export type VerifiedProductAssertionStatus = 'pending' | 'verified' | 'revoked';

export type VerifiedProductAssertion = {
  content_id: string;
  timestamp_start_ms: number;
  timestamp_end_ms: number;
  object_descriptor?: string | null;
  region_reference?: string | null;
  canonical_product_id: string;
  creator_or_publisher: string;
  verification_source: string;
  verification_status: VerifiedProductAssertionStatus;
  created_at: string;
};

function cleanId(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${field} is invalid`);
  return normalized;
}

function optionalText(value: unknown, max = 500): string | null | undefined {
  if (value == null) return value as null | undefined;
  if (typeof value !== 'string') throw new Error('optional text field must be a string');
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('optional text field is too long');
  return normalized;
}

export function normalizeUserFeedback(value: unknown, now = new Date()): UserFeedback {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('feedback must be an object');
  const record = value as Record<string, unknown>;
  const feedbackType = record.feedback_type;
  if (typeof feedbackType !== 'string' || !(FEEDBACK_TYPES as readonly string[]).includes(feedbackType)) {
    throw new Error('feedback_type is invalid');
  }

  return {
    event_id: cleanId(record.event_id, 'event_id'),
    result_id: cleanId(record.result_id, 'result_id'),
    feedback_type: feedbackType as FeedbackType,
    created_at: now.toISOString(),
  };
}

export function normalizeVerifiedProductAssertion(value: unknown, now = new Date()): VerifiedProductAssertion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('verified assertion must be an object');
  const record = value as Record<string, unknown>;
  const start = Number(record.timestamp_start_ms);
  const end = Number(record.timestamp_end_ms);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    throw new Error('timestamp range is invalid');
  }

  const status = record.verification_status;
  if (status !== 'pending' && status !== 'verified' && status !== 'revoked') {
    throw new Error('verification_status is invalid');
  }

  return {
    content_id: cleanId(record.content_id, 'content_id'),
    timestamp_start_ms: Math.floor(start),
    timestamp_end_ms: Math.floor(end),
    object_descriptor: optionalText(record.object_descriptor),
    region_reference: optionalText(record.region_reference),
    canonical_product_id: cleanId(record.canonical_product_id, 'canonical_product_id'),
    creator_or_publisher: cleanId(record.creator_or_publisher, 'creator_or_publisher', 240),
    verification_source: cleanId(record.verification_source, 'verification_source', 240),
    verification_status: status,
    created_at: now.toISOString(),
  };
}
