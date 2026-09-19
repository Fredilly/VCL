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
};

export type JevRouterInput = {
  description: Pick<ObjectDescription, 'category' | 'subcategory' | 'confidence' | 'identity_confidence' | 'visible_text' | 'logos_markings' | 'distinctive_features'>;
  multi_frame_available: boolean;
  provider_context: { commerce_providers_available: number; vision_provider_available: boolean };
};

const FALLBACK: JevRoutingDecision = { commerce_action: 'SEARCH_NORMAL', verification_action: 'FULL', multiframe_action: 'NO' };
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
  const n = v[key] ?? (key === 'input_tokens' ? v.prompt_tokens : v.completion_tokens);
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function routeWithJev(input: JevRouterInput, ai: WorkersAiBinding, timeoutMs = 900): Promise<{ decision: JevRoutingDecision; telemetry: JevRouterTelemetry }> {
  const telemetry: JevRouterTelemetry = { enabled: true, model: JevJudgmentProvider.model, calls: 1, latency_ms: 0, failed: false, ...FALLBACK, input_tokens: 0, output_tokens: 0 };
  const started = Date.now();
  try {
    const result = await Promise.race([
      new JevJudgmentProvider(ai).evaluate({
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
    const decisionValue = parseDecision(raw);
    if (!decisionValue) throw new Error('Malformed Jev routing response');
    telemetry.input_tokens = usage(raw?.usage, 'input_tokens');
    telemetry.output_tokens = usage(raw?.usage, 'output_tokens');
    Object.assign(telemetry, decisionValue);
    telemetry.latency_ms = Date.now() - started;
    return { decision: decisionValue, telemetry };
  } catch (error) {
    telemetry.failed = true;
    telemetry.latency_ms = Date.now() - started;
    console.warn('Jev decision router failed open', error instanceof Error ? error.message : String(error));
    return { decision: FALLBACK, telemetry };
  }
}

export function routerInput(description: ObjectDescription, multiFrameAvailable: boolean, commerceProvidersAvailable: number): JevRouterInput {
  return { description: { category: description.category, subcategory: description.subcategory, confidence: description.confidence, identity_confidence: description.identity_confidence, visible_text: description.visible_text, logos_markings: description.logos_markings, distinctive_features: description.distinctive_features }, multi_frame_available: multiFrameAvailable, provider_context: { commerce_providers_available: commerceProvidersAvailable, vision_provider_available: true } };
}
