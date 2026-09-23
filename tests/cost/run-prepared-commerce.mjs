import { readFile, writeFile } from 'node:fs/promises';

const apiOrigin = process.env.VCL_API_ORIGIN;
const preparedPath = process.env.VCL_PREPARED_INPUT;
const outputPath = process.env.VCL_COST_OUTPUT ?? 'tests/cost/run.json';

if (!apiOrigin) throw new Error('VCL_API_ORIGIN is required');
if (!preparedPath) throw new Error('VCL_PREPARED_INPUT is required');

function normalizedIdentity(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function supportsExpectedIdentity(product, expected) {
  if (!expected) return null;
  const text = normalizedIdentity([product?.title, product?.brand, product?.model].filter(Boolean).join(' '));
  const brand = normalizedIdentity(expected.brand);
  const model = normalizedIdentity(expected.model);
  if (brand && !text.includes(brand)) return false;
  if (model) {
    const tokens = model.split(' ').filter(Boolean);
    if (!tokens.every((token) => text.includes(token))) return false;
  }
  return true;
}

function trustCounts(products, expected) {
  let falseExact = 0;
  let unsupportedLikely = 0;
  for (const product of products ?? []) {
    const supported = supportsExpectedIdentity(product, expected);
    if (product?.result_class === 'EXACT' && supported !== true) falseExact++;
    if (product?.result_class === 'LIKELY' && supported !== true) unsupportedLikely++;
  }
  return { false_exact: falseExact, unsupported_likely: unsupportedLikely };
}

async function postJson(path, body) {
  const response = await fetch(`${apiOrigin}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-scoop-install-id': '00000000-0000-4000-8000-000000000001',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error ?? `${path} failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
const rows = prepared.rows ?? [];
const expectedRows = Number(process.env.VCL_PREPARED_CASE_COUNT ?? rows.length);
if (!Number.isInteger(expectedRows) || expectedRows < 1) throw new Error(`Invalid VCL_PREPARED_CASE_COUNT: ${process.env.VCL_PREPARED_CASE_COUNT}`);
if (rows.length !== expectedRows) throw new Error(`Expected ${expectedRows} prepared rows, got ${rows.length}`);

const runs = [];
const failures = [];

for (const row of rows) {
  const started = Date.now();
  try {
    const commerce = await postJson('resolve-products', {
      description: row.description,
      context: row.context,
      source_image: row.source_image,
      ...(process.env.VCL_VISIBLE_TEXT_QUERY_V2 === '1' ? { benchmark_visible_text_query_v2: true } : {}),
    });

    const commerceLatency = Date.now() - started;
    const degraded = commerce?.state === 'TEMPORARILY_UNAVAILABLE';
    const trust = trustCounts(commerce?.products ?? [], row.expected_identity);

    const run = {
      case_id: row.case_id,
      selected_item: row.selected_item,
      failed: degraded,
      failure_class: degraded ? 'PROVIDER_BLOCKED' : undefined,
      localization_usage: row.localization_usage ?? null,
      localization_failure: row.localization_failure ?? null,
      vision_usage: row.vision_usage ?? null,
      analysis: {
        category: row.description?.category ?? null,
        subcategory: row.description?.subcategory ?? null,
        brand: row.description?.brand_candidate ?? null,
        model: row.description?.model_candidate ?? null,
        color: row.description?.color ?? null,
      },
      commerce_query: commerce?.query ?? null,
      verification_usage: commerce?.cost_usage?.verification_usage ?? null,
      verification: commerce?.verification ?? null,
      result_classes: (commerce?.products ?? []).map((product) => product.result_class).filter(Boolean),
      false_exact: trust.false_exact,
      unsupported_likely: trust.unsupported_likely,
      product_identities: (commerce?.products ?? []).map((product) => ({
        title: product.title ?? null,
        brand: product.brand ?? null,
        model: product.model ?? null,
        result_class: product.result_class ?? null,
      })),
      jev_router: commerce?.jev_router ?? null,
      timing: commerce?.timing ?? null,
      commerce_calls: commerce?.cost_usage?.commerce_calls ?? {},
      latency_ms: Number(row.preprocessing_latency_ms ?? 0) + commerceLatency,
      shared_preprocessing_latency_ms: Number(row.preprocessing_latency_ms ?? 0),
      commerce_latency_ms: commerceLatency,
      provider_blocked: degraded,
      providers_used: commerce?.providers_used ?? [],
      serpapi: commerce?.serpapi ?? null,
      brave: commerce?.brave ?? null,
      notes: `state=${commerce?.state ?? 'unknown'}; products=${commerce?.products?.length ?? 0}; shared_vision=true`,
    };

    if (degraded) failures.push(run);
    else runs.push(run);
  } catch (error) {
    failures.push({
      case_id: row.case_id,
      selected_item: row.selected_item,
      failed: true,
      failure_class: error.status === 429 || error.status === 503 ? 'PROVIDER_BLOCKED' : 'RUNNER_OR_API_FAILURE',
      result_classes: [],
      false_exact: null,
      unsupported_likely: null,
      product_identities: [],
      jev_router: null,
      timing: null,
      commerce_calls: {},
      latency_ms: Number(row.preprocessing_latency_ms ?? 0) + (Date.now() - started),
      shared_preprocessing_latency_ms: Number(row.preprocessing_latency_ms ?? 0),
      commerce_latency_ms: Date.now() - started,
      provider_blocked: error.status === 429 || error.status === 503,
      notes: `prepared commerce failure: ${error.message}`,
    });
  }

  await writeFile(outputPath, JSON.stringify({
    schema_version: 1,
    spike: '7',
    runner_mode: 'prepared-shared-vision-commerce',
    runs,
    failed_runs: failures,
    summary: { sample_size: runs.length, attempted: runs.length + failures.length, failed: failures.length },
  }, null, 2) + '\n');
}

console.log(`Wrote ${runs.length}/${rows.length} successful prepared commerce runs to ${outputPath}`);
if (runs.length !== rows.length) process.exitCode = 1;
