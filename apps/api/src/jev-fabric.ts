import type { ObjectDescription } from './types.js';
import { JevJudgmentProvider, type WorkersAiBinding } from './jev.js';
import type { JevRoutingDecision, JevRouterInput, JevRouterTelemetry } from './jev-router.js';

type BinarySignal = { choice: 'YES' | 'NO'; confidence: number };

export type JevFabricTelemetry = JevRouterTelemetry & {
  mode: 'fabric';
  signals: {
    commerce_needed: BinarySignal;
    broad_search_needed: BinarySignal;
    verification_needed: BinarySignal;
    multiframe_needed: BinarySignal;
  };
  thresholds: {
    skip_commerce: number;
    broad_search: number;
    light_verification: number;
    multiframe: number;
  };
  broad_search_on_miss: boolean;
};

const REQUEST_SCHEMA_VERSION = 'jev-fabric-v1';
const FALLBACK: JevRoutingDecision = { commerce_action: 'SEARCH_NORMAL', verification_action: 'FULL', multiframe_action: 'NO' };
const THRESHOLDS = {
  skip_commerce: 0.90,
  broad_search: 0.70,
  light_verification: 0.85,
  multiframe: 0.75,
};

function strongEnoughForLight(input: JevRouterInput): boolean {
  const d = input.description;
  const corroboratingEvidence =
    (d.visible_text?.length ?? 0) +
    (d.logos_markings?.length ?? 0) +
    (d.distinctive_features?.length ?? 0);
  return d.confidence >= 0.9
    && d.identity_confidence >= 0.9
    && corroboratingEvidence >= 1;
}

function shape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value !== 'object') return typeof value;
  if (depth >= 2) return 'object';
  return `object{${Object.entries(value as Record<string, unknown>).slice(0, 20)
    .map(([key, child]) => `${key}:${shape(child, depth + 1)}`).join(',')}}`;
}

function tokenUsage(value: unknown, key: 'input_tokens' | 'output_tokens'): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const v = value as Record<string, unknown>;
  const n = v[key] ?? (key === 'input_tokens' ? (v.prompt_tokens ?? v.inputTokens) : (v.completion_tokens ?? v.outputTokens));
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

function readSignal(answers: Record<string, unknown>, key: string): BinarySignal | null {
  const answer = answers[key];
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const a = answer as Record<string, unknown>;
  const rawChoice = typeof a.choice === 'string' ? a.choice.toUpperCase() : '';
  if (rawChoice !== 'YES' && rawChoice !== 'NO') return null;
  let confidence = typeof a.confidence === 'number' && Number.isFinite(a.confidence)
    ? Math.max(0, Math.min(1, a.confidence))
    : 0.5;
  const probabilities = a.probabilities;
  if (probabilities && typeof probabilities === 'object' && !Array.isArray(probabilities)) {
    const p = probabilities as Record<string, unknown>;
    const direct = p[rawChoice] ?? p[rawChoice.toLowerCase()];
    if (typeof direct === 'number' && Number.isFinite(direct)) confidence = Math.max(0, Math.min(1, direct));
  }
  return { choice: rawChoice as 'YES' | 'NO', confidence };
}

