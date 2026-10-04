import { readFile, writeFile } from 'node:fs/promises';

const preparedPath = process.env.VCL_RAW_AB_PREPARED_INPUT;
const origin = process.env.VCL_RAW_AB_ORIGIN;
const outputPath = process.env.VCL_RAW_AB_OUTPUT ?? 'clef-raw-verifier-ab-report.json';
const candidateLimit = Math.max(1, Math.min(12, Number(process.env.VCL_RAW_AB_CANDIDATE_LIMIT ?? 8) || 8));
const versionId = process.env.VCL_RAW_AB_VERSION_ID ?? '';

if (!preparedPath) throw new Error('VCL_RAW_AB_PREPARED_INPUT is required');
if (!origin) throw new Error('VCL_RAW_AB_ORIGIN is required');

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function supportsExpectedIdentity(product, expected) {
  if (!product || !expected) return false;
  const text = norm([product.title, product.brand, product.model].filter(Boolean).join(' '));
  const compactText = text.replace(/[^a-z0-9]/g, '');
  const brand = norm(expected.brand);
  const model = norm(expected.model);
  if (brand && !text.includes(brand)) return false;
  if (model) {
    const compactModel = model.replace(/[^a-z0-9]/g, '');
    const tokenMatch = model.split(' ').filter(Boolean).every((token) => text.includes(token));
    const compactMatch = compactModel.length >= 4 && compactText.includes(compactModel);
    if (!tokenMatch && !compactMatch) return false;
  }
  return true;
}

function trustCounts(products, expected) {
  let falseExact = 0;
  let unsupportedLikely = 0;
  for (const product of products ?? []) {
    const supported = supportsExpectedIdentity(product, expected);
    if (product?.result_class === 'EXACT' && !supported) falseExact++;
    if (product?.result_class === 'LIKELY' && !supported) unsupportedLikely++;
  }
  return { false_exact: falseExact, unsupported_likely: unsupportedLikely };
}

function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)] : null;
}

async function post(body) {
  const response = await fetch(origin, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(versionId ? { 'Cloudflare-Workers-Version-Overrides': `vcl-api="${versionId}"` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `benchmark worker HTTP ${response.status}`);
  return payload;
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
const rows = [];
const failures = [];

for (const row of prepared.rows ?? []) {
  const expected = row.expected_identity ?? null;
  try {
    const payload = await post({
      description: row.description,
      context: row.context,
      source_image: row.source_image,
      candidate_limit: candidateLimit,
    });

    const currentProducts = payload.current?.products ?? [];
    const clefProducts = payload.clef?.products ?? [];
    const currentTrust = trustCounts(currentProducts, expected);
    const clefTrust = trustCounts(clefProducts, expected);

    rows.push({
      case_id: row.case_id,
      selected_item: row.selected_item,
      expected_identity: expected,
      raw_candidate_count: payload.raw_candidate_count ?? 0,
      viable_candidate_count: payload.viable_candidate_count ?? 0,
      raw_candidates: payload.raw_candidates ?? [],
      metadata_rejected: payload.metadata_rejected ?? [],
      retrieval: payload.retrieval ?? null,
      current: {
        products: currentProducts,
        top1_expected_identity: supportsExpectedIdentity(currentProducts[0], expected),
        expected_identity_present: currentProducts.some((p) => supportsExpectedIdentity(p, expected)),
        false_exact: currentTrust.false_exact,
        unsupported_likely: currentTrust.unsupported_likely,
        compared: payload.current?.compared ?? 0,
        failures: payload.current?.failures ?? 0,
        failure_reasons: payload.current?.failure_reasons ?? {},
        usage: payload.current?.usage ?? null,
        timing: payload.current?.timing ?? null,
      },
      clef: {
        products: clefProducts,
        top1_expected_identity: supportsExpectedIdentity(clefProducts[0], expected),
        expected_identity_present: clefProducts.some((p) => supportsExpectedIdentity(p, expected)),
        false_exact: clefTrust.false_exact,
        unsupported_likely: clefTrust.unsupported_likely,
        compared: payload.clef?.compared ?? 0,
        failures: payload.clef?.failures ?? 0,
        failure_reasons: payload.clef?.failure_reasons ?? {},
        usage: payload.clef?.usage ?? null,
        timing: payload.clef?.timing ?? null,
      },
    });
  } catch (error) {
    failures.push({
      case_id: row.case_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await writeFile(outputPath, JSON.stringify({ rows, failures }, null, 2) + '\n');
}

const count = (fn) => rows.filter(fn).length;
const sum = (fn) => rows.reduce((n, row) => n + Number(fn(row) ?? 0), 0);
const metrics = (name) => ({
  returned_product_rate: rows.length ? count((row) => (row[name]?.products?.length ?? 0) > 0) / rows.length : null,
  top1_expected_identity_rate: rows.length ? count((row) => row[name]?.top1_expected_identity) / rows.length : null,
  expected_identity_present_rate: rows.length ? count((row) => row[name]?.expected_identity_present) / rows.length : null,
  false_exact: sum((row) => row[name]?.false_exact),
  unsupported_likely: sum((row) => row[name]?.unsupported_likely),
  compared: sum((row) => row[name]?.compared),
  failures: sum((row) => row[name]?.failures),
  p50_verifier_wall_ms: percentile(rows.map((row) => row[name]?.timing?.wall_ms), 0.5),
  p95_verifier_wall_ms: percentile(rows.map((row) => row[name]?.timing?.wall_ms), 0.95),
  p50_model_ms: percentile(rows.map((row) => row[name]?.timing?.model_ms), 0.5),
  p95_model_ms: percentile(rows.map((row) => row[name]?.timing?.model_ms), 0.95),
  verification_requests: sum((row) => row[name]?.usage?.requests),
  verification_cost_usd: name === 'current' ? sum((row) => row[name]?.usage?.cost_usd) : null,
});

const current = metrics('current');
const clef = metrics('clef');

const summary = {
  attempted_cases: (prepared.rows ?? []).length,
  successful_cases: rows.length,
  failed_cases: failures.length,
  average_raw_candidates: rows.length ? sum((row) => row.raw_candidate_count) / rows.length : null,
  current,
  clef,
  validity_gate: rows.length === (prepared.rows ?? []).length
    && current.compared > 0
    && clef.compared > 0
    && clef.failures < clef.compared + clef.failures,
  trust_gate: clef.false_exact === 0 && clef.unsupported_likely === 0,
  quality_gate: (clef.top1_expected_identity_rate ?? 0) >= (current.top1_expected_identity_rate ?? 0)
    && (clef.expected_identity_present_rate ?? 0) >= (current.expected_identity_present_rate ?? 0),
  note: 'Both verifiers receive the exact same raw commerce candidate array retrieved once per case before image verification. Clef Workers AI cost is not measured by this report.',
};

const report = {
  schema_version: 1,
  benchmark: 'raw-commerce-candidates-current-verifier-vs-clef',
  generated_at: new Date().toISOString(),
  candidate_limit: candidateLimit,
  summary,
  rows,
  failures,
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

if (!summary.validity_gate) process.exitCode = 1;
if (!summary.trust_gate) process.exitCode = 1;
if (!summary.quality_gate) process.exitCode = 1;
