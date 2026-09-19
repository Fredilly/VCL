import type { WorkersAiBinding } from './jev.js';
import { VercelJevBinding } from './vercel-jev.js';

export type JevBindingEnv = {
  AI?: WorkersAiBinding;
  AI_GATEWAY_API_KEY?: string;
};

export function resolveJevBinding(env: JevBindingEnv): WorkersAiBinding | undefined {
  if (env.AI) return env.AI;
  if (env.AI_GATEWAY_API_KEY) return new VercelJevBinding(env.AI_GATEWAY_API_KEY);
  return undefined;
}
