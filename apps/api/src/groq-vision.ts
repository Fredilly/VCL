import { normalizeObjectDescription, type ObjectDescription, type VisionProvider } from './types.js';
import { VisionProviderError, type VisionFailureReason } from './gemini-vision.js';
import { FIELD_CONFIDENCE_PROMPT, nearbyPrompt, normalizeNearbyObservation } from './frame-evidence-prompt.js';
import { clickedObjectPrompt, normalizeTargetBox, selectionTargetPrompt, type SelectionPoint } from './selection-target.js';

const SYSTEM_PROMPT = 'Analyze only the selected product/object crop. Return JSON only with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, visible_text, logos_markings, distinctive_features, hardware_details, shape_silhouette, search_terms, confidence, identity_confidence. Extract only visually supported evidence. category should be broad, but subcategory must be the most specific visible product type you can support. For apparel, do not use generic labels such as Tops when a more specific visible garment type is supported. Prefer concrete subcategories such as Sweater, Jumper, Pullover, Polo, T-shirt, Shirt, Jacket, Coat, Hoodie, Dress, Trousers, Jeans, Shorts, or Cardigan. Use cut, sleeve length, neckline, collar, knit construction, closures, silhouette, and other visible structural cues to choose the specific garment type. visible_text should contain readable words, letters, or numbers actually visible. logos_markings should describe visible logos, emblems, monograms, patches, labels, or symbols without guessing a brand unless supported. distinctive_features should capture unusual graphics, patterns, construction details, placements, trims, stitching, motifs, or design elements. hardware_details should capture relevant buckles, clasps, buttons, zippers, fasteners, crowns, bezels, soles, laces, ports, or other product-specific hardware. shape_silhouette should capture recognizable shape, cut, proportions, collar, neckline, sleeve form, knit structure, case shape, frame, toe shape, bag profile, or other structural cues. confidence is confidence that the description is commercially searchable. identity_confidence is confidence that the proposed brand/model identity is visually supported. Generic products may have low identity_confidence. If brand/model evidence is weak, use null. Do not infer a famous brand from style alone. search_terms should be 1-4 concise purchase-search queries using the strongest visible identity evidence first.';

type GroqRawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_time?: number;
  completion_time?: number;
  total_time?: number;
};

export type GroqUsageSnapshot = {
  provider: 'groq';
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_time_ms: number;
  completion_time_ms: number;
  total_time_ms: number;
};

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('dataUrl must be a base64 image data URL.');
  return { mimeType: match[1], data: match[2] };
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function classifyGroqFailure(status: number, message: string): VisionFailureReason {
  if (status === 429) return /quota|limit|exhaust/i.test(message) ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'PROVIDER_AUTH';
  if (status >= 500) return 'PROVIDER_5XX';
  return 'PROVIDER_ERROR';
}

export class GroqVisionProvider implements VisionProvider {
  private usage: GroqUsageSnapshot;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'qwen/qwen3.8-27b',
  ) {
    this.usage = {
      provider: 'groq', model, requests: 0,
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
      prompt_time_ms: 0, completion_time_ms: 0, total_time_ms: 0,
    };
  }

  getUsageSnapshot(): GroqUsageSnapshot {
    return { ...this.usage };
  }

  async analyzeSelection(dataUrl: string, point?: SelectionPoint): Promise<ObjectDescription> {
    const description = normalizeObjectDescription(await this.generate(SYSTEM_PROMPT + FIELD_CONFIDENCE_PROMPT + clickedObjectPrompt(point), [dataUrl]));
    return { ...description, provider_usage: this.getUsageSnapshot() };
  }

  async locateSelection(dataUrl: string, focusDataUrl: string, point: SelectionPoint) {
    const target = normalizeTargetBox(await this.generate(selectionTargetPrompt(point), [dataUrl, focusDataUrl]), point);
    return { ...target, provider_usage: this.getUsageSnapshot() };
  }

  async analyzeNearbyFrame(primary: string, nearby: string, description: ObjectDescription, point?: SelectionPoint) {
    return normalizeNearbyObservation(await this.generate(nearbyPrompt(description) + clickedObjectPrompt(point), [primary, nearby]));
  }

  private recordUsage(raw: GroqRawUsage | undefined) {
    this.usage.requests++;
    this.usage.prompt_tokens += finite(raw?.prompt_tokens);
    this.usage.completion_tokens += finite(raw?.completion_tokens);
    this.usage.total_tokens += finite(raw?.total_tokens);
    this.usage.prompt_time_ms += Math.round(finite(raw?.prompt_time) * 1000);
    this.usage.completion_time_ms += Math.round(finite(raw?.completion_time) * 1000);
    this.usage.total_time_ms += Math.round(finite(raw?.total_time) * 1000);
  }

  private async generate(prompt: string, images: string[]): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          ...images.map((dataUrl) => { const image = parseDataUrl(dataUrl); return { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }; }),
        ] }],
        response_format: { type: 'json_object' },
        reasoning_effort: 'none',
        reasoning_format: 'hidden',
        max_completion_tokens: 1024,
        temperature: 0.2,
      }),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new VisionProviderError('PROVIDER_TIMEOUT', 'Vision provider request timed out.');
      throw error;
    }
    const payload = await response.json();
    this.recordUsage(payload?.usage);
    if (!response.ok) {
      const message = payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`;
      throw new VisionProviderError(classifyGroqFailure(response.status, message), message);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Model returned no text output.');
    return JSON.parse(content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
  }
}
