import { readFile, writeFile } from 'node:fs/promises';

const preparedPath = process.env.VCL_CLEF_PREPARED_INPUT;
const baselinePath = process.env.VCL_CLEF_BASELINE_INPUT;
const clefOrigin = process.env.CLEF_VERIFY_ORIGIN;
const outputPath = process.env.VCL_CLEF_REPLACEMENT_OUTPUT ?? 'clef-frozen-replacement-report.json';
const candidateLimit = Math.max(1, Math.min(8, Number(process.env.CLEF_VERIFY_CANDIDATE_LIMIT ?? 5)));

if (!preparedPath) throw new Error('VCL_CLEF_PREPARED_INPUT is required');
if (!baselinePath) throw new Error('VCL_CLEF_BASELINE_INPUT is required');
if (!clefOrigin) throw new Error('CLEF_VERIFY_ORIGIN is required');

const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function supportsExpectedIdentity(product, expected) {
  if (!product || !expected) return false;
  const text = norm([product.title, product.brand, product.model].filter(Boolean).join(' '));
  const brand = norm(expected.brand);
  const model = norm(expected.model);
  if (brand && !text.includes(brand)) return false;
  if (model && !model.split(' ').filter(Boolean).every((token) => text.includes(token))) return false;
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

async function verifyCandidate(sourceRow, candidate) {
  const started = Date.now();
  const response = await fetch(clefOrigin, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_image: sourceRow.source_image,
      candidate_image_url: candidate.image_reference,
      source_description: sourceRow.description,
      candidate: {
        id: candidate.id ?? candidate.title ?? 'candidate',
        title: candidate.title ?? '',
        brand: candidate.brand ?? null,
        model: candidate.model ?? null,
        category: candidate.category ?? null,
        image_reference: candidate.image_reference ?? null,
        provenance: candidate.provenance ?? 'frozen-production',
        destination: candidate.destination ?? null,
        price: candidate.price ?? null,
        currency: candidate.currency ?? null,
        result_class: candidate.result_class ?? 'SIMILAR',
        metadata: candidate.metadata ?? undefined,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Clef verifier HTTP ${response.status}`);
  return { payload, wall_ms: Date.now() - started };
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const preparedById = new Map((prepared.rows ?? []).map((row) => [row.case_id, row]));
const baselineRuns = baseline.runs ?? [];

const rows = [];
let totalCalls = 0;
let totalFailures = 0;
const caseWallTimes = [];
const modelTimes = [];

for (const run of baselineRuns) {
  const sourceRow = preparedById.get(run.case_id);
  if (!sourceRow) continue;
  const candidates = (run.product_identities ?? [])
    .filter((candidate) => candidate?.image_reference)
    .slice(0, candidateLimit);
  const caseStarted = Date.now();

  const outcomes = await Promise.all(candidates.map(async (candidate) => {
    totalCalls++;
    try {
      const verified = await verifyCandidate(sourceRow, candidate);
      if (Number.isFinite(verified.payload?.timing?.model_ms)) modelTimes.push(verified.payload.timing.model_ms);
      return { candidate, ...verified };
    } catch (error) {
      totalFailures++;
      return { candidate, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const caseWallMs = Date.now() - caseStarted;
  caseWallTimes.push(caseWallMs);

  const clefProducts = outcomes
    .map((outcome) => outcome.payload?.decision?.product ?? null)
    .filter(Boolean)
    .sort((a, b) => Number(b.verification_score ?? 0) - Number(a.verification_score ?? 0));

  const expected = sourceRow.expected_identity ?? null;
  const baselineProducts = run.product_identities ?? [];
  const baselineTrust = trustCounts(baselineProducts, expected);
  const clefTrust = trustCounts(clefProducts, expected);

  rows.push({
    case_id: run.case_id,
    expected_identity: expected,
    baseline: {
      products: baselineProducts,
      top1_expected_identity: supportsExpectedIdentity(baselineProducts[0], expected),
      useful: baselineProducts.length > 0,
      false_exact: baselineTrust.false_exact,
      unsupported_likely: baselineTrust.unsupported_likely,
      latency_ms: run.latency_ms ?? null,
      commerce_latency_ms: run.commerce_latency_ms ?? null,
      current_model_verification_ms: run.timing?.candidate_model_verification_ms ?? null,
      verification_usage: run.verification_usage ?? null,
    },
    clef_replacement: {
      products: clefProducts,
      top1_expected_identity: supportsExpectedIdentity(clefProducts[0], expected),
      useful: clefProducts.length > 0,
      false_exact: clefTrust.false_exact,
      unsupported_likely: clefTrust.unsupported_likely,
      verifier_wall_ms: caseWallMs,
      calls: outcomes.length,
      failures: outcomes.filter((x) => x.error).length,
      decisions: outcomes.map((x) => ({
        title: x.candidate.title ?? null,
        original_class: x.candidate.result_class ?? null,
        clef_relationship: x.payload?.relationship ?? null,
        clef_grounded_identity: x.payload?.adapter?.clef_grounded_identity ?? false,
        clef_class: x.payload?.decision?.product?.result_class ?? null,
        clef_score: x.payload?.decision?.product?.verification_score ?? null,
        model_ms: x.payload?.timing?.model_ms ?? null,
        wall_ms: x.wall_ms ?? null,
        error: x.error ?? null,
      })),
    },
  });
}

const count = (fn) => rows.filter(fn).length;
const sum = (fn) => rows.reduce((n, row) => n + Number(fn(row) ?? 0), 0);
const baselineVerificationRequests = sum((r) => r.baseline.verification_usage?.requests);
const baselineVerificationCost = sum((r) => r.baseline.verification_usage?.cost_usd);
const baselineModelMs = rows.map((r) => r.baseline.current_model_verification_ms);
const estimatedReplacementLatency = rows.map((r) => {
  if (!Number.isFinite(r.baseline.latency_ms) || !Number.isFinite(r.baseline.current_model_verification_ms)) return null;
  return Math.max(0, r.baseline.latency_ms - r.baseline.current_model_verification_ms) + r.clef_replacement.verifier_wall_ms;
});

const summary = {
  cases: rows.length,
  methodology: {
    source: 'Production Scoop retrieves and verifies once. Returned candidate snapshots are frozen, including image URLs.',
    replacement: 'An isolated Workers AI Clef verifier re-checks those frozen candidates and sends Clef evidence through Scoop verifyCandidate trust logic.',
    limitation: 'Production does not expose candidates rejected before response, so this tests verifier replacement on the exact returned candidate set only. It cannot measure recovery of candidates the current verifier rejected.',
  },
  baseline: {
    useful_rate: rows.length ? count((r) => r.baseline.useful) / rows.length : null,
    top1_expected_identity_rate: rows.length ? count((r) => r.baseline.top1_expected_identity) / rows.length : null,
    false_exact: sum((r) => r.baseline.false_exact),
    unsupported_likely: sum((r) => r.baseline.unsupported_likely),
    verification_requests: baselineVerificationRequests,
    verification_cost_usd: baselineVerificationCost || null,
    p50_total_latency_ms: percentile(rows.map((r) => r.baseline.latency_ms), 0.5),
    p95_total_latency_ms: percentile(rows.map((r) => r.baseline.latency_ms), 0.95),
    p50_model_verification_ms: percentile(baselineModelMs, 0.5),
    p95_model_verification_ms: percentile(baselineModelMs, 0.95),
  },
  clef_replacement: {
    useful_rate: rows.length ? count((r) => r.clef_replacement.useful) / rows.length : null,
    top1_expected_identity_rate: rows.length ? count((r) => r.clef_replacement.top1_expected_identity) / rows.length : null,
    false_exact: sum((r) => r.clef_replacement.false_exact),
    unsupported_likely: sum((r) => r.clef_replacement.unsupported_likely),
    clef_calls: totalCalls,
    clef_failures: totalFailures,
    p50_verifier_wall_ms: percentile(caseWallTimes, 0.5),
    p95_verifier_wall_ms: percentile(caseWallTimes, 0.95),
    p50_model_ms: percentile(modelTimes, 0.5),
    p95_model_ms: percentile(modelTimes, 0.95),
    p50_estimated_total_latency_ms: percentile(estimatedReplacementLatency, 0.5),
    p95_estimated_total_latency_ms: percentile(estimatedReplacementLatency, 0.95),
  },
};

const report = {
  schema_version: 1,
  benchmark: 'frozen-production-candidates-current-verifier-vs-clef',
  generated_at: new Date().toISOString(),
  summary,
  rows,
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

if (!rows.length) process.exitCode = 1;
if (totalCalls === 0) process.exitCode = 1;
if (totalFailures === totalCalls) process.exitCode = 1;
if (summary.clef_replacement.false_exact !== 0 || summary.clef_replacement.unsupported_likely !== 0) process.exitCode = 1;
