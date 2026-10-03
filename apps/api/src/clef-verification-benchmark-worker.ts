import { verifyCandidate, candidateEvidence, sourceEvidence } from './candidate-verification.js';
import type { ProductCandidate } from './commerce.js';
import type { ObjectDescription } from './types.js';
import type { ImageComparison } from './verification-evidence.js';

interface Env {
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
}

const MAX_BYTES = 2_000_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function safeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
      && !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname);
  } catch {
    return false;
  }
}

async function imageDataUrl(url: string): Promise<string> {
  if (!safeImageUrl(url)) throw new Error('candidate image URL rejected');
  let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
  for (let hop = 0; response.status >= 300 && response.status < 400 && hop < 2; hop++) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('candidate image redirect missing location');
    url = new URL(location, url).href;
    if (!safeImageUrl(url)) throw new Error('candidate image redirect rejected');
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
  }
  const mime = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!response.ok || !MIME_TYPES.has(mime) || !response.body) {
    await response.body?.cancel();
    throw new Error(`candidate image fetch failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('candidate image too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let binary = '';
  for (let i = 0; i < merged.length; i += 32768) {
    binary += String.fromCharCode(...merged.subarray(i, i + 32768));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function answerRoot(value: unknown): Record<string, unknown> {
  const root = record(value);
  const first = record(root?.result);
  const second = record(first?.result);
  return second ?? first ?? root ?? {};
}

function choice(answer: unknown): string | null {
  const item = record(answer);
  if (!item) return null;
  if (typeof item.choice === 'string') return item.choice;
  if (typeof item.value === 'string') return item.value;
  return null;
}

function noul(answer: unknown): number | null {
  const item = record(answer);
  if (!item) return null;
  for (const key of ['noul', 'probability', 'confidence']) {
    const value = Number(item[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  }
  return null;
}

function choiceConfidence(answer: unknown, selected: string): number {
  const item = record(answer);
  if (!item) return 0.75;
  const probabilities = record(item.probabilities) ?? record(item.probability) ?? record(item.probs);
  const probability = Number(probabilities?.[selected]);
  if (Number.isFinite(probability) && probability >= 0 && probability <= 1) return probability;
  const confidence = Number(item.confidence);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.75;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

    let body: {
      source_image?: string;
      candidate_image_url?: string;
      source_description?: ObjectDescription;
      candidate?: ProductCandidate;
    };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (typeof body.source_image !== 'string'
      || typeof body.candidate_image_url !== 'string'
      || !body.source_description
      || !body.candidate) {
      return json({ error: 'source_image, candidate_image_url, source_description and candidate are required' }, 400);
    }

    const started = Date.now();
    try {
      const candidateImage = await imageDataUrl(body.candidate_image_url);
      const modelStarted = Date.now();
      const raw = await env.AI.run('@cf/cloudflare/clef', {
        model: 'clef',
        state: {
          task: 'Compare IMAGE 1 selected object with IMAGE 2 commerce candidate. Pixels are primary. Metadata may corroborate but never override a visible contradiction. Never invent brand/model from style.',
          source_description: body.source_description,
          candidate: {
            title: body.candidate.title,
            brand: body.candidate.brand,
            model: body.candidate.model,
            category: body.candidate.category,
            metadata: body.candidate.metadata ?? null,
          },
        },
        images: [body.source_image, candidateImage],
        questions: {
          relationship: {
            type: 'choice',
            instructions: 'What relationship is best supported between the two product images?',
            criteria: {
              same_product: 'Strong evidence supports the same product/model or SKU family, with no important visible contradiction.',
              same_family: 'Same product family is plausible, but exact product/model is not sufficiently proven.',
              similar_only: 'Only category/style similarity is supported; identity is not established.',
              contradiction: 'A material visible or identity contradiction makes the candidate inconsistent with the selected object.'
            }
          },
          source_brand_visible: {
            type: 'noul',
            instructions: 'Is the proposed source brand literally supported by readable logo, text, or unmistakable marking in IMAGE 1?'
          },
          source_model_visible: {
            type: 'noul',
            instructions: 'Is the proposed source model/product-family identity literally supported by readable text or unmistakable model marking in IMAGE 1?'
          },
          candidate_brand_supported: {
            type: 'noul',
            instructions: 'Is the candidate brand supported by IMAGE 2 and supplied commerce metadata?'
          },
          candidate_model_supported: {
            type: 'noul',
            instructions: 'Is the candidate model/product-family identity supported by IMAGE 2 and supplied commerce metadata?'
          },
          critical_contradiction: {
            type: 'noul',
            instructions: 'Is there a critical contradiction in product type, dominant color family, sleeve/form, visible branding, model markings, silhouette, or distinctive construction?'
          }
        }
      });
      const modelMs = Date.now() - modelStarted;
      const root = answerRoot(raw);
      const answers = record(root.answers) ?? {};
      const relation = choice(answers.relationship);
      if (!relation) return json({ error: 'Clef returned no relationship choice' }, 502);

      const contradiction = noul(answers.critical_contradiction) ?? 0;
      const relationConfidence = choiceConfidence(answers.relationship, relation);
      const similarity = contradiction >= 0.7
        ? 0.2
        : relation === 'same_product' ? 0.95
        : relation === 'same_family' ? 0.78
        : relation === 'similar_only' ? 0.62
        : 0.2;

      const source = sourceEvidence(body.source_description);
      const candidate = candidateEvidence(body.candidate);

      if (source.brand && (noul(answers.source_brand_visible) ?? 0) >= 0.7) {
        source.brand = { ...source.brand, basis: 'image', confidence: Math.max(source.brand.confidence, 0.9) };
      } else {
        delete source.brand;
      }
      if (source.model && (noul(answers.source_model_visible) ?? 0) >= 0.7) {
        source.model = { ...source.model, basis: 'image', confidence: Math.max(source.model.confidence, 0.9) };
      } else {
        delete source.model;
      }
      if ((noul(answers.candidate_brand_supported) ?? 0) < 0.6) delete candidate.brand;
      if ((noul(answers.candidate_model_supported) ?? 0) < 0.6) delete candidate.model;

      const comparison: ImageComparison = {
        source,
        candidate,
        similarity,
        confidence: Math.max(0.65, Math.min(0.99, relationConfidence)),
        matching_details: relation === 'same_product'
          ? ['Clef found strong product-level visual agreement']
          : relation === 'same_family'
            ? ['Clef found product-family visual agreement']
            : [],
      };

      const decision = verifyCandidate(body.source_description, body.candidate, comparison);
      return json({
        relationship: relation,
        comparison,
        decision,
        timing: {
          total_ms: Date.now() - started,
          model_ms: modelMs,
        },
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  },
};
