interface Env {
  AI: {
    run(model: string, input: {
      model: string;
      state: unknown;
      questions: Record<string, unknown>;
      images?: string[];
    }): Promise<unknown>;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

    let body: {
      source_image?: string;
      candidate_image_url?: string;
      source_description?: unknown;
      candidate?: unknown;
    };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (typeof body.source_image !== 'string' || typeof body.candidate_image_url !== 'string') {
      return json({ error: 'source_image and candidate_image_url are required' }, 400);
    }

    try {
      const candidateImage = await imageDataUrl(body.candidate_image_url);
      const result = await env.AI.run('@cf/cloudflare/clef', {
        model: 'clef',
        state: {
          task: 'Compare the selected product crop with one candidate product image. Pixels are primary evidence. Candidate metadata may support identity but must not override visible contradictions. Do not infer brand/model from style alone.',
          source_description: body.source_description ?? null,
          candidate: body.candidate ?? null,
        },
        images: [body.source_image, candidateImage],
        questions: {
          relationship: {
            type: 'choice',
            instructions: 'What relationship is supported between IMAGE 1 selected object and IMAGE 2 candidate product?',
            criteria: {
              same_product: 'Strong visual and identity evidence supports the same product/model or SKU family with no important contradiction.',
              same_family: 'Same brand/product family is plausible, but exact product/model is not sufficiently proven.',
              similar_only: 'Visually similar category/style, but identity evidence is insufficient.',
              contradiction: 'A material visible or identity contradiction makes the candidate inconsistent with the selected object.'
            }
          },
          brand_supported: {
            type: 'noul',
            instructions: 'Is the candidate brand supported by visible evidence from the selected object and candidate together?'
          },
          model_supported: {
            type: 'noul',
            instructions: 'Is the candidate model/product-family identity supported by the two images together?'
          },
          critical_contradiction: {
            type: 'noul',
            instructions: 'Is there a critical contradiction in product type, color family, sleeve/form, gender designation, visible branding, model markings, shape, or distinctive construction?'
          }
        }
      });
      return json({ result });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  },
};
