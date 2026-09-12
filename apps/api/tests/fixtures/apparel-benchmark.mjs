// Hand-labeled evidence fixtures, not model predictions or a claim about pixel-model accuracy.
// Same hidden visual contradictions and uncertainty controls across brands, with no brand rules.
export const apparelCases = [
  ['Nike', 't-shirt', 'black', 'short', 'men'],
  ['Adidas', 'hoodie', 'blue', 'long', 'women'],
  ['Uniqlo', 'sweater', 'cream', 'long', 'men'],
  ['Patagonia', 'jacket', 'green', 'long', 'women'],
  ['Ralph Lauren', 'polo', 'red', 'short', 'men'],
  ["Levi's", 'jeans', 'blue', null, 'women'],
  ['Zara', 'dress', 'black', 'sleeveless', 'women'],
  ['H&M', 'cardigan', 'gray', 'long', 'men'],
  ["Arc'teryx", 'coat', 'black', 'long', 'women'],
  ['Lululemon', 'leggings', 'purple', null, 'women'],
  ['Carhartt', 'sweatshirt', 'brown', 'long', 'men'],
  ['COS', 'shirt', 'white', 'long', 'women'],
];

export function example([brand, subtype, color, sleeve, gender], suffix = '') {
  const description = { category: 'Apparel', subcategory: subtype, brand_candidate: brand, model_candidate: null,
    color, material: '', style_attributes: [gender, ...(sleeve ? [`${sleeve} sleeve`] : [])], visible_text: [brand], logos_markings: [],
    distinctive_features: [], hardware_details: [], shape_silhouette: [], search_terms: [], confidence: 0.95, identity_confidence: 0.95 };
  const attributes = Object.fromEntries(Object.entries({ category: 'apparel', subtype, color, sleeve, gender, brand })
    .map(([key, value]) => [key, { value, confidence: value ? 0.95 : 0, basis: key === 'gender' ? 'metadata' : 'image' }]));
  return { description,
    candidate: { id: `${brand}-${subtype}${suffix}`, title: `${brand} ${gender} ${color} ${subtype}`, brand: null, model: null, category: null,
      image_reference: 'https://cdn.shopify.com/product.jpg', provenance: 'fixture', destination: `https://shop.example/${brand}${suffix}`, price: '99', currency: 'USD', result_class: 'SIMILAR',
      metadata: { brand, gender } },
    comparison: { source: structuredClone(attributes), candidate: structuredClone(attributes), similarity: 0.91, confidence: 0.95,
      matching_details: ['matching seam placement', 'matching hem construction'] } };
}

export function benchmark() {
  const cases = [];
  for (const spec of apparelCases) {
    const base = example(spec);
    cases.push({ name: `${spec[0]} ${spec[1]} positive`, ...base, accept: true });
    const unknown = example(spec, '-unknown');
    unknown.candidate.title = 'Garment'; unknown.candidate.metadata = {};
    unknown.comparison.candidate.brand = { value: null, confidence: 0, basis: 'image' };
    unknown.comparison.candidate.gender = { value: null, confidence: 0, basis: 'image' };
    cases.push({ name: `${spec[0]} missing brand/gender stays eligible`, ...unknown, accept: true });
    for (const [key, value] of Object.entries({ color: spec[2] === 'red' ? 'blue' : 'red', subtype: spec[1] === 'dress' ? 'coat' : 'dress',
      gender: spec[4] === 'men' ? 'women' : 'men', brand: 'Another Label', ...(spec[3] ? { sleeve: spec[3] === 'long' ? 'short' : 'long' } : {}) })) {
      const wrong = example(spec, `-${key}`);
      wrong.comparison.candidate[key] = { value, confidence: 0.95, basis: key === 'gender' ? 'metadata' : 'image' };
      cases.push({ name: `${spec[0]} rejects ${key} despite matching title`, ...wrong, accept: false });
      const uncertain = structuredClone(wrong);
      uncertain.comparison.candidate[key].confidence = 0.4;
      cases.push({ name: `${spec[0]} uncertain ${key} stays eligible`, ...uncertain, accept: true });
    }
  }
  return cases;
}
