import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './helpers/load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mod = loadModule(resolve(here, '../src/verified-image-recovery.ts'));

const mapping = {
  platform: 'youtube',
  content_ref: 'youtube:1auV6jxLh_Q',
  scope: 'time_window',
  timestamp_start_ms: 36821,
  timestamp_end_ms: 46821,
  object_type: 'Shoulder Bag',
  brand: 'Louis Vuitton',
  product_id: 'M3A285',
  title: 'Louis Vuitton Multipass Monogram Rouge',
  destination: 'https://us.louisvuitton.com/eng-us/products/multipass-other-leathers-nvprod7150031v/M3A285',
  image_reference: null,
  provenance: 'admin_verified',
};

test('recovers image from Brave result pointing at exact verified product page', async () => {
  const fetchImpl = async () => Response.json({
    results: [{
      title: 'Multipass Monogram Rouge | LOUIS VUITTON',
      url: mapping.destination,
      properties: { url: 'https://example.cdn/multipass.jpg' },
      thumbnail: { src: 'https://example.cdn/multipass-thumb.jpg' },
    }],
  });

  const image = await mod.recoverVerifiedProductImage('test-key', mapping, fetchImpl);
  assert.equal(image, 'https://example.cdn/multipass.jpg');
});

test('accepts exact SKU and brand in indexed image title when page URL differs', async () => {
  const fetchImpl = async () => Response.json({
    results: [{
      title: 'Louis Vuitton Multipass M3A285 Monogram Rouge',
      url: 'https://example.com/editorial/multipass',
      thumbnail: { src: 'https://example.cdn/multipass-thumb.jpg' },
    }],
  });

  const image = await mod.recoverVerifiedProductImage('test-key', mapping, fetchImpl);
  assert.equal(image, 'https://example.cdn/multipass-thumb.jpg');
});

test('rejects generic lookalike image results without exact page or SKU evidence', async () => {
  const fetchImpl = async () => Response.json({
    results: [{
      title: 'Louis Vuitton Burgundy Shoulder Bag',
      url: 'https://example.com/generic-bag',
      properties: { url: 'https://example.cdn/wrong.jpg' },
    }],
  });

  const image = await mod.recoverVerifiedProductImage('test-key', mapping, fetchImpl);
  assert.equal(image, null);
});
