import type { WorkersAiBinding } from './jev.js';

type FetchLike = typeof fetch;

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  const direct = record.error;
  if (typeof direct === 'string' && direct) return direct;
  if (direct && typeof direct === 'object') {
    const message = (direct as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  const message = record.message;
  return typeof message === 'string' && message ? message : fallback;
}

export class VercelJevBinding implements WorkersAiBinding {
  readonly modelId = 'typesafe-ai/jev';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async run(_model: string, input: Parameters<WorkersAiBinding['run']>[1]): Promise<unknown> {
    const response = await this.fetchImpl('https://ai-gateway.vercel.sh/v4/ai/evaluation-model', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'ai-gateway-protocol-version': '0.0.1',
        'ai-gateway-auth-method': 'api-key',
        'ai-evaluation-model-specification-version': '4',
        'ai-model-id': this.modelId,
      },
      body: JSON.stringify(input),
    });

    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch {}

    if (!response.ok) {
      const error = new Error(errorMessage(body, `Vercel AI Gateway HTTP ${response.status}`));
      Object.assign(error, { status: response.status, code: 'VERCEL_AI_GATEWAY_ERROR' });
      throw error;
    }

    return body;
  }
}
