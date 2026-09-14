import { resolveProducts } from '../../../apps/api/dist/src/server.js';
import { buildProductQueryVariants } from '../../../apps/api/dist/src/commerce.js';
import { mergeFrameEvidence } from '../../../apps/api/dist/src/multi-frame-evidence.js';
import { candidateKey } from '../../../apps/api/dist/src/candidate-images.js';
import { normalizeObjectDescription } from '../../../apps/api/dist/src/types.js';
import { digest } from './metrics.mjs';

export async function runStatic(corpus) {
  const observations = [];
  const reviews = {};
  for (const selection of corpus.selections) {
    const started = performance.now();
    // Only input is passed to production code. Ground truth and candidate labels are held out.
    const input = structuredClone(selection.input);
    const providerObservations = [];
    const providers = input.providers.map(p => ({ name: p.name, tier: p.tier, provider: { async search() {
      providerObservations.push({ provider: p.name, observable: true, unit: 'provider-call', failed: Boolean(p.failure), simulated: true });
      if (p.failure) throw Error(p.failure);
      return p.candidates.map(c => structuredClone(c.product));
    } } }));
    const evidence = new Map(input.providers.flatMap(p => p.candidates).filter(c => c.comparison).map(c => [candidateKey(c.product), c.comparison]));
    const imageVerifier = async (_key, _model, _source, _description, candidates) => {
      const comparisons = new Map(candidates.filter(c => evidence.has(candidateKey(c))).map(c => [candidateKey(c), evidence.get(candidateKey(c))]));
      return { comparisons, compared: comparisons.size, failures: candidates.length - comparisons.size,
        failure_reasons: candidates.length > comparisons.size ? { fixture_image_unavailable: candidates.length - comparisons.size } : {} };
    };
    const analysis = mergeFrameEvidence(normalizeObjectDescription(input.description), 10, input.observations);
    const queries = buildProductQueryVariants(analysis, input.context);
    const response = await resolveProducts(providers, queries, analysis, { GEMINI_API_KEY: 'offline-fixture-not-a-key' },
      input.context, { mimeType: 'image/png', data: 'fixture-placeholder-not-used-by-verifier' }, imageVerifier);
    const observation = { selection_id: selection.id, corpus_sha256: digest(corpus), mode: 'static_authored_evidence',
      latency_ms: Math.round((performance.now() - started) * 1000) / 1000, analysis, response, provider_observations: providerObservations };
    observations.push(observation);
    reviews[selection.id] = { observation_sha256: digest(observation), candidates: selection.labels,
      notes: 'Adjudication is independent fixture truth, defined before resolver execution; not a model grading its own output.' };
  }
  return { observations, reviews };
}
