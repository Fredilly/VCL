import { readFile, writeFile } from 'node:fs/promises';

const preparedPath = process.env.VCL_CLEF_PREPARED_INPUT;
const outputPath = process.env.VCL_CLEF_OUTPUT ?? 'clef-vision-report.json';
const clefOrigin = process.env.CLEF_ORIGIN;
const model = process.env.CLEF_MODEL ?? 'clef';

if (!preparedPath) throw new Error('VCL_CLEF_PREPARED_INPUT is required');
if (!clefOrigin) throw new Error('CLEF_ORIGIN is required');
if (!['clef', 'clef-flash'].includes(model)) throw new Error('CLEF_MODEL must be clef or clef-flash');

const MODEL_ID = model === 'clef' ? '@cf/cloudflare/clef' : '@cf/cloudflare/clef-flash';

const EXPECTED = {
  's5-01': { category: 'apparel', brand: 'patagonia', model: 'better_sweater' },
  's5-02': { category: 'apparel', brand: 'patagonia', model: 'better_sweater' },
  's5-03': { category: 'watch', brand: 'seiko', model: 'skx007' },
  's5-04': { category: 'watch', brand: 'seiko', model: 'skx007' },
  's5-05': { category: 'bag', brand: 'coach', model: 'unknown' },
  's5-06': { category: 'bag', brand: 'coach', model: 'unknown' },
  's5-07': { category: 'shoes', brand: 'adidas', model: 'samba_og' },
  's5-08': { category: 'shoes', brand: 'adidas', model: 'samba_og' },
};

const CATEGORY_CRITERIA = {
  apparel: 'Garment or clothing item such as jacket, sweater, shirt, trousers, dress, hoodie, or coat.',
  watch: 'Wristwatch or watch.',
  bag: 'Bag, handbag, tote, purse, backpack, or luggage.',
  shoes: 'Footwear such as sneaker, shoe, boot, sandal, or loafer.',
  fragrance: 'Perfume, cologne, fragrance bottle, or scent product.',
  electronics: 'Consumer electronic device or accessory.',
  home: 'Furniture, lamp, appliance, or home object.',
  other: 'None of the listed product categories is well supported by the pixels.',
};

const BRAND_CRITERIA = {
  patagonia: 'Visible evidence supports Patagonia branding or identity.',
  seiko: 'Visible evidence supports Seiko branding or identity.',
  coach: 'Visible evidence supports Coach branding or identity.',
  adidas: 'Visible evidence supports Adidas branding or identity.',
  unknown: 'No listed brand is visually supported strongly enough.',
};

const MODEL_CRITERIA = {
  better_sweater: 'Patagonia Better Sweater product family.',
  skx007: 'Seiko SKX007 diver watch.',
  samba_og: 'Adidas Samba OG sneaker.',
  unknown: 'No listed model/product family is visually supported strongly enough.',
};

function imageFromDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('Prepared source_image is not a supported base64 image data URL');
  return { mime_type: match[1], data: match[2] };
}

