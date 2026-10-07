// Static evidence fixtures. Product identities are explicit labels; observations and provider
// responses are authored controls, NOT captured pixels, live listings, or model predictions.
// Reuse the Spike 4d evidence shapes and Spike 4e merge contract without changing production.
const products = {
  apparel: { brand: 'Adidas', model: 'GD5376', type: 'hoodie', color: 'blue',
    identity: 'Adidas Essentials 3-Stripes Pullover Hoodie GD5376, blue',
    reference: 'https://www.adidas.com.au/essentials-3-stripes-pullover-hoodie/GD5376.html',
    reused: 'apps/api/tests/fixtures/live-apparel.mjs#adidas-hoodie',
    details: ['three parallel shoulder stripes', 'kangaroo pocket opening'] },
  shoes: { brand: 'Adidas', model: 'B75806', type: 'sneakers', color: 'white',
    identity: 'Adidas Samba OG B75806, white upper',
    reference: 'https://www.adidas.com/us/samba-og-shoes/B75806.html',
    reused: 'apps/api/tests/fixtures/ebay-search.json (provider-response shape only)',
    details: ['suede toe overlay geometry', 'serrated lateral stripes'] },
  watches: { brand: 'Casio', model: 'F-91W-1', type: 'watch', color: 'black',
    identity: 'Casio F-91W-1, black resin digital watch',
    reference: 'https://www.casio.com/us/watches/casio/product.F-91W-1/',
    reused: 'tests/manual/spike-4e-youtube-evidence.json (family evidence only; black full-watch static view is authored)',
    details: ['rectangular digital display geometry', 'three side push buttons'] },
  bags_accessories: { brand: 'Fjallraven', model: '23510', type: 'bag', color: 'black',
    identity: 'Fjallraven Kanken 23510, black',
    reference: 'https://www.fjallraven.com/us/en-us/bags-gear/kanken/kanken-bags/kanken/',
    reused: 'tests/manual/multi-frame.html#bag (nearby-clue scenario only)',
    details: ['paired webbing carry handles', 'square front zipper pocket'] },
  other: { brand: 'Anglepoise', model: 'Type 75', type: 'lamp', color: 'black',
    identity: 'Anglepoise Type 75 desk lamp, jet black',
    reference: 'https://www.anglepoise.com/usa/product/type-75-desk-lamp-jet-black/',
    reused: 'apps/api/tests/fixtures/apparel-benchmark.mjs (evidence shape only)',
    details: ['external spring arm assembly', 'round weighted base geometry'] },
};
const retired = {
  apparel: { brand: 'Patagonia', model: '25528 PGBE', type: 'jacket', color: 'blue', identity: 'Patagonia Better Sweater Jacket 25528 PGBE',
    reference: 'https://wornwear.patagonia.com/products/mens-better-sweater-jacket_25528_pgbe', details: ['stand collar zipper construction', 'contrasting chest pocket zipper'] },
  shoes: { brand: 'Nike', model: 'Air Max 90', type: 'sneakers', color: 'white', identity: 'Nike Air Max 90, white (fixture model/color granularity)',
    reference: 'apps/api/tests/fixtures/ebay-search.json', details: ['visible heel air window', 'ribbed heel panel geometry'] },
  watches: { brand: 'Seiko', model: 'SKX007', type: 'watch', color: 'black', identity: 'Seiko SKX007, black dial (fixture model granularity)',
    reference: 'fixture label: SKX007; no serial/authenticity claim', details: ['offset four oclock crown', 'day date window position'] },
  bags_accessories: { brand: 'Coach', model: '9966', type: 'bag', color: 'brown', identity: 'Coach Legacy Zip 9966, brown (fixture model granularity)',
    reference: 'fixture creed/style label: 9966; no authenticity claim', details: ['curved zip top profile', 'single adjustable leather strap'] },
  other: { brand: 'Apple', model: 'MC297', type: 'music player', color: 'black', identity: 'Apple iPod classic MC297, black 160 GB (fixture label)',
    reference: 'fixture model label: MC297; no serial/region claim', details: ['circular physical click wheel', 'small upper rectangular display'] },
};
const attribute = value => ({ value, confidence: .96, basis: 'image' });
const description = p => ({ category: p.type === 'hoodie' || p.type === 'jacket' ? 'apparel' : p.type === 'sneakers' ? 'shoes' : p.type,
  subcategory: p.type, brand_candidate: p.brand, model_candidate: p.model, color: p.color, material: '',
  style_attributes: [], visible_text: [p.brand, p.model], logos_markings: [p.brand], distinctive_features: p.details,
  hardware_details: [], shape_silhouette: [], search_terms: [], confidence: .96, identity_confidence: .96 });
const evidence = p => Object.fromEntries(Object.entries({ subtype: p.type, color: p.color, brand: p.brand, model: p.model }).map(([k, v]) => [k, attribute(v)]));
const candidate = (id, p, provider = 'ebay') => ({ id, provider, title: `${p.brand} ${p.model} ${p.color} ${p.type}`,
  brand: null, model: null, category: null, image_reference: 'https://images.example.test/product.jpg',
  provenance: provider === 'ebay' ? 'ebay:browse' : provider === 'etsy' ? 'etsy:listings' : `${provider}:web`,
  destination: `https://${provider}.example.test/${id}`, price: '100', currency: 'USD', result_class: 'SIMILAR',
  metadata: { brand: p.brand, model: p.model, color: p.color } });
const comparison = (source, target = source, similarity = .96) => ({ source: evidence(source), candidate: evidence(target),
  similarity, confidence: .96, matching_details: source.details });
const key = p => `${p.provenance}:${p.id}`;

