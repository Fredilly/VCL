import { normalizeObjectDescription, type ObjectDescription, type VisionProvider } from './types.js';

const SYSTEM_PROMPT = `You are a visual product analyst. Analyze only the selected product/object crop. Return JSON only, with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, search_terms, confidence, identity_confidence. Do not identify a brand or model unless visually supported. confidence must be a number from 0 to 1 representing confidence that the description is commercially searchable. identity_confidence must be a number from 0 to 1 representing confidence that the proposed brand/model identity is visually supported. If brand/model evidence is weak, use null and keep identity_confidence low. Do not infer a famous brand from style alone. search_terms should contain 1-4 concise purchase-search queries.`;

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('dataUrl must be a base64 image data URL.');
  return { mimeType: match[1], data: match[2] };
}

export class GroqVisionProvider implements VisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'meta-llama/llama-4-scout-17b-16e-instruct',
  ) {}

  async analyzeSelection(dataUrl: string): Promise<ObjectDescription> {
    const image = parseDataUrl(dataUrl);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
        ] }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Model returned no text output.');
    return normalizeObjectDescription(JSON.parse(content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')));
  }
}
