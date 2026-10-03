import type { WorkersAiBinding } from './jev.js';
import { VercelJevBinding } from './vercel-jev.js';

export type JevBindingEnv = {
  AI?: WorkersAiBinding;
  AI_GATEWAY_API_KEY?: string;
};

const CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
const CLEF_FLASH_SELECTOR = 'clef-flash';

function clefFlashBinding(ai: WorkersAiBinding): WorkersAiBinding {
  return {
    modelId: CLEF_FLASH_MODEL,
    run(_model, input) {
      // Clef is System One / Jev API compatible, but Workers AI also expects
      // the Clef model selector in the request payload.
      const payload = { ...input, model: CLEF_FLASH_SELECTOR };
      return ai.run(CLEF_FLASH_MODEL, payload);
    },
  };
}

export function resolveJevBinding(env: JevBindingEnv): WorkersAiBinding | undefined {
  // EXPERIMENT BRANCH ONLY (#327): route the existing Jev decision schema to
  // Clef-Flash through the Workers AI binding. This branch is benchmark-only
  // and must not be merged until frozen-case results satisfy the trust gates.
  if (env.AI) return clefFlashBinding(env.AI);

  // Preserve a fail-open fallback for environments without Workers AI.
  if (env.AI_GATEWAY_API_KEY) return new VercelJevBinding(env.AI_GATEWAY_API_KEY);
  return undefined;
}
