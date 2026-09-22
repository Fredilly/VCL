import type { ObjectDescription } from './types.js';
import { JevJudgmentProvider, type WorkersAiBinding } from './jev.js';

export type CommerceAction = 'SKIP' | 'SEARCH_NORMAL' | 'SEARCH_BROAD';
export type VerificationAction = 'LIGHT' | 'FULL';
export type MultiframeAction = 'NO' | 'ESCALATE';

export type JevRoutingDecision = {
  commerce_action: CommerceAction;
  verification_action: VerificationAction;
  multiframe_action: MultiframeAction;
};

export type JevRouterTelemetry = {
  enabled: boolean;
  model: string;
  calls: number;
  latency_ms: number;
  failed: boolean;
  commerce_action: CommerceAction;
  verification_action: VerificationAction;
  multiframe_action: MultiframeAction;
  input_tokens: number;
  output_tokens: number;
  request_schema_version: string;
  failure_kind?: 'timeout' | 'malformed_response' | 'upstream_error';
  failure_message?: string;
  http_status?: number;
  error_code?: string;
  response_shape?: string;
};

export type JevRouterInput = {
  description: Pick<ObjectDescription, 'category' | 'subcategory' | 'confidence' | 'identity_confidence' | 'visible_text' | 'logos_markings' | 'distinctive_features'>;
  multi_frame_available: boolean;
  provider_context: { commerce_providers_available: number; vision_provider_available: boolean };
};

const FALLBACK: JevRoutingDecision = { commerce_action: 'SEARCH_NORMAL', verification_action: 'FULL', multiframe_action: 'NO' };
const REQUEST_SCHEMA_VERSION = 'jev-state-questions-v1';
const actions = {
  commerce_action: new Set<CommerceAction>(['SKIP', 'SEARCH_NORMAL', 'SEARCH_BROAD']),
  verification_action: new Set<VerificationAction>(['LIGHT', 'FULL']),
  multiframe_action: new Set<MultiframeAction>(['NO', 'ESCALATE']),
};

function validDecision(value: unknown): value is JevRoutingDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.commerce_action === 'string' && actions.commerce_action.has(v.commerce_action as CommerceAction)
    && typeof v.verification_action === 'string' && actions.verification_action.has(v.verification_action as VerificationAction)
    && typeof v.multiframe_action === 'string' && actions.multiframe_action.has(v.multiframe_action as MultiframeAction);
}

function strongEnoughForLight(input: JevRouterInput): boolean {
  const d = input.description;
  // Apparel needs pixel-level verification because sleeve, subtype, color, and other
  // structural attributes are easy to omit or misstate in merchant titles. LIGHT
  // can otherwise let metadata-only candidates survive without checking the images.
  if (/^(apparel|clothing|garment|top|tops|outerwear)$/i.test(d.category)
    || /\b(sweater|jumper|pullover|cardigan|hoodie|sweatshirt|polo|t[- ]?shirt|shirt|jacket|coat|dress|skirt|shorts|jeans|trousers|pants|leggings|tank)\b/i.test(d.subcategory)) {
    return false;
  }
  const corroboratingEvidence =
    (d.visible_text?.length ?? 0) +
    (d.logos_markings?.length ?? 0) +
    (d.distinctive_features?.length ?? 0);
  return d.confidence >= 0.9
    && d.identity_confidence >= 0.9
    && corroboratingEvidence >= 1;
}

function choiceAnswer(answers: Record<string, unknown>, key: keyof JevRoutingDecision): unknown {
  const answer = answers[key];
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
  return (answer as Record<string, unknown>).choice;
}

function parseDecision(value: unknown): JevRoutingDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  // Backward-compatible with the early adapter/tests.
  if (validDecision(raw.decision)) return raw.decision;
  if (validDecision(raw)) return raw;

  // Cloudflare Jev returns typed answers under response.answers.<question>.choice.
  const answers = raw.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const answerRecord = answers as Record<string, unknown>;
  const decision = {
    commerce_action: choiceAnswer(answerRecord, 'commerce_action'),
    verification_action: choiceAnswer(answerRecord, 'verification_action'),
    multiframe_action: choiceAnswer(answerRecord, 'multiframe_action'),
  };
  return validDecision(decision) ? decision : null;
}

function usage(value: unknown, key: 'input_tokens' | 'output_tokens'): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const v = value as Record<string, unknown>;
  const n = v[key] ?? (key === 'input_tokens' ? (v.prompt_tokens ?? v.inputTokens) : (v.completion_tokens ?? v.outputTokens));
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

