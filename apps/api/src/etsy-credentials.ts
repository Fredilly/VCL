export interface EtsyCredentials {
  apiKey: string;
  sharedSecret: string;
}

export interface EtsyEnvInput {
  ETSY_KEYSTRING?: string;
  ETSY_SHARED_SECRET?: string;
}

export function resolveEtsyCredentials(env: EtsyEnvInput): EtsyCredentials | null {
  const keystring = env.ETSY_KEYSTRING;
  const sharedSecret = env.ETSY_SHARED_SECRET;
  if (keystring && sharedSecret) {
    return { apiKey: keystring, sharedSecret };
  }
  return null;
}
