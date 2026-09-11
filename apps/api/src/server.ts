import { createServer } from 'node:http';
import { OpenAIVisionProvider } from './openai-vision.js';

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const provider = new OpenAIVisionProvider(apiKey);

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

    const result = await provider.analyzeSelection(parsed.dataUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown analysis error' }),
    );
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`VCL Spike 3 API listening on http://127.0.0.1:${port}`);
});
