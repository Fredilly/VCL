#!/usr/bin/env node
/**
 * Automated Golden identity run.
 *
 * Runs the frozen cases in tests/golden/cases.json against a LOCAL worker and
 * records an immutable result file. It is an identity smoke test, not a
 * replacement for the manual three-run PASS procedure in tests/golden/README.md:
 * it scores object identity from the resolver's own query terms, because the
 * click point in each case is prose and cannot be reproduced as coordinates by a
 * machine without inventing them.
 *
 * Frames are supplied, never fetched: YouTube refuses datacenter IPs, and the
 * alternative (session cookies) is a credential this harness must not handle.
 * A case with no frame is recorded BLOCKED_NO_FRAME, which is neither a pass nor
 * a product failure.
 *
 *   node tools/golden-identity.mjs --endpoint http://localhost:8787 \
 *     [--frames tests/golden/frames] [--out tests/golden/runs/<session>.json] [--limit N]
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function args(argv) {
  const out = { endpoint: '', frames: join(root, 'tests/golden/frames'), out: null, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--endpoint') out.endpoint = argv[++i];
    else if (flag === '--frames') out.frames = resolve(argv[++i]);
    else if (flag === '--out') out.out = resolve(argv[++i]);
    else if (flag === '--limit') out.limit = Number(argv[++i]) || 0;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!out.endpoint) throw new Error('--endpoint is required');
  return out;
}

const words = value => String(value ?? '').toLowerCase().match(/[a-z]{3,}/g) ?? [];

/** Identity is compared as vocabulary, not as a string: a case expecting
 * "digital wristwatch" passes when the resolver's own query says "watch". */
function identityMatches(expected, observed) {
  const wanted = [...new Set(words(expected))];
  if (!wanted.length) return null;
  const haystack = words(observed).join(' ');
  const hits = wanted.filter(token => haystack.includes(token)).length;
  return hits / wanted.length >= 0.5;
}

