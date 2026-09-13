// Controlled Spike 4e fixtures. Generated media lives only in memory; no frame files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const page = await readFile(new URL('./multi-frame.html', import.meta.url));
const media = new Map();
createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const key = /^\/media\/(bottle|bag|watch|cut)\.webm$/.exec(request.url)?.[1];
  if (key && request.method === 'POST') {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 3_000_000) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    media.set(key, Buffer.concat(chunks)); response.writeHead(204).end(); return;
  }
  if (key && media.has(key)) {
    const bytes = media.get(key);
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end) { response.writeHead(416).end(); return; }
    response.setHeader('Content-Type', 'video/webm'); response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Length', end - start + 1);
    if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    response.writeHead(range ? 206 : 200).end(bytes.subarray(start, end + 1)); return;
  }
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(page); return; }
  response.writeHead(404).end();
}).listen(8799, '127.0.0.1', () => console.log('Spike 4e controlled fixtures: http://127.0.0.1:8799 (memory only)'));