export async function routeWithJevFabric(
  input: JevRouterInput,
  ai: WorkersAiBinding,
  timeoutMs = 3000,
): Promise<{ decision: JevRoutingDecision; telemetry: JevFabricTelemetry }> {
  const provider = new JevJudgmentProvider(ai);
  const defaultSignals = {
    commerce_needed: { choice: 'YES', confidence: 0 } as BinarySignal,
    broad_search_needed: { choice: 'NO', confidence: 0 } as BinarySignal,
    verification_needed: { choice: 'YES', confidence: 0 } as BinarySignal,
    multiframe_needed: { choice: 'NO', confidence: 0 } as BinarySignal,
  };
  const telemetry: JevFabricTelemetry = {
    enabled: true,
    mode: 'fabric',
    model: provider.model,
    calls: 1,
    latency_ms: 0,
    failed: false,
    ...FALLBACK,
    input_tokens: 0,
    output_tokens: 0,
    request_schema_version: REQUEST_SCHEMA_VERSION,
    signals: defaultSignals,
    thresholds: THRESHOLDS,
    broad_search_on_miss: false,
  };
  const started = Date.now();
  let responseShape: string | undefined;

  try {
    const result = await Promise.race([
      provider.evaluate({
        state: { ...input },
        questions: {
          commerce_needed: {
            type: 'choice',
            instructions: 'Is there enough evidence that the selected object is a purchasable product worth searching for? Judge only the structured visual evidence.',
            criteria: { YES: 'A purchasable product is meaningfully indicated.', NO: 'No useful purchasable product is indicated.' },
          },
          broad_search_needed: {
            type: 'choice',
            instructions: 'Would a broader commerce search materially help because current identity evidence is weak or incomplete?',
            criteria: { YES: 'Broader retrieval is justified.', NO: 'Normal retrieval should be sufficient.' },
          },
          verification_needed: {
            type: 'choice',
            instructions: 'Is expensive multimodal candidate verification needed to preserve trust, given the current evidence uncertainty?',
            criteria: { YES: 'Full verification is needed.', NO: 'Metadata/light verification is sufficient for now.' },
          },
          multiframe_needed: {
            type: 'choice',
            instructions: 'Could another nearby frame materially improve insufficient identity evidence?',
            criteria: { YES: 'Another frame could materially help.', NO: 'Another frame is not needed.' },
          },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev fabric timeout')), timeoutMs)),
    ]);

    const raw = result as Record<string, unknown>;
    responseShape = shape(raw);
    const answers = raw.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Malformed Jev fabric response');
    const answerRecord = answers as Record<string, unknown>;
    const signals = {
      commerce_needed: readSignal(answerRecord, 'commerce_needed'),
      broad_search_needed: readSignal(answerRecord, 'broad_search_needed'),
      verification_needed: readSignal(answerRecord, 'verification_needed'),
      multiframe_needed: readSignal(answerRecord, 'multiframe_needed'),
    };
    if (Object.values(signals).some((signal) => signal === null)) throw new Error('Malformed Jev fabric response');

    const s = signals as JevFabricTelemetry['signals'];
    const decision: JevRoutingDecision = {
      commerce_action: s.commerce_needed.choice === 'NO' && s.commerce_needed.confidence >= THRESHOLDS.skip_commerce
        ? 'SKIP'
        : 'SEARCH_NORMAL',
      verification_action: s.verification_needed.choice === 'NO'
          && s.verification_needed.confidence >= THRESHOLDS.light_verification
          && strongEnoughForLight(input)
        ? 'LIGHT'
        : 'FULL',
      multiframe_action: input.multi_frame_available
          && s.multiframe_needed.choice === 'YES'
          && s.multiframe_needed.confidence >= THRESHOLDS.multiframe
        ? 'ESCALATE'
        : 'NO',
    };

    telemetry.signals = s;
    telemetry.broad_search_on_miss = s.broad_search_needed.choice === 'YES'
      && s.broad_search_needed.confidence >= THRESHOLDS.broad_search;
    telemetry.input_tokens = tokenUsage(raw.usage, 'input_tokens');
    telemetry.output_tokens = tokenUsage(raw.usage, 'output_tokens');
    Object.assign(telemetry, decision);
    telemetry.latency_ms = Date.now() - started;
    return { decision, telemetry };
  } catch (error) {
    telemetry.failed = true;
    telemetry.latency_ms = Date.now() - started;
    telemetry.failure_message = (error instanceof Error ? error.message : String(error)).slice(0, 240);
    telemetry.failure_kind = telemetry.failure_message === 'Jev fabric timeout'
      ? 'timeout'
      : telemetry.failure_message === 'Malformed Jev fabric response'
        ? 'malformed_response'
        : 'upstream_error';
    telemetry.response_shape = responseShape;
    console.warn('Jev decision fabric failed open', {
      kind: telemetry.failure_kind,
      message: telemetry.failure_message,
      response_shape: telemetry.response_shape,
      request_schema_version: telemetry.request_schema_version,
    });
    return { decision: FALLBACK, telemetry };
  }
}
