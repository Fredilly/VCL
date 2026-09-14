import { normalizeObjectDescription, type ObjectDescription, type VisionProvider } from './types.js';
import { FIELD_CONFIDENCE_PROMPT, nearbyPrompt, normalizeNearbyObservation } from './frame-evidence-prompt.js';
import { TARGET_BOX_SCHEMA, clickedObjectPrompt, normalizeTargetBox, selectionTargetPrompt, type SelectionPoint } from './selection-target.js';

const PROMPT = 'Analyze only the selected object crop. Return JSON only with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, visible_text, logos_markings, distinctive_features, hardware_details, shape_silhouette, search_terms, confidence, identity_confidence. Extract only visually supported evidence. category should be broad, but subcategory must be the most specific visible product type you can support. For apparel, do not use generic labels such as Tops when a more specific visible garment type is supported. Prefer concrete subcategories such as Sweater, Jumper, Pullover, Polo, T-shirt, Shirt, Jacket, Coat, Hoodie, Dress, Trousers, Jeans, Shorts, or Cardigan. Use cut, sleeve length, neckline, collar, knit construction, closures, silhouette, and other visible structural cues to choose the specific garment type. visible_text should contain readable words/letters/numbers actually visible. logos_markings should describe visible logos, emblems, monograms, patches, labels, or symbols without guessing a brand unless supported. distinctive_features should capture unusual graphics, patterns, construction details, placements, trims, stitching, motifs, or design elements. hardware_details should capture buckles, clasps, buttons, zippers, fasteners, crowns, bezels, soles, laces, ports, or other product-specific hardware when relevant. shape_silhouette should capture recognizable shape, cut, proportions, collar, neckline, sleeve form, knit structure, case shape, frame, toe shape, bag profile, or other structural cues. confidence is confidence that the description is commercially searchable. identity_confidence is confidence that the proposed brand/model identity is visually supported. If brand/model evidence is weak, use null and keep identity_confidence low. Do not infer a famous brand from style alone. search_terms should be 1-4 concise purchase-search queries that use the strongest visible identity evidence first.';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

function imagePart(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('dataUrl must be a base64 image data URL.');
  return { mimeType: match[1], data: match[2] };
}

export class GeminiVisionProvider implements VisionProvider {
  constructor(private readonly apiKey: string, private readonly model = DEFAULT_GEMINI_MODEL) {}

  async analyzeSelection(dataUrl: string, point?: SelectionPoint): Promise<ObjectDescription> {
    return normalizeObjectDescription(await this.generate(PROMPT + FIELD_CONFIDENCE_PROMPT + clickedObjectPrompt(point), [dataUrl]));
  }

  async locateSelection(dataUrl: string, focusDataUrl: string, point: SelectionPoint) {
    return normalizeTargetBox(await this.generate(selectionTargetPrompt(point), [dataUrl, focusDataUrl], TARGET_BOX_SCHEMA), point);
  }

  async analyzeNearbyFrame(primary: string, nearby: string, description: ObjectDescription, point?: SelectionPoint) {
    return normalizeNearbyObservation(await this.generate(nearbyPrompt(description) + clickedObjectPrompt(point), [primary, nearby]));
  }

  private async generate(prompt: string, images: string[], schema?: object): Promise<unknown> {
    const send = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((image) => ({ inlineData: imagePart(image) }))] }], generationConfig: { responseMimeType: 'application/json', ...(schema ? { responseJsonSchema: schema } : {}), temperature: 0.2 } }),
    });
    let response = await send();
    for (let retry = 0; response.status === 503 && retry < 2; retry++) {
      await response.body?.cancel();
      await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** retry));
      response = await send();
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`);
    const text = payload?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text;
    if (typeof text !== 'string') throw new Error('Model returned no text output.');
    return JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
  }
}
