export interface BraveCredentials {
  apiKey: string;
}

export interface BraveEnvInput {
  BRAVE_SEARCH_API_KEY?: string;
}

export function resolveBraveCredentials(env: BraveEnvInput): BraveCredentials | null {
  const apiKey = env.BRAVE_SEARCH_API_KEY;
  if (apiKey && apiKey.trim()) {
    return { apiKey: apiKey.trim() };
  }
  return null;
}