function norm(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function geminiCategory(description) {
  const text = norm([description?.category, description?.subcategory].filter(Boolean).join(' '));
  if (/watch/.test(text)) return 'watch';
  if (/bag|handbag|tote|purse|backpack|luggage/.test(text)) return 'bag';
  if (/shoe|sneaker|boot|sandal|loafer|footwear/.test(text)) return 'shoes';
  if (/jacket|sweater|shirt|hoodie|coat|dress|trouser|jean|short|cardigan|apparel|clothing|garment/.test(text)) return 'apparel';
  if (/perfume|fragrance|cologne/.test(text)) return 'fragrance';
  if (/electronic|phone|camera|headphone|laptop|device/.test(text)) return 'electronics';
  if (/furniture|lamp|appliance|home/.test(text)) return 'home';
  return 'other';
}

function geminiBrand(description) {
  const text = norm(description?.brand_candidate);
  for (const brand of ['patagonia','seiko','coach','adidas']) {
    if (text.includes(brand)) return brand;
  }
  return 'unknown';
}

function geminiModel(description) {
  const text = norm(description?.model_candidate);
  if (text.includes('better sweater')) return 'better_sweater';
  if (text.includes('skx007') || text.includes('skx 007')) return 'skx007';
  if (text.includes('samba og') || text === 'samba') return 'samba_og';
  return 'unknown';
}

function choice(answer) {
  if (!answer || typeof answer !== 'object') return null;
  if (typeof answer.choice === 'string') return answer.choice;
  if (typeof answer.value === 'string') return answer.value;
  return null;
}

function probability(answer, key) {
  const probs = answer?.probabilities ?? answer?.probability ?? answer?.probs;
  if (probs && typeof probs === 'object' && Number.isFinite(Number(probs[key]))) return Number(probs[key]);
  if (choice(answer) === key && Number.isFinite(Number(answer?.confidence))) return Number(answer.confidence);
  return null;
}

async function runClef(row) {
  const started = Date.now();
  const response = await fetch(clefOrigin, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      state: {
        task: 'Inspect only the selected product crop. Use visible pixels as evidence. Do not infer a famous brand or model from style alone. Choose unknown when identity evidence is insufficient.',
        selected_item_hint: row.selected_item ?? null,
      },
      images: [row.source_image],
      questions: {
        category: {
          type: 'choice',
          instructions: 'Which broad product category is best supported by the selected object pixels?',
          criteria: CATEGORY_CRITERIA,
        },
        brand: {
          type: 'choice',
          instructions: 'Which listed brand is visually supported by readable text, logo, markings, or distinctive identity evidence? Choose unknown when not supported.',
          criteria: BRAND_CRITERIA,
        },
        model_identity: {
          type: 'choice',
          instructions: 'Which listed product model or family is visually supported? Choose unknown unless model-level evidence is actually visible.',
          criteria: MODEL_CRITERIA,
        },
        commercially_searchable: {
          type: 'noul',
          instructions: 'Is the selected object visually clear enough to create a commercially useful product search?',
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.errors?.[0]?.message ?? payload?.error ?? `Clef HTTP ${response.status}`);
  }
  const result = payload?.result?.result ?? payload?.result ?? payload;
  return { result, latency_ms: Date.now() - started };
}

const prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
const rows = prepared.rows ?? [];
const reportRows = [];

for (const row of rows) {
  const expected = EXPECTED[row.case_id];
  if (!expected) continue;
  const gemini = {
    category: geminiCategory(row.description),
    brand: geminiBrand(row.description),
    model: geminiModel(row.description),
    latency_ms: Number(row.preprocessing_latency_ms ?? 0),
    usage: row.vision_usage ?? row.description?.provider_usage ?? null,
  };

  try {
    const { result, latency_ms } = await runClef(row);
    const answers = result?.answers ?? {};
    const clef = {
      category: choice(answers.category),
      brand: choice(answers.brand),
      model: choice(answers.model_identity),
      commercially_searchable_probability: Number(answers.commercially_searchable?.noul ?? answers.commercially_searchable?.probability ?? NaN),
      expected_category_probability: probability(answers.category, expected.category),
      expected_brand_probability: probability(answers.brand, expected.brand),
      expected_model_probability: probability(answers.model_identity, expected.model),
      latency_ms,
      usage: result?.usage ?? null,
    };
    reportRows.push({
      case_id: row.case_id,
      selected_item: row.selected_item,
      expected,
      gemini,
      clef,
      scores: {
        gemini_category_correct: gemini.category === expected.category,
        gemini_brand_correct: gemini.brand === expected.brand,
        gemini_model_correct: gemini.model === expected.model,
        clef_category_correct: clef.category === expected.category,
        clef_brand_correct: clef.brand === expected.brand,
        clef_model_correct: clef.model === expected.model,
      },
    });
  } catch (error) {
    reportRows.push({
      case_id: row.case_id,
      selected_item: row.selected_item,
      expected,
      gemini,
      clef: { error: error instanceof Error ? error.message : String(error) },
      scores: {
        gemini_category_correct: gemini.category === expected.category,
        gemini_brand_correct: gemini.brand === expected.brand,
        gemini_model_correct: gemini.model === expected.model,
        clef_category_correct: null,
        clef_brand_correct: null,
        clef_model_correct: null,
      },
    });
  }
}

const avg = (key) => {
  const vals = reportRows.map(r => r.scores[key]).filter(v => typeof v === 'boolean');
  return vals.length ? vals.filter(Boolean).length / vals.length : null;
};
const percentile = (values, p) => {
  const v = values.filter(Number.isFinite).sort((a,b)=>a-b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)] : null;
};

const summary = {
  cases: reportRows.length,
  methodology: {
    image_input: 'Same localized Scoop crop prepared once by the current Gemini/OpenRouter pipeline.',
    gemini_task: 'Current free-form Scoop ObjectDescription prompt.',
    clef_task: 'Closed-set typed vision decisions over the frozen benchmark identity set.',
    caveat: 'Clef cannot generate unseen brand/model/search terms in this test. Closed-set identity accuracy is therefore not a drop-in replacement metric.',
  },
  gemini: {
    category_accuracy: avg('gemini_category_correct'),
    brand_accuracy: avg('gemini_brand_correct'),
    model_accuracy: avg('gemini_model_correct'),
    p50_preprocessing_latency_ms: percentile(reportRows.map(r=>r.gemini?.latency_ms), .5),
    p95_preprocessing_latency_ms: percentile(reportRows.map(r=>r.gemini?.latency_ms), .95),
  },
  clef: {
    model: MODEL_ID,
    category_accuracy: avg('clef_category_correct'),
    brand_accuracy: avg('clef_brand_correct'),
    model_accuracy: avg('clef_model_correct'),
    p50_inference_latency_ms: percentile(reportRows.map(r=>r.clef?.latency_ms), .5),
    p95_inference_latency_ms: percentile(reportRows.map(r=>r.clef?.latency_ms), .95),
    failed_cases: reportRows.filter(r=>r.clef?.error).length,
  },
};

const out = {
  schema_version: 1,
  benchmark: 'clef-vision-vs-current-gemini',
  generated_at: new Date().toISOString(),
  summary,
  rows: reportRows,
};
await writeFile(outputPath, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
