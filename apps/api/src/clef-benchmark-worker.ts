import { routeWithJev, type JevRouterInput } from './jev-router.js';
import { resolveJevBinding } from './jev-binding.js';
import { TypeSafeJevBinding } from './typesafe-jev.js';
import type { WorkersAiBinding } from './jev.js';

interface Env {
  AI?: WorkersAiBinding;
  JEV_ROUTER_MODEL?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
    let input: JevRouterInput;
    try {
      input = await request.json() as JevRouterInput;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const typesafeKey = request.headers.get('x-benchmark-typesafe-key');
    const binding = typesafeKey
      ? new TypeSafeJevBinding(typesafeKey)
      : resolveJevBinding({ ...env, JEV_ROUTER_MODEL: 'clef-flash' });

    if (!binding) return json({ error: 'router binding unavailable' }, 503);
    const result = await routeWithJev(input, binding, 5000);
    return json(result, result.telemetry.failed ? 502 : 200);
  },
};
