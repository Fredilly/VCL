import type { ProductCandidate, ProductQuery } from './commerce.js';
import type { ObjectDescription } from './types.js';
import {
  evidenceFingerprint,
  feedbackCandidateKey,
  persistFeedbackContext,
  persistScoopLearningRecord,
  FEEDBACK_RANKING_POLICY,
  type FeedbackLedgerEnv,
} from './feedback-ledger.js';

export type AlphaLearningTelemetry = {
  event_id: string;
  session_id: string;
};

export async function persistAlphaLearning(input: {
  env: FeedbackLedgerEnv & { OPENROUTER_MODEL?: string; GEMINI_MODEL?: string; VISION_PROVIDER?: string };
  telemetry: AlphaLearningTelemetry | null;
  description: ObjectDescription;
  state: string;
  total_ms: number;
  products: ProductCandidate[];
  query: ProductQuery;
  verification_usage?: unknown;
  commerce_calls?: unknown;
  verified_canonical_key?: string | null;
}): Promise<void> {
  if (!input.telemetry || !input.env.FEEDBACK_LEDGER) return;

  const evidenceKey = evidenceFingerprint(input.description);
  const usage = input.verification_usage && typeof input.verification_usage === 'object'
    ? input.verification_usage as Record<string, unknown>
    : {};
  const calls = input.commerce_calls && typeof input.commerce_calls === 'object' && !Array.isArray(input.commerce_calls)
    ? Object.fromEntries(Object.entries(input.commerce_calls as Record<string, unknown>)
      .map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
    : {};
  const visionModel = input.env.OPENROUTER_MODEL || input.env.GEMINI_MODEL || input.env.VISION_PROVIDER || null;
  const createdAt = new Date().toISOString();

  await Promise.all([
    persistScoopLearningRecord(input.env, {
      event_id: input.telemetry.event_id,
      session_id: input.telemetry.session_id,
      state: input.state,
      evidence_key: evidenceKey,
      category: input.description.category,
      subcategory: input.description.subcategory,
      brand: input.description.brand_candidate,
      model: input.description.model_candidate,
      color: input.description.color || null,
      material: input.description.material || null,
      visible_text: input.description.visible_text,
      logos_markings: input.description.logos_markings,
      distinctive_features: input.description.distinctive_features,
      shape_silhouette: input.description.shape_silhouette,
      style_attributes: input.description.style_attributes,
      vision_model: visionModel,
      latency_ms: input.total_ms,
      verification_cost_usd: Math.max(0, Number(usage.cost_usd) || 0),
      commerce_calls: calls,
      verified_canonical_key: input.verified_canonical_key ?? null,
      created_at: createdAt,
    }),
    ...input.products.map((product) => persistFeedbackContext(input.env, {
      event_id: input.telemetry!.event_id,
      session_id: input.telemetry!.session_id,
      result_id: product.id,
      candidate_key: feedbackCandidateKey(product),
      provider: product.provider || product.provenance || 'unknown',
      provenance: product.provenance || 'unknown',
      result_class: product.result_class,
      evidence_key: evidenceKey,
      query: input.query.query,
      category: input.query.category,
      subcategory: input.query.subcategory,
      brand: input.query.brand,
      model: input.query.model,
      vision_model: visionModel,
      ranking_policy: FEEDBACK_RANKING_POLICY,
      created_at: createdAt,
    })),
  ]);
}
