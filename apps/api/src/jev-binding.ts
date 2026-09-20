import type { WorkersAiBinding } from './jev.js';
import { VercelJevBinding } from './vercel-jev.js';

export type JevBindingEnv = {
  AI?: WorkersAiBinding;
  AI_GATEWAY_API_KEY?: string;
};

export function resolveJevBinding(env: JevBindingEnv): WorkersAiBinding | undefined {
  // Jev is a third-party model on Cloudflare and requires AI Gateway credits.
  // Prefer the configured Vercel AI Gateway route, where Jev is currently free,
  // so the zero-budget path does not depend on prepaid Cloudflare credits.
  if (env.AI_GATEWAY_API_KEY) return new VercelJevBinding(env.AI_GATEWAY_API_KEY);
  if (env.AI) return env.AI;
  return undefined;
}
