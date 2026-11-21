import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers/load-ts.mjs';

const { alphaCommerceRelevance } = loadModule(new URL('../src/server.ts', import.meta.url).pathname);

const p = (title, result_class) => ({
  id: title, title, result_class, destination:'https://merchant.example/'+encodeURIComponent(title),
});

test('visible verified SIMILAR excludes unrelated eBay RELATED clutter', () => {
  const rows = [
    p('Generic Shoulder Bag', 'RELATED'), p('Louis Vuitton Low Key Hobo', 'SIMILAR'),
    p('Random Designer Tote', 'RELATED'),
  ];
  assert.deepEqual(alphaCommerceRelevance(rows, 'Low Key Hobo').map(x=>x.title),
    ['Louis Vuitton Low Key Hobo']);
});

test('related results need a distinctive model and cannot pass on generic bag words', () => {
  const generic = [p('Random Leather Crossbody Bag', 'RELATED'),p('Other Canvas Tote', 'RELATED')];
  assert.equal(alphaCommerceRelevance(generic, null).length, 0);
  assert.equal(alphaCommerceRelevance(generic, 'Crossbody Bag').length, 0);
});

test('distinctive model tokens are required for RELATED suggestions', () => {
  const rows = [p('Louis Vuitton Side Trunk MM', 'RELATED'),p('Louis Vuitton Capucines MM', 'RELATED')];
  assert.deepEqual(alphaCommerceRelevance(rows, 'Side Trunk MM').map(x=>x.title),['Louis Vuitton Side Trunk MM']);
});

test('RELATED is never upgraded to SIMILAR and returns at most three tentative leads',()=>{
  const rows=Array.from({length:5},(_,i)=>p('Neverfull '+i,'RELATED'));
  const result=alphaCommerceRelevance(rows,'Neverfull');
  assert.equal(result.length,3); assert.ok(result.every(x=>x.result_class==='RELATED'));
});
