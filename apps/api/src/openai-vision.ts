import type { ObjectDescription, VisionProvider } from './types.js';

const SYSTEM_PROMPT = `You are a visual product analyst. Analyze only the selected product/object crop. Return JSON only, with exactly these fields: category, subcategory, brand_candidate, model_candidate, color, material, style_attributes, search_terms, confidence. Do not identify a brand or model unless visually supported. confidence must be a number from 0 to 1 representing confidence that the description is commercially searchable, not exact-SKU confidence. search_terms should contain 1-4 concise purchase-search queries.`;

function extractOutputText(response: any): string {
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('Model returned no text output.');
}

function validate(value: any): ObjectDescription {
  if (!value || typeof value !== 'object') throw new Error('Vision output was not an object.');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Vision output had invalid confidence.');
  return {
    category: String(value.category ?? ''),
    subcategory: String(value.subcategory ?? ''),
    brand_candidate: value.brand_candidate == null ? null : String(value.brand_candidate),
    model_candidate: value.model_candidate == null ? null : String(value.model_candidate),
    color: String(value.color ?? ''),
    material: String(value.material ?? ''),
    style_attributes: Array.isArray(value.style_attributes) ? value.style_attributes.map(String).slice(0, 12) : [],
    search_terms: Array.isArray(value.search_terms) ? value.search_terms.map(String).slice(0, 4) : [],
    confidence,
  };
}

export class OpenAIVisionProvider implements VisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  ) {}

  async analyzeSelection(dataUrl: string): Promise<ObjectDescription> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: 'none' },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: SYSTEM_PROMPT },
              { type: 'input_image', image_url: dataUrl, detail: 'high' },
            ],
          },
        ],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Vision provider failed with HTTP ${response.status}.`);
    }

    const text = extractOutputText(payload).trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    return validate(JSON.parse(text));
  }
}