export function createCorpus() {
  const selections = [];
  for (const [category, p] of Object.entries(products)) {
    for (const scenario of ['known-exact', 'difficult-lookalike', 'low-evidence', 'multi-frame', 'unavailable-vintage', 'no-result']) {
      const id = `${category}-${scenario}`;
      const known = !['low-evidence', 'no-result'].includes(scenario);
      const original = scenario === 'unavailable-vintage' ? retired[category] : p;
      const base = description(original);
      const fixture = { id, category, difficulty: scenario, clear_branding: !['low-evidence', 'no-result', 'multi-frame'].includes(scenario),
        source: { kind: 'authored_static_evidence', reference: original.reference, reused: p.reused },
        ground_truth: { status: known ? 'known' : 'unknown', identity: known ? original.identity : null,
          evidence: known ? `Explicit fixture product label. ${original.reference}. Same-model authenticity/serial is outside scope.` : 'No readable identity; category/color only.',
          granularity: 'named model and stated color; not individual unit/authenticity', origin: 'fixture_definition' },
        expected_classification: scenario === 'no-result' ? 'NO_RESULT' : ['known-exact', 'multi-frame'].includes(scenario) ? 'LIKELY' : 'SIMILAR',
        notes: '', input: { description: base, context: { title: 'Selected object' }, observations: [], providers: [] }, labels: {} };
      const add = (product, imageComparison, correct, useful, notes) => {
        let provider = fixture.input.providers.find(x => x.name === product.provider);
        if (!provider) fixture.input.providers.push(provider = { name: product.provider, tier: ['brave', 'serpapi'].includes(product.provider) ? 'fallback' : 'primary', candidates: [] });
        provider.candidates.push({ product, comparison: imageComparison });
        fixture.labels[key(product)] = { correct, useful, notes };
      };
      if (scenario === 'known-exact') {
        fixture.notes = 'Known original is retrieved behind a keyword-identical wrong-color result. Strong visual/model agreement supports LIKELY; a fixture oracle is not production SKU proof.';
        const misleading = candidate(`${id}-rank-1`, p);
        add(misleading, comparison(p, { ...p, color: 'red' }), false, false, 'Wrong dominant color despite matching title and first provider rank.');
        add(candidate(`${id}-original`, p), comparison(p), true, true, 'Explicit original product label; matching model/color and distinctive construction.');
      } else if (scenario === 'difficult-lookalike') {
        fixture.notes = 'Different product variant shares model-family words and recognizable geometry. The hidden variant difference is adjudication truth, not a guaranteed visible contradiction.';
        const sibling = candidate(`${id}-sibling`, p, 'etsy');
        // No fake catalog claim: simulated provider lists family only, as real retrieval often does.
        add(sibling, comparison(p, p, .88), false, true, 'Fixture labels this as a different revision/variant; shared family and shape make a useful alternative but do not establish the original.');
      } else if (scenario === 'low-evidence') {
        fixture.notes = 'No readable brand or model, and candidate-image comparison unavailable. A same-type/color alternative remains useful; source identity is unknown. Primary provider failure is injected.';
        Object.assign(base, { brand_candidate: null, model_candidate: null, visible_text: [], logos_markings: [], distinctive_features: [] });
        fixture.input.providers.push({ name: 'ebay', tier: 'primary', failure: 'Injected provider outage', candidates: [] });
        const generic = candidate(`${id}-alternative`, p, 'brave');
        add(generic, null, null, true, 'Category and color agree; no original-product correctness can be established.');
      } else if (scenario === 'multi-frame') {
        fixture.notes = 'Primary identity hidden; next-frame readable label contributes. Previous frame is another object and must not donate identity. Multi-frame processing does not prove an exact SKU.';
        Object.assign(base, { brand_candidate: null, model_candidate: null, visible_text: [], logos_markings: [], identity_confidence: .3 });
        fixture.nearby_timestamps = [9.5, 10.5];
        fixture.input.observations = [
          { frame: { id: 'previous', timestamp: 9.5, offset: -.5 }, observation: { description: description({ ...p, brand: 'Other maker' }), same_object_confidence: .4, identity_support: false } },
          { frame: { id: 'next', timestamp: 10.5, offset: .5 }, observation: { description: { ...description(p), evidence_confidence: { brand_candidate: .96, model_candidate: .96, visible_text: .96, logos_markings: .96 } }, same_object_confidence: .98, identity_support: true } },
        ];
        add(candidate(`${id}-original`, p), comparison(p), true, true, 'Original fixture identity is revealed by next-frame text; selected geometry and candidate agree.');
      } else if (scenario === 'unavailable-vintage') {
        fixture.notes = 'Modeled unavailable inventory: original is absent from every fixture provider. A related replacement is purchasable in this controlled inventory. No claim about current live availability.';
        const alternative = { ...original, model: `${original.model} successor` };
        add(candidate(`${id}-replacement`, alternative), comparison(original, alternative, .86), false, true, 'A distinct replacement model, not the known original. Useful alternative; explicit model contradiction caps identity.');
      } else {
        fixture.notes = 'Unknown selected identity with weak pixels. All retrieved candidates have explicit dominant-color contradictions; truthful no-result is expected.';
        Object.assign(base, { brand_candidate: null, model_candidate: null, visible_text: [], logos_markings: [], distinctive_features: [] });
        const wrong = { ...p, color: 'red' };
        add(candidate(`${id}-wrong`, wrong), comparison({ ...p, brand: null, model: null }, wrong, .3), null, false, 'Wrong dominant color and poor image agreement; should be rejected.');
      }
      selections.push(fixture);
    }
  }
  return { schema_version: 1, mode: 'static_authored_evidence', selections };
}
