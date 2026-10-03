import { readFile, writeFile } from 'node:fs/promises';

const preparedPath = process.env.VCL_CLEF_VERIFY_PREPARED_INPUT;
const outputPath = process.env.VCL_CLEF_VERIFY_OUTPUT ?? 'clef-verification-report.json';
const apiOrigin = process.env.VCL_API_ORIGIN ?? 'https://api.vcl.article6.org';
const clefOrigin = process.env.CLEF_VERIFY_ORIGIN;
const candidateLimit = Math.max(1, Math.min(5, Number(process.env.CLEF_VERIFY_CANDIDATE_LIMIT ?? 5)));

if (!preparedPath) throw new Error('VCL_CLEF_VERIFY_PREPARED_INPUT is required');
if (!clefOrigin) throw new Error('CLEF_VERIFY_ORIGIN is required');

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

function relationshipAnswer(payload) {
  const root = payload?.result?.result ?? payload?.result ?? payload;
  const answer = root?.answers?.relationship;
  if (typeof answer === 'string') return answer;
  if (typeof answer?.choice === 'string') return answer.choice;
  if (typeof answer?.value === 'string') return answer.value;
  return null;
}

async function postJson(origin, path, body, timeoutMs = 120000) {
  const response = await fetch(`${origin}/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-scoop-install-id': '00000000-0000-4000-8000-000000000001',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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

function assistedClass(original, relationship) {
  if (original === 'EXACT') return relationship === 'same_product' ? 'EXACT' : 'SIMILAR';
  if (original === 'LIKELY') return relationship === 'same_product' || relationship === 'same_family' ? 'LIKELY' : 'SIMILAR';
  return original ?? 'SIMILAR';
}

function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)] : null;
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
const rows = prepared.rows ?? [];
const reportRows = [];
const clefLatencies = [];
let clefCalls = 0;
let clefFailures = 0;

for (const row of rows) {
  const baselineStarted = Date.now();
  let commerce;
  try {
    commerce = await postJson(apiOrigin, 'resolve-products', {
      description: row.description,
      context: row.context,
      source_image: row.source_image,
    });
  } catch (error) {
    reportRows.push({
      case_id: row.case_id,
      expected_identity: row.expected_identity ?? null,
      error: `baseline commerce failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    continue;
  }
  const baselineLatency = Date.now() - baselineStarted;
  const baselineProducts = Array.isArray(commerce?.products) ? commerce.products : [];
  const assistedProducts = baselineProducts.map((product) => ({ ...product }));
  const decisions = [];

  for (let i = 0; i < Math.min(candidateLimit, baselineProducts.length); i++) {
    const product = baselineProducts[i];
    if (!product?.image_reference) continue;
    const started = Date.now();
    clefCalls++;
    try {
      const payload = await postJson(clefOrigin, '', {
        source_image: row.source_image,
        candidate_image_url: product.image_reference,
        source_description: row.description,
        candidate: {
          title: product.title ?? null,
          brand: product.brand ?? null,
          model: product.model ?? null,
          metadata: product.metadata ?? null,
          result_class: product.result_class ?? null,
        },
      }, 30000);
      const latency = Date.now() - started;
      clefLatencies.push(latency);
      const relationship = relationshipAnswer(payload);
      if (!relationship) throw new Error('Clef returned no relationship choice');
      assistedProducts[i].result_class = assistedClass(product.result_class, relationship);
      assistedProducts[i].relationship = assistedProducts[i].result_class;
      decisions.push({
        index: i,
        title: product.title ?? null,
        original_class: product.result_class ?? null,
        clef_relationship: relationship,
        assisted_class: assistedProducts[i].result_class,
        latency_ms: latency,
      });
    } catch (error) {
      clefFailures++;
      decisions.push({
        index: i,
        title: product.title ?? null,
        original_class: product.result_class ?? null,
        clef_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baselineTrust = trustCounts(baselineProducts, row.expected_identity);
  const assistedTrust = trustCounts(assistedProducts, row.expected_identity);
  const expected = row.expected_identity ?? null;
  const baselineTop1 = baselineProducts.length ? supportsExpectedIdentity(baselineProducts[0], expected) : false;
  const assistedTop1 = assistedProducts.length ? supportsExpectedIdentity(assistedProducts[0], expected) : false;
  const baselineHighConfidenceSupported = baselineProducts.some((p) => ['EXACT', 'LIKELY'].includes(p?.result_class) && supportsExpectedIdentity(p, expected) === true);
  const assistedHighConfidenceSupported = assistedProducts.some((p) => ['EXACT', 'LIKELY'].includes(p?.result_class) && supportsExpectedIdentity(p, expected) === true);

  reportRows.push({
    case_id: row.case_id,
    selected_item: row.selected_item,
    expected_identity: expected,
    baseline: {
      latency_ms: baselineLatency,
      state: commerce?.state ?? null,
      false_exact: baselineTrust.false_exact,
      unsupported_likely: baselineTrust.unsupported_likely,
      top1_expected_identity: baselineTop1,
      high_confidence_expected_identity: baselineHighConfidenceSupported,
      verification_usage: commerce?.cost_usage?.verification_usage ?? null,
      timing: commerce?.timing ?? null,
      products: baselineProducts.slice(0, candidateLimit).map((p) => ({
        title: p.title ?? null,
        brand: p.brand ?? null,
        model: p.model ?? null,
        result_class: p.result_class ?? null,
        image_reference: p.image_reference ?? null,
      })),
    },
    clef_assisted: {
      false_exact: assistedTrust.false_exact,
      unsupported_likely: assistedTrust.unsupported_likely,
      top1_expected_identity: assistedTop1,
      high_confidence_expected_identity: assistedHighConfidenceSupported,
      products: assistedProducts.slice(0, candidateLimit).map((p) => ({
        title: p.title ?? null,
        brand: p.brand ?? null,
        model: p.model ?? null,
        result_class: p.result_class ?? null,
      })),
      decisions,
    },
  });
}

const valid = reportRows.filter((r) => !r.error);
const sum = (fn) => valid.reduce((n, r) => n + Number(fn(r) ?? 0), 0);
const count = (fn) => valid.filter(fn).length;
const baselineVerificationRequests = sum((r) => r.baseline?.verification_usage?.requests);
const baselineVerificationCost = sum((r) => r.baseline?.verification_usage?.cost_usd);

const report = {
  schema_version: 1,
  benchmark: 'current-verification-vs-clef-assisted-veto',
  generated_at: new Date().toISOString(),
  methodology: {
    baseline: 'Current production Scoop resolve-products including current verification.',
    clef_assisted: 'Same returned candidates, with Clef allowed only to preserve or downgrade existing EXACT/LIKELY labels. Clef never promotes a candidate.',
    purpose: 'Measure whether Clef can safely judge the top retrieved commerce candidates before testing replacement of the current verifier.',
    limitation: 'This run adds Clef after current retrieval/verification and evaluates top candidates regardless of their current label. It measures candidate-judgment safety and speed, not replacement savings yet.',
  },
  summary: {
    attempted_cases: rows.length,
    successful_cases: valid.length,
    baseline: {
      false_exact: sum((r) => r.baseline.false_exact),
      unsupported_likely: sum((r) => r.baseline.unsupported_likely),
      top1_expected_identity_rate: valid.length ? count((r) => r.baseline.top1_expected_identity) / valid.length : null,
      high_confidence_expected_identity_rate: valid.length ? count((r) => r.baseline.high_confidence_expected_identity) / valid.length : null,
      verification_requests: baselineVerificationRequests,
      verification_cost_usd: baselineVerificationCost || null,
      p50_latency_ms: percentile(valid.map((r) => r.baseline.latency_ms), 0.5),
      p95_latency_ms: percentile(valid.map((r) => r.baseline.latency_ms), 0.95),
    },
    clef_assisted: {
      false_exact: sum((r) => r.clef_assisted.false_exact),
      unsupported_likely: sum((r) => r.clef_assisted.unsupported_likely),
      top1_expected_identity_rate: valid.length ? count((r) => r.clef_assisted.top1_expected_identity) / valid.length : null,
      high_confidence_expected_identity_rate: valid.length ? count((r) => r.clef_assisted.high_confidence_expected_identity) / valid.length : null,
      clef_calls: clefCalls,
      clef_failures: clefFailures,
      p50_clef_decision_ms: percentile(clefLatencies, 0.5),
      p95_clef_decision_ms: percentile(clefLatencies, 0.95),
    },
  },
  rows: reportRows,
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));

if (!valid.length) process.exitCode = 1;
if (clefCalls > 0 && clefFailures === clefCalls) process.exitCode = 1;