function responseShape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value !== 'object') return typeof value;
  if (depth >= 2) return 'object';
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, 20)
    .map(([key, child]) => `${key}:${responseShape(child, depth + 1)}`);
  return `object{${entries.join(',')}}`;
}

function numericErrorField(error: unknown, keys: string[]): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  const cause = record.cause;
  if (cause && typeof cause === 'object') return numericErrorField(cause, keys);
  return undefined;
}

function stringErrorField(error: unknown, keys: string[]): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length) return value.slice(0, 160);
  }
  const cause = record.cause;
  if (cause && typeof cause === 'object') return stringErrorField(cause, keys);
  return undefined;
}

export async function routeWithJev(input: JevRouterInput, ai: WorkersAiBinding, timeoutMs = 3000): Promise<{ decision: JevRoutingDecision; telemetry: JevRouterTelemetry }> {
  const provider = new JevJudgmentProvider(ai);
  const telemetry: JevRouterTelemetry = {
    enabled: true,
    model: provider.model,
    calls: 1,
    latency_ms: 0,
    failed: false,
    ...FALLBACK,
    input_tokens: 0,
    output_tokens: 0,
    request_schema_version: REQUEST_SCHEMA_VERSION,
  };
  const started = Date.now();
  let lastResponseShape: string | undefined;
  try {
    const result = await Promise.race([
      provider.evaluate({
        state: { ...input },
        questions: {
          commerce_action: { type: 'choice', instructions: 'Choose commerce routing conservatively. SKIP only when no useful purchasable object is strongly indicated; SEARCH_BROAD only when normal evidence is insufficient.', criteria: { SKIP: 'No useful purchasable object.', SEARCH_NORMAL: 'Evidence supports a normal commerce search.', SEARCH_BROAD: 'Normal evidence is insufficient and broader search may help.' } },
          verification_action: { type: 'choice', instructions: 'Choose LIGHT only when the evidence is strong enough that full verification is clearly unnecessary.', criteria: { LIGHT: 'Strong evidence; light verification is sufficient.', FULL: 'Full verification is needed.' } },
          multiframe_action: { type: 'choice', instructions: 'Choose ESCALATE only when another frame could materially improve insufficient evidence.', criteria: { NO: 'Another frame is not materially needed.', ESCALATE: 'Another frame could materially help.' } },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev router timeout')), timeoutMs)),
    ]);
    const raw = result as Record<string, unknown>;
    lastResponseShape = responseShape(raw);
    const decisionValue = parseDecision(raw);
    if (!decisionValue) {
      telemetry.response_shape = lastResponseShape;
      throw new Error('Malformed Jev routing response');
    }
    const guardedDecision = decisionValue.verification_action === 'LIGHT' && !strongEnoughForLight(input)
      ? { ...decisionValue, verification_action: 'FULL' as const }
      : decisionValue;
    telemetry.input_tokens = usage(raw?.usage, 'input_tokens');
    telemetry.output_tokens = usage(raw?.usage, 'output_tokens');
    Object.assign(telemetry, guardedDecision);
    telemetry.latency_ms = Date.now() - started;
    return { decision: guardedDecision, telemetry };
  } catch (error) {
    telemetry.failed = true;
    telemetry.latency_ms = Date.now() - started;
    const message = error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string'
      ? String((error as Record<string, unknown>).message)
      : String(error);
    telemetry.failure_message = message.slice(0, 240);
    telemetry.failure_kind = message === 'Jev router timeout'
      ? 'timeout'
      : message === 'Malformed Jev routing response'
        ? 'malformed_response'
        : 'upstream_error';
    telemetry.http_status = numericErrorField(error, ['status', 'statusCode', 'httpStatus']);
    telemetry.error_code = stringErrorField(error, ['code', 'name']);
    if (!telemetry.response_shape && lastResponseShape) telemetry.response_shape = lastResponseShape;
    console.warn('Jev decision router failed open', {
      kind: telemetry.failure_kind,
      message: telemetry.failure_message,
      status: telemetry.http_status,
      code: telemetry.error_code,
      response_shape: telemetry.response_shape,
      request_schema_version: telemetry.request_schema_version,
    });
    return { decision: FALLBACK, telemetry };
  }
}

export function routerInput(description: ObjectDescription, multiFrameAvailable: boolean, commerceProvidersAvailable: number): JevRouterInput {
  return { description: { category: description.category, subcategory: description.subcategory, confidence: description.confidence, identity_confidence: description.identity_confidence, visible_text: description.visible_text, logos_markings: description.logos_markings, distinctive_features: description.distinctive_features }, multi_frame_available: multiFrameAvailable, provider_context: { commerce_providers_available: commerceProvidersAvailable, vision_provider_available: true } };
}
