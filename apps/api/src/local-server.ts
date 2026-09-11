import { GroqVisionProvider } from './groq-vision.js';
import { GeminiVisionProvider } from './gemini-vision.js';
import { normalizeObjectDescription } from './types.js';

export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VISION_PROVIDER?: string;
  GEMINI_MODEL?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logSafeError(error: unknown): void {
  if (error instanceof Error) {
    console.error('Vision error', { name: error.name, message: error.message });
  } else {
    console.error('Vision error', { name: typeof error, message: String(error) });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/analyze-selection') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonResponse({ error: 'dataUrl image is required' }, 400);
      }

      const dataUrl = (parsed as { dataUrl?: unknown }).dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return jsonResponse({ error: 'dataUrl image is required' }, 400);
      }

      const useGemini = env.VISION_PROVIDER === 'gemini';
      const apiKey = useGemini ? env.GEMINI_API_KEY : env.GROQ_API_KEY;
      if (!apiKey) return jsonResponse({ error: `Missing ${useGemini ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'}` }, 500);

      const provider = useGemini ? new GeminiVisionProvider(apiKey, env.GEMINI_MODEL) : new GroqVisionProvider(apiKey);
      const result = normalizeObjectDescription(await provider.analyzeSelection(dataUrl));
      return jsonResponse(result);
    } catch (error) {
      logSafeError(error);
      return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown analysis error' }, 500);
    }
  },
};
