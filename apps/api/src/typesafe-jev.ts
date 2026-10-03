import type { WorkersAiBinding } from './jev.js';

type FetchLike = typeof fetch;

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  const direct = record.detail ?? record.error ?? record.message;
  if (typeof direct === 'string' && direct) return direct;
  return fallback;
}

export class TypeSafeJevBinding implements WorkersAiBinding {
  readonly modelId = 'jev-latest';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async run(_model: string, input: Parameters<WorkersAiBinding['run']>[1]): Promise<unknown> {
    const response = await this.fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...input,
        model: this.modelId,
      }),
    });

    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch {}

    if (!response.ok) {
      const error = new Error(errorMessage(body, `TypeSafe Jev HTTP ${response.status}`));
      Object.assign(error, { status: response.status, code: 'TYPESAFE_JEV_ERROR' });
      throw error;
    }

    return body;
  }
}