async function main() {
  const options = args(process.argv.slice(2));
  const suite = JSON.parse(readFileSync(join(root, 'tests/golden/cases.json'), 'utf8'));
  const cases = options.limit ? suite.cases.slice(0, options.limit) : suite.cases;
  const recorded_at = new Date().toISOString();
  const session_id = `golden-identity-${recorded_at.slice(0, 10)}-${recorded_at.slice(11, 19).replace(/:/g, '')}`;

  const results = [];
  for (const testCase of cases) {
    const framePath = join(options.frames, `${testCase.id}.jpg`);
    if (!existsSync(framePath)) {
      results.push({
        id: testCase.id, name: testCase.name, status: 'BLOCKED_NO_FRAME',
        expected_identity: testCase.expected_identity, expected_brand_model: testCase.expected_brand_model ?? null,
        notes: `No frozen frame at ${framePath}. Capture it from a signed-in browser and commit the image; this harness never fetches YouTube (datacenter IPs are bot-walled) and never handles session cookies.`,
      });
      continue;
    }
    const bytes = readFileSync(framePath);
    const frameSha256 = createHash('sha256').update(bytes).digest('hex');
    const started = Date.now();
    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const context = { platform: 'youtube', content_ref: /v=([\w-]+)/.exec(testCase.url_at_time)?.[1] ?? null };
    let response, body, description;
    try {
      // The real flow is vision first: /analyze-selection turns the frame into the
      // description that /resolve-products resolves. Posting the frame straight to
      // the resolver would send an empty description and measure nothing.
      const analysis = await fetch(`${options.endpoint}/analyze-selection`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }), signal: AbortSignal.timeout(120000),
      });
      description = await analysis.json().catch(() => null);
      if (!analysis.ok || !description) {
        results.push({
          id: testCase.id, name: testCase.name, status: [429, 502, 503].includes(analysis.status) ? 'PROVIDER_BLOCKED' : 'SYSTEM_FAIL',
          expected_identity: testCase.expected_identity, frame_sha256: frameSha256, latency_ms: Date.now() - started,
          http_status: analysis.status, notes: `analyze-selection failed: ${String(description?.error ?? '').slice(0, 160)}`,
        });
        continue;
      }
      response = await fetch(`${options.endpoint}/resolve-products`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description, context, source_image: dataUrl }),
        signal: AbortSignal.timeout(120000),
      });
      body = await response.json().catch(() => ({}));
    } catch (error) {
      results.push({
        id: testCase.id, name: testCase.name, status: 'PROVIDER_BLOCKED', expected_identity: testCase.expected_identity,
        frame_sha256: frameSha256, latency_ms: Date.now() - started,
        notes: `request failed: ${error instanceof Error ? error.name : 'unknown'}`,
      });
      continue;
    }
    const latency_ms = Date.now() - started;
    if (!response.ok) {
      const providerBlocked = [429, 502, 503].includes(response.status);
      results.push({
        id: testCase.id, name: testCase.name, status: providerBlocked ? 'PROVIDER_BLOCKED' : 'SYSTEM_FAIL',
        expected_identity: testCase.expected_identity, frame_sha256: frameSha256, latency_ms,
        http_status: response.status, notes: String(body?.reason ?? body?.error ?? '').slice(0, 200),
      });
      continue;
    }
    const observed = [
      body.query ?? '',
      description?.subcategory, description?.category, description?.brand_candidate, description?.model_candidate,
      ...(description?.visible_text ?? []), ...(description?.distinctive_features ?? []),
      ...(body.products ?? []).map(product => `${product.title ?? ''} ${product.metadata?.category ?? ''}`),
    ].filter(Boolean).join(' ');
    // A correct-sounding identity with nothing purchasable behind it is not a
    // pass: the case is about the user reaching a useful result.
    const identityOk = identityMatches(testCase.expected_identity, observed);
    const hasProducts = (body.products ?? []).length > 0;
    const matched = Boolean(identityOk) && hasProducts;
    const exact = (body.products ?? []).filter(product => product.result_class === 'EXACT').length;
    results.push({
      id: testCase.id, name: testCase.name, status: matched ? 'PASS' : 'PRODUCT_FAIL',
      expected_identity: testCase.expected_identity, expected_brand_model: testCase.expected_brand_model ?? null,
      observed_query: String(body.query ?? '').slice(0, 300),
      observed_identity: [description?.subcategory, description?.category, description?.brand_candidate, description?.model_candidate].filter(Boolean).join(' / '),
      products: (body.products ?? []).length,
      exact_products: exact, frame_sha256: frameSha256, latency_ms,
      identity_match: identityOk, has_products: hasProducts,
      ...(body.verified_mapping?.subrequests ? { subrequests: body.verified_mapping.subrequests } : {}),
    });
  }

  const scored = results.filter(result => result.status === 'PASS' || result.status === 'PRODUCT_FAIL');
  const pass = results.filter(result => result.status === 'PASS').length;
  const pass_rate = scored.length ? pass / scored.length : null;

  const previous = previousRun(root);
  const comparison = previous ? {
    previous_session: previous.session_id,
    previous_pass_rate: previous.pass_rate ?? null,
    pass_rate_change: pass_rate === null || previous.pass_rate == null ? null : pass_rate - previous.pass_rate,
    reason: pass_rate === null ? 'No case produced a scored identity in this run' : 'Automated identity comparison',
  } : { previous_session: null, pass_rate_change: null, reason: 'First automated Golden identity run' };

  const report = {
    schema_version: 1,
    suite: 'golden-identity-ci',
    session_id,
    run_date: recorded_at.slice(0, 10),
    run_timezone: 'UTC',
    recorded_at,
    source_parent_commit: process.env.GITHUB_SHA ?? null,
    endpoint: options.endpoint,
    scope: 'Object identity only, scored from the resolver query terms. Not a replacement for the manual three-run Golden PASS procedure, and not a localisation measurement: the frozen cases describe click points in prose.',
    cases: results,
    summary: { cases: results.length, scored: scored.length, pass, pass_rate, blocked_no_frame: results.filter(r => r.status === 'BLOCKED_NO_FRAME').length,
      provider_blocked: results.filter(r => r.status === 'PROVIDER_BLOCKED').length },
    comparison,
  };

  const out = options.out || join(root, 'tests/golden/runs', `${report.run_date}-${session_id}.json`);
  if (existsSync(out)) throw new Error(`refusing to overwrite an existing run: ${basename(out)}`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ run: out, summary: report.summary, comparison }, null, 2));

  // A regression in scored identity fails the job; a blocked run does not, because
  // it measured nothing. Missing frames are reported, never silently skipped.
  if (comparison.pass_rate_change !== null && comparison.pass_rate_change < 0) process.exitCode = 1;
}

function previousRun(rootDir) {
  const dir = join(rootDir, 'tests/golden/runs');
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir)
    .filter(name => name.endsWith('.json') && !name.includes('blocked'))
    .map(name => {
      try { return JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { return null; }
    })
    .filter(run => run && run.suite === 'golden-identity-ci')
    .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
  return runs[0] ? { session_id: runs[0].session_id, pass_rate: runs[0].summary?.pass_rate ?? null } : null;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
