import type { WorkersAiBinding } from './jev.js';

export type JevBindingEnv = {
  AI?: WorkersAiBinding;
  JEV_ROUTER_MODEL?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
};

const CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
const CLEF_FLASH_SELECTOR = 'clef-flash';
const CLOUDFLARE_JEV_MODEL = 'typesafe/jev';
const CLOUDFLARE_JEV_SELECTOR = 'jev-cloudflare';

type CloudflareAiRun = (
  model: string,
  input: Parameters<WorkersAiBinding['run']>[1],
  options?: { gateway?: { id: string } },
) => Promise<unknown>;

function clefFlashBinding(ai: WorkersAiBinding): WorkersAiBinding {
  return {
    modelId: CLEF_FLASH_MODEL,
    run(_model, input) {
      const payload = { ...input, model: CLEF_FLASH_SELECTOR };
      return ai.run(CLEF_FLASH_MODEL, payload);
    },
  };
}

function cloudflareJevBinding(ai: WorkersAiBinding, gatewayId: string): WorkersAiBinding {
  const run = ai.run.bind(ai) as CloudflareAiRun;
  return {
    modelId: CLOUDFLARE_JEV_MODEL,
    run(_model, input) {
      // Jev is a third-party model on Cloudflare. Route it explicitly through
      // AI Gateway so billing/observability are deterministic instead of relying
      // on account defaults.
      return run(CLOUDFLARE_JEV_MODEL, input, {
        gateway: { id: gatewayId },
      });
    },
  };
}

export function resolveJevBinding(env: JevBindingEnv): WorkersAiBinding | undefined {
  if (!env.AI) return undefined;

  if (env.JEV_ROUTER_MODEL === CLEF_FLASH_SELECTOR) {
    return clefFlashBinding(env.AI);
  }

  // Cloudflare-first Jev path. The gateway defaults to Cloudflare's "default"
  // gateway unless Scoop is configured with a dedicated gateway id.
  if (!env.JEV_ROUTER_MODEL || env.JEV_ROUTER_MODEL === CLOUDFLARE_JEV_SELECTOR) {
    return cloudflareJevBinding(
      env.AI,
      env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || 'default',
    );
  }

  return undefined;
}
