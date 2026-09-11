import { normalizeObjectDescription, type ObjectDescription, type VisionProvider } from './types.js';

const PROMPT = 'Analyze only the selected object crop. Return JSON only with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, search_terms, confidence.';

function imagePart(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('dataUrl must be a base64 image data URL.');
  return { mimeType: match[1], data: match[2] };
}

export class GeminiVisionProvider implements VisionProvider {
  constructor(private readonly apiKey: string, private readonly model = process.env.GEMINI_MODEL || 'gemini-2.5-flash') {}

  async analyzeSelection(dataUrl: string): Promise<ObjectDescription> {
    const image = imagePart(dataUrl);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: image }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`);
    const text = payload?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text;
    if (typeof text !== 'string') throw new Error('Model returned no text output.');
    return normalizeObjectDescription(JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')));
  }
}
