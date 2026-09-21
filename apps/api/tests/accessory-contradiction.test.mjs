import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const commerce = loadModule(resolve(here, '../src/commerce.ts'));
const verification = loadModule(resolve(here, '../src/candidate-verification.ts'));

const description = (overrides = {}) => ({
  category: 'Electronics',
  subcategory: 'Smartphone',
  brand_candidate: null,
  model_candidate: null,
  color: '',
  material: '',
  style_attributes: [],
  visible_text: [],
  logos_markings: [],
  distinctive_features: [],
  hardware_details: [],
  shape_silhouette: [],
  search_terms: [],
  confidence: 0.95,
  identity_confidence: 0.2,
  ...overrides,
});

const candidate = (title, overrides = {}) => ({
  id: title,
  title,
  brand: null,
  model: null,
  category: null,
  image_reference: null,
  provenance: 'test',
  destination: 'https://example.test/item',
  price: null,
  currency: null,
  result_class: 'SIMILAR',
  ...overrides,
});

const parentCases = [
  {
    name: 'vehicle rejects floor mats',
    description: description({ category: 'Vehicle', subcategory: 'SUV', search_terms: ['Tesla Model Y SUV'] }),
    candidate: candidate('Floor Mats for Tesla Model Y 2024 All Weather'),
  },
  {
    name: 'phone rejects cases',
    description: description({ category: 'Electronics', subcategory: 'Smartphone' }),
    candidate: candidate('Protective Phone Case for iPhone 15 Pro'),
  },
  {
    name: 'camera rejects straps',
    description: description({ category: 'Electronics', subcategory: 'Mirrorless Camera' }),
    candidate: candidate('Camera Strap for Sony A7 IV'),
  },
  {
    name: 'watch rejects replacement bands',
    description: description({ category: 'Wearables', subcategory: 'Smartwatch' }),
    candidate: candidate('Replacement Watch Band for Apple Watch Series 9'),
  },
  {
    name: 'furniture rejects covers',
    description: description({ category: 'Home', subcategory: 'Sofa' }),
    candidate: candidate('Stretch Sofa Cover Washable Slipcover'),
  },
  {
    name: 'garment rejects unrelated accessories',
    description: description({ category: 'Apparel', subcategory: 'Jacket' }),
    candidate: candidate('Leather Belt for Men'),
  },
];

for (const fixture of parentCases) {
  test(fixture.name, () => {
    assert.match(commerce.accessoryContradiction(fixture.description, fixture.candidate) ?? '', /accessory contradiction/);
    assert.equal(commerce.verifyProductCandidate(fixture.description, fixture.candidate), null);
    const deep = verification.verifyCandidate(fixture.description, fixture.candidate);
    assert.equal(deep.product, null);
    assert.match(deep.reasons[0], /accessory contradiction/);
  });
}

test('legitimate accessory selection is not reinterpreted as its parent', () => {
  const selected = description({
    category: 'Accessories',
    subcategory: 'Phone Case',
    brand_candidate: 'Apple',
    model_candidate: 'MagSafe',
    search_terms: ['Apple MagSafe phone case'],
  });
  const result = candidate('Apple MagSafe Phone Case for iPhone 15', {
    brand: 'Apple',
    model: 'MagSafe',
    metadata: { brand: 'Apple', model: 'MagSafe', category: 'Phone Cases' },
  });

  assert.equal(commerce.accessoryContradiction(selected, result), null);
  assert.ok(commerce.verifyProductCandidate(selected, result));
});

test('clear parent bundle with an included accessory is not rejected', () => {
  const selected = description({ category: 'Electronics', subcategory: 'Smartphone' });
  const bundle = candidate('Smartphone with charger included');
  assert.equal(commerce.accessoryContradiction(selected, bundle), null);
});

test('unknown family remains unknown rather than contradiction', () => {
  const selected = description({ category: 'Home', subcategory: 'Lamp' });
  const result = candidate('Replacement shade hardware');
  assert.equal(commerce.accessoryContradiction(selected, result), null);
});
