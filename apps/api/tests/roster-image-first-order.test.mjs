import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
const body=server.slice(server.indexOf('async function confirmSameVideoReuseWithImage('),server.indexOf('async function confirmSameVideoReuseWithImage(')+14500);
test('live roster verification prefers SKU destination reference before broad commerce refresh',()=>{
 const source=body.indexOf('sourceImageForVerifiedMapping(candidate.mapping)');
 const refresh=body.indexOf('refreshVerifiedOffers(providers, candidate.mapping)');
 assert.ok(source>0&&refresh>0&&source<refresh,'same-video matching should use linked image before third-party offers');
});
test('reference recovery is candidate evidence, never a bypass of visual check',()=>{
 assert.match(body,/compareCandidateImages\(/);
 assert.match(body,/recoverVerifiedProductImage\(/);
 assert.match(body,/missing_sku_image_reference/);
});
