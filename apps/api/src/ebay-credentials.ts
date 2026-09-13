export type EbayEnvironment = 'sandbox' | 'production';

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
  devId?: string;
  sandbox: boolean;
}

export interface EbayEnvInput {
  EBAY_SANDBOX_CLIENT_ID?: string;
  EBAY_SANDBOX_CLIENT_SECRET?: string;
  EBAY_PRODUCTION_CLIENT_ID?: string;
  EBAY_PRODUCTION_CLIENT_SECRET?: string;
  EBAY_DEV_ID?: string;
  EBAY_ENVIRONMENT?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_SANDBOX?: string;
}

function buildCredentials(clientId: string, clientSecret: string, devId: string | undefined, sandbox: boolean): EbayCredentials {
  const creds: EbayCredentials = { clientId, clientSecret, sandbox };
  if (devId) creds.devId = devId;
  return creds;
}

export function resolveEbayCredentials(env: EbayEnvInput): EbayCredentials | null {
  const envKey = env.EBAY_ENVIRONMENT?.toLowerCase();

  if (envKey === 'sandbox') {
    const id = env.EBAY_SANDBOX_CLIENT_ID;
    const secret = env.EBAY_SANDBOX_CLIENT_SECRET;
    if (id && secret) return buildCredentials(id, secret, env.EBAY_DEV_ID, true);
    return null;
  }

  if (envKey === 'production') {
    const id = env.EBAY_PRODUCTION_CLIENT_ID;
    const secret = env.EBAY_PRODUCTION_CLIENT_SECRET;
    if (id && secret) return buildCredentials(id, secret, env.EBAY_DEV_ID, false);
    return null;
  }

  if (envKey) return null;

  const sandboxId = env.EBAY_SANDBOX_CLIENT_ID;
  const sandboxSecret = env.EBAY_SANDBOX_CLIENT_SECRET;
  const prodId = env.EBAY_PRODUCTION_CLIENT_ID;
  const prodSecret = env.EBAY_PRODUCTION_CLIENT_SECRET;

  const sandboxPair = !!(sandboxId && sandboxSecret);
  const prodPair = !!(prodId && prodSecret);

  if (sandboxPair && prodPair) return null;
  if (sandboxPair) return buildCredentials(sandboxId!, sandboxSecret!, env.EBAY_DEV_ID, true);
  if (prodPair) return buildCredentials(prodId!, prodSecret!, env.EBAY_DEV_ID, false);

  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) {
    return buildCredentials(env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET, env.EBAY_DEV_ID, env.EBAY_SANDBOX !== 'false');
  }

  return null;
}
