import { normalizeObjectDescription, type ObjectDescription, type VisionProvider } from './types.js';

const PROMPT = 'Analyze only the selected object crop. Return JSON only with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, search_terms, confidence.';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

function imagePart(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('dataUrl must be a base64 image data URL.');
  return { mimeType: match[1], data: match[2] };
}

export class GeminiVisionProvider implements VisionProvider {
  constructor(private readonly apiKey: string, private readonly model = DEFAULT_GEMINI_MODEL) {}

  async analyzeSelection(dataUrl: string): Promise<ObjectDescription> {
    const image = imagePart(dataUrl);
    const send = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: image }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    });
    let response = await send();
    // Gemini capacity errors are transient. Allow two retries, then preserve the error.
    for (let retry = 0; response.status === 503 && retry < 2; retry++) {
      await response.body?.cancel();
      await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** retry));
      response = await send();
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`);
    const text = payload?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text;
    if (typeof text !== 'string') throw new Error('Model returned no text output.');
    return normalizeObjectDescription(JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')));
  }
}
