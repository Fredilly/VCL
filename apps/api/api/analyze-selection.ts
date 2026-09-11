import { GeminiVisionProvider } from '../src/gemini-vision.js';
import { GroqVisionProvider } from '../src/groq-vision.js';
import { normalizeObjectDescription } from '../src/types.js';

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function getProvider() {
  const providerName = process.env.VISION_PROVIDER || 'gemini';

  if (providerName === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('Missing GROQ_API_KEY');
    return new GroqVisionProvider(apiKey);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  return new GeminiVisionProvider(apiKey);
}

function logSafeError(error: unknown) {
  if (!(error instanceof Error)) {
    console.error('Vision error', { name: typeof error, message: String(error) });
    return;
  }

  const cause = error.cause;
  console.error('Vision error', {
    name: error.name,
    message: error.message,
    cause: cause instanceof Error
      ? { name: cause.name, code: (cause as NodeJS.ErrnoException).code, message: cause.message }
      : undefined,
  });
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    if (typeof body.dataUrl !== 'string' || !body.dataUrl.startsWith('data:image/')) {
      res.status(400).json({ error: 'dataUrl image is required' });
      return;
    }

    const provider = getProvider();
    const result = normalizeObjectDescription(await provider.analyzeSelection(body.dataUrl));
    res.status(200).json(result);
  } catch (error) {
    logSafeError(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown analysis error' });
  }
}
