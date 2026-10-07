import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function appendPromotionFixtures(fixtures, directory) {
  mkdirSync(directory, { recursive: true });
  const written = [];
  for (const fixture of fixtures) {
    if (!fixture?.id || fixture.truth !== 'IN_ROSTER' || !fixture.comparisons || !fixture.candidates?.some(row => row.identity.canonical_key === fixture.expected_class)) throw new Error('Invalid promoted fixture');
    const name = `${createHash('sha256').update(fixture.id).digest('hex')}.json`;
    const path = resolve(directory, name);
    const content = JSON.stringify(fixture, null, 2) + '\n';
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) throw new Error(`Frozen correction changed: ${fixture.id}`);
    } else writeFileSync(path, content, { flag: 'wx' });
    written.push(path);
  }
  return written;
}

async function main() {
  const [action, filename] = process.argv.slice(2);
  const paths = { import: '/partner-roster', promote: '/feedback-promote', review: '/feedback-review', export: '/learning-export' };
  if (!paths[action]) throw new Error('Use import, review, promote or export');
  const base = process.env.SCOOP_API_URL;
  const session = process.env.SCOOP_ADMIN_SESSION;
  if (!base || !session || !base.startsWith('https://')) throw new Error('SCOOP_API_URL (HTTPS) and SCOOP_ADMIN_SESSION are required');
  const body = action === 'export' ? {} : JSON.parse(readFileSync(filename, 'utf8'));
  if (action === 'import' && (!Array.isArray(body.offers) || !body.offers.length)) throw new Error('Import requires all supplied links as offer rows');
  const requests = action === 'import' ? Array.from({ length: Math.ceil(body.offers.length / 6) }, (_, index) => ({ ...body, offers: body.offers.slice(index * 6, (index + 1) * 6) })) : [body];
  let result;
  let importedOffers = 0;
  for (const payload of requests) {
  const response = await fetch(new URL(paths[action], base), { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-scoop-admin-session': session }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
  result = await response.json();
  if (!response.ok) throw new Error(`Learning request failed (${response.status}): ${result.error || 'unknown error'}`);
  importedOffers += payload.offers?.length || 0;
  }
  if (action === 'import') result = { accepted: true, merchant_offers: importedOffers, batches: requests.length };
  if (action === 'export') {
    const paths = appendPromotionFixtures(result.fixtures, filename || 'tests/benchmark/roster-outliers/promoted');
    console.log(JSON.stringify({ saved_cases: paths.length, metrics: result.metrics }, null, 2));
  } else {
    if ((action === 'review' || action === 'promote') && result.learned) {
      const exported = await fetch(new URL('/learning-export', base), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-scoop-admin-session': session }, body: '{}', signal: AbortSignal.timeout(30000) });
      if (!exported.ok) throw new Error('Promotion saved, but harness export failed; retry export before treating this workflow as complete');
      const report = await exported.json();
      result.harness_cases = appendPromotionFixtures(report.fixtures, 'tests/benchmark/roster-outliers/promoted').length;
    }
    console.log(JSON.stringify(result, null, 2));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
