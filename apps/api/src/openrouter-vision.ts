import { normalizeObjectDescription, type ObjectDescription, type ProviderUsage, type VisionProvider } from './types.js';
import { VisionProviderError, type VisionFailureReason } from './gemini-vision.js';
import { FIELD_CONFIDENCE_PROMPT, nearbyPrompt, normalizeNearbyObservation } from './frame-evidence-prompt.js';
import { clickedObjectPrompt, normalizeTargetBox, selectionTargetPrompt, type SelectionPoint } from './selection-target.js';
import { OCR_PROMPT, normalizeOcrEvidence, type OcrEvidence } from './ocr-evidence.js';

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';
const PROMPT = 'Analyze only the selected object crop. Return JSON only with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, visible_text, logos_markings, distinctive_features, hardware_details, shape_silhouette, search_terms, confidence, identity_confidence. Extract only visually supported evidence. category should be broad, but subcategory must be the most specific visible product type you can support. For apparel, do not use generic labels such as Tops when a more specific visible garment type is supported. Prefer concrete subcategories such as Sweater, Jumper, Pullover, Polo, T-shirt, Shirt, Jacket, Coat, Hoodie, Dress, Trousers, Jeans, Shorts, or Cardigan. Use cut, sleeve length, neckline, collar, knit construction, closures, silhouette, and other visible structural cues to choose the specific garment type. visible_text should contain readable words/letters/numbers actually visible. logos_markings should describe visible logos, emblems, monograms, patches, labels, or symbols without guessing a brand unless supported. distinctive_features should capture unusual graphics, patterns, construction details, placements, trims, stitching, motifs, or design elements. hardware_details should capture buckles, clasps, buttons, zippers, fasteners, crowns, bezels, soles, laces, ports, or other product-specific hardware when relevant. shape_silhouette should capture recognizable shape, cut, proportions, collar, neckline, sleeve form, knit structure, case shape, frame, toe shape, bag profile, or other structural cues. confidence is confidence that the description is commercially searchable. identity_confidence is confidence that the proposed brand/model identity is visually supported. If brand/model evidence is weak, use null and keep identity_confidence low. Do not infer a famous brand from style alone. search_terms should be 1-4 concise purchase-search queries that use the strongest visible identity evidence first.';

function classify(status: number, message: string): VisionFailureReason {
  if (status === 429) return /quota|credit|balance|insufficient/i.test(message) ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'PROVIDER_AUTH';
  if (status >= 500) return 'PROVIDER_5XX';
  return 'PROVIDER_ERROR';
}

function usage(payload: any, model: string): ProviderUsage {
  const u = payload?.usage ?? {};
  return {
    provider: 'openrouter',
    model: typeof payload?.model === 'string' ? payload.model : model,
    requests: 1,
    prompt_tokens: Number(u.prompt_tokens ?? 0),
    completion_tokens: Number(u.completion_tokens ?? 0),
    total_tokens: Number(u.total_tokens ?? 0),
    ...(Number.isFinite(Number(u.cost)) ? { cost_usd: Number(u.cost) } : {}),
  };
}

function parseText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
    if (text) return text;
  }
  throw new Error('OpenRouter model returned no text output.');
}

export class OpenRouterVisionProvider implements VisionProvider {
  constructor(private readonly apiKey: string, private readonly model = DEFAULT_OPENROUTER_MODEL) {}

  async analyzeSelection(dataUrl: string, point?: SelectionPoint, detailDataUrl?: string): Promise<ObjectDescription> {
    const detailPrompt = detailDataUrl
      ? ' IMAGE 1 is the selected object with context. IMAGE 2 is a magnified detail around the user click. Use IMAGE 2 to read small text, logos, markings, stitching, hardware, and distinctive details, but keep IMAGE 1 authoritative for the object identity and overall shape.'
      : '';
    const result = await this.generate(PROMPT + detailPrompt + FIELD_CONFIDENCE_PROMPT + clickedObjectPrompt(point), detailDataUrl ? [dataUrl, detailDataUrl] : [dataUrl]);
    const description = normalizeObjectDescription(result.value);
    return { ...description, provider_usage: result.usage };
  }

  async readTextEvidence(dataUrl: string): Promise<OcrEvidence> {
    const result = await this.generate(OCR_PROMPT, [dataUrl]);
    return normalizeOcrEvidence(result.value);
  }

  async locateSelection(dataUrl: string, focusDataUrl: string, point: SelectionPoint) {
    const result = await this.generate(selectionTargetPrompt(point), [dataUrl, focusDataUrl]);
    return { ...normalizeTargetBox(result.value, point), provider_usage: result.usage };
  }

  async analyzeNearbyFrame(primary: string, nearby: string, description: ObjectDescription, point?: SelectionPoint) {
    const result = await this.generate(nearbyPrompt(description) + clickedObjectPrompt(point), [primary, nearby]);
    const observation = normalizeNearbyObservation(result.value);
    return { ...observation, description: { ...observation.description, provider_usage: result.usage } };
  }

  private async generate(prompt: string, images: string[]): Promise<{ value: unknown; usage: ProviderUsage }> {
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://scoop.article6.org',
          'X-Title': 'Scoop',
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          }],
          // Production privacy guardrail: route only to endpoints that do not
          // collect prompts for training/storage and that support zero data retention.
          provider: {
            data_collection: 'deny',
            zdr: true,
          },
          response_format: { type: 'json_object' },
          temperature: 0.2,
          usage: { include: true },
        }),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new VisionProviderError('PROVIDER_TIMEOUT', 'OpenRouter vision request timed out.');
      throw error;
    }

    const payload = await response.json() as any;
    if (!response.ok) {
      const message = payload?.error?.message || `OpenRouter vision failed with HTTP ${response.status}.`;
      throw new VisionProviderError(classify(response.status, message), message);
    }

    const text = parseText(payload);
    return {
      value: JSON.parse(text.trim().replace(/^\`\`\`json\s*/i, '').replace(/\s*\`\`\`$/, '')),
      usage: usage(payload, this.model),
    };
  }
}
