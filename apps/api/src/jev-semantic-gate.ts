import type { ProductCandidate } from './commerce.js';
import type { ObjectDescription } from './types.js';
import { JevJudgmentProvider } from './jev.js';

const REJECT_THRESHOLD = 0.98;
const HIGH_CONFIDENCE = 0.85;

type JevResponse = {
  model?: string;
  answers?: Record<string, { type?: string; noul?: number }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type JevGateTelemetry = {
  enabled: true;
  model: string;
  calls: number;
  candidates_before: number;
  candidates_after: number;
  rejected: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  failed: boolean;
};

export type JevGateResult = {
  candidates: ProductCandidate[];
  telemetry: JevGateTelemetry;
};

function candidateState(candidate: ProductCandidate) {
  return {
    title: candidate.title,
    brand: candidate.brand,
    model: candidate.model,
    category: candidate.category,
    provenance: candidate.provenance,
    metadata: candidate.metadata ?? {},
  };
}

function sourceState(description: ObjectDescription) {
  return {
    category: description.category,
    subcategory: description.subcategory,
    brand_candidate: description.brand_candidate,
    model_candidate: description.model_candidate,
    color: description.color,
    material: description.material,
    style_attributes: description.style_attributes,
    visible_text: description.visible_text,
    logos_markings: description.logos_markings,
    distinctive_features: description.distinctive_features,
    shape_silhouette: description.shape_silhouette,
    confidence: description.confidence,
    identity_confidence: description.identity_confidence,
    evidence_confidence: description.evidence_confidence ?? {},
  };
}

export async function applyJevSemanticGate(
  provider: JevJudgmentProvider,
  description: ObjectDescription,
  candidates: ProductCandidate[],
): Promise<JevGateResult> {
  const started = Date.now();
  const limited = candidates.slice(0, 8);
  const telemetry: JevGateTelemetry = {
    enabled: true,
    model: JevJudgmentProvider.model,
    calls: 0,
    candidates_before: limited.length,
    candidates_after: limited.length,
    rejected: 0,
    latency_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    failed: false,
  };

  if (!limited.length) {
    telemetry.latency_ms = Date.now() - started;
    return { candidates: limited, telemetry };
  }

  const questions = Object.fromEntries(limited.map((_, index) => [
    `candidate_${index}`,
    {
      type: 'noul' as const,
      instructions: [
        `Does \`candidates[${index}]\` contain an explicit, high-confidence semantic contradiction with \`source\`?`,
        'Answer true only for a clear conflict in product identity or product attributes.',
        `Treat source category/color/style evidence as strong only when source.confidence >= ${HIGH_CONFIDENCE}.`,
        `Treat source brand/model as strong only when source.identity_confidence >= ${HIGH_CONFIDENCE} or readable visible_text/logos_markings directly support it.`,
        'Missing, vague, absent, or merely different wording is NOT a contradiction.',
        'Compatible synonyms, broader/narrower wording, and unknown candidate fields are NOT contradictions.',
        'Do not infer a contradiction from search rank, provider provenance, price, or commercial terms.',
      ].join(' '),
      criteria: {
        true: 'Candidate explicitly conflicts with strong source evidence, such as incompatible product type, brand, model, dominant color, gender/age group, sleeve, or material.',
        false: 'Candidate is compatible, evidence is incomplete/ambiguous, or no explicit high-confidence contradiction is established.',
      },
    },
  ]));

  try {
    telemetry.calls = 1;
    const response = await provider.evaluate({
      state: {
        source: sourceState(description),
        candidates: limited.map(candidateState),
      },
      questions,
    }) as JevResponse;

    telemetry.input_tokens = Number(response.usage?.input_tokens ?? 0) || 0;
    telemetry.output_tokens = Number(response.usage?.output_tokens ?? 0) || 0;

    const survivors = limited.filter((_, index) => {
      const answer = response.answers?.[`candidate_${index}`];
      const contradictionProbability = answer?.type === 'noul' && typeof answer.noul === 'number'
        ? answer.noul
        : 0;
      return contradictionProbability < REJECT_THRESHOLD;
    });

    telemetry.candidates_after = survivors.length;
    telemetry.rejected = limited.length - survivors.length;
    return { candidates: survivors, telemetry };
  } catch {
    telemetry.failed = true;
    return { candidates: limited, telemetry };
  } finally {
    telemetry.latency_ms = Date.now() - started;
  }
}
