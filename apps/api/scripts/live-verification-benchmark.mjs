// pnpm build first. No local credentials: exercises the existing deployed Worker.
// Usage: node apps/api/scripts/live-verification-benchmark.mjs [case-id] [report-path]
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { liveApparel } from '../tests/fixtures/live-apparel.mjs';

function request(url, body) {
  return new Promise((resolve, reject) => {
    const args = ['--fail-with-body', '--silent', '--show-error', '--location', '--max-time', '240', url];
    if (body) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
    const child = spawn('curl', args);
    const chunks = []; let error = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`HTTP request failed (${code}): ${error} ${Buffer.concat(chunks).toString().slice(0, 200)}`)));
    child.stdin.end(body ? JSON.stringify(body) : undefined);
  });
}

const selected = process.argv[2] ? liveApparel.filter((item) => item.id === process.argv[2]) : liveApparel;
if (!selected.length) throw new Error('Unknown benchmark case');
const report = [];
for (const fixture of selected) {
  const started = Date.now();
  try {
    const bytes = await request(fixture.image);
    const mime = bytes[0] === 0x89 ? 'image/png' : bytes.toString('ascii', 0, 4) === 'RIFF' ? 'image/webp' : 'image/jpeg';
    const description = { category: 'Apparel', subcategory: fixture.subtype, brand_candidate: fixture.brand, model_candidate: null,
      color: fixture.color, material: '', style_attributes: [fixture.gender, fixture.sleeve ? `${fixture.sleeve} sleeve` : null].filter(Boolean),
      visible_text: [], logos_markings: [], distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: [],
      confidence: 0.95, identity_confidence: 0.95 };
    const result = JSON.parse(await request('https://api.vcl.article6.org/resolve-products', { description,
      source_image: `data:${mime};base64,${bytes.toString('base64')}`, context: { title: `${fixture.brand} ${fixture.subtype} catalog photograph` } }));
    const row = { case: fixture.id, source: fixture.page, elapsed_ms: Date.now() - started, ...result };
    report.push(row);
    console.log(JSON.stringify({ case: row.case, state: row.state, elapsed_ms: row.elapsed_ms, verification: row.verification,
      products: row.products?.map((p) => ({ title: p.title, classification: p.result_class, score: p.verification_score, status: p.verification_status, reasons: p.verification_reasons })) }));
  } catch (error) { const row = { case: fixture.id, error: error.message, elapsed_ms: Date.now() - started }; report.push(row); console.log(JSON.stringify(row)); }
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
if (report.some((row) => row.error)) process.exitCode = 1;
