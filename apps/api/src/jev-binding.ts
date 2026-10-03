import type { WorkersAiBinding } from './jev.js';
import { VercelJevBinding } from './vercel-jev.js';

export type JevBindingEnv = {
  AI?: WorkersAiBinding;
  AI_GATEWAY_API_KEY?: string;
  JEV_ROUTER_MODEL?: string;
};

const CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
const CLEF_FLASH_SELECTOR = 'clef-flash';

function clefFlashBinding(ai: WorkersAiBinding): WorkersAiBinding {
  return {
    modelId: CLEF_FLASH_MODEL,
    run(_model, input) {
      const payload = { ...input, model: CLEF_FLASH_SELECTOR };
      return ai.run(CLEF_FLASH_MODEL, payload);
    },
  };
}

export function resolveJevBinding(env: JevBindingEnv): WorkersAiBinding | undefined {
  if (env.JEV_ROUTER_MODEL === CLEF_FLASH_SELECTOR && env.AI) {
    return clefFlashBinding(env.AI);
  }

  // Current Scoop baseline: Vercel AI Gateway for Jev.
  if (env.AI_GATEWAY_API_KEY) return new VercelJevBinding(env.AI_GATEWAY_API_KEY);
  if (env.AI) return env.AI;
  return undefined;
}
