import { createServer } from 'node:http';
import { GroqVisionProvider } from './groq-vision.js';
import { GeminiVisionProvider } from './gemini-vision.js';
import { normalizeObjectDescription } from './types.js';

const port = Number(process.env.PORT || 8787);
const useGemini = process.env.VISION_PROVIDER === 'gemini';
const apiKey = useGemini ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error(`Missing ${useGemini ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'}`);
  process.exit(1);
}

const provider = useGemini ? new GeminiVisionProvider(apiKey) : new GroqVisionProvider(apiKey);

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

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/analyze-selection') {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    if (typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'dataUrl image is required' }));
      return;
    }

    const result = normalizeObjectDescription(await provider.analyzeSelection(parsed.dataUrl));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {
    logSafeError(error);
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown analysis error' }),
    );
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`VCL Spike 3 API listening on http://127.0.0.1:${port}`);
});
