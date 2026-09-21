import { normalizeUserFeedback } from './feedback.js';

export type AlphaTelemetryEnvelope = {
  event_id: string;
  session_id: string;
  interaction_started_at: number;
};

function boundedId(value: unknown, field: string) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) throw new Error(`${field} is invalid`);
  return trimmed;
}

export function normalizeAlphaTelemetry(value: unknown): AlphaTelemetryEnvelope | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('telemetry must be an object');
  const record = value as Record<string, unknown>;
  const started = Number(record.interaction_started_at);
  if (!Number.isFinite(started) || started <= 0) throw new Error('interaction_started_at is invalid');
  return {
    event_id: boundedId(record.event_id, 'event_id'),
    session_id: boundedId(record.session_id, 'session_id'),
    interaction_started_at: Math.floor(started),
  };
}

export function recordAlphaScoop(input: {
  telemetry: AlphaTelemetryEnvelope | null;
  state: string;
  totalMs: number;
  providersUsed: string[];
  resultRows: Array<{ id: string; result_class: string }>;
  verificationUsage?: unknown;
  commerceCalls?: unknown;
  visionUsage?: unknown;
  failureState?: string;
}) {
  if (!input.telemetry) return;
  const now = Date.now();
  console.log(JSON.stringify({
    event: 'ALPHA_SCOOP',
    schema_version: 1,
    event_id: input.telemetry.event_id,
    session_id: input.telemetry.session_id,
    occurred_at: new Date(now).toISOString(),
    state: input.state,
    failure_state: input.failureState ?? null,
    latency_ms: Math.max(0, now - input.telemetry.interaction_started_at),
    api_commerce_ms: Math.max(0, Math.floor(input.totalMs)),
    providers_used: input.providersUsed.slice(0, 8),
    results: input.resultRows.slice(0, 8).map((row) => ({ id: String(row.id).slice(0, 160), result_class: row.result_class })),
    vision_usage: input.visionUsage ?? null,
    verification_usage: input.verificationUsage ?? null,
    commerce_calls: input.commerceCalls ?? {},
  }));
}

export function recordAlphaFeedback(value: unknown) {
  const feedback = normalizeUserFeedback(value);
  console.log(JSON.stringify({
    event: 'ALPHA_FEEDBACK',
    schema_version: 1,
    event_id: feedback.event_id,
    result_id: feedback.result_id,
    feedback_type: feedback.feedback_type,
    occurred_at: feedback.created_at,
  }));
  return feedback;
}
