import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const config = await readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

test('alpha manifest keeps permissions narrow', () => {
  assert.match(config, /permissions:\s*\['activeTab', 'storage'\]/);
  assert.match(config, /host_permissions:\s*\['https:\/\/api\.vcl\.article6\.org\/\*'\]/);
  assert.doesNotMatch(config, /host_permissions:[^\n]*localhost/);
  assert.doesNotMatch(config, /host_permissions:[^\n]*127\.0\.0\.1/);
});

test('commerce context does not transmit the full browsing URL', () => {
  const start = content.indexOf('function surfaceContext()');
  const end = content.indexOf('function removeOverlay()', start);
  assert.ok(start >= 0 && end > start);
  const surfaceContext = content.slice(start, end);
  assert.doesNotMatch(surfaceContext, /location\.href/);
  assert.doesNotMatch(surfaceContext, /\burl\s*:/);
  assert.match(surfaceContext, /platform:/);
  assert.match(surfaceContext, /title:/);
});

test('content script is limited to supported alpha surfaces', () => {
  assert.match(content, /matches:\s*\['https:\/\/www\.youtube\.com\/\*', 'http:\/\/localhost\/\*', 'http:\/\/127\.0\.0\.1\/\*'\]/);
  assert.doesNotMatch(content, /<all_urls>/);
});


test('persistent extension storage is limited to anonymous alpha install id', async () => {
  const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
  assert.match(background, /scoop_alpha_install_id/);
  assert.match(background, /browser\.storage\.local\.get\(INSTALL_ID_KEY\)/);
  assert.match(background, /browser\.storage\.local\.set\(\{ \[INSTALL_ID_KEY\]: created \}\)/);
  assert.doesNotMatch(background, /storage\.local\.(set|remove).*dataUrl/);
  assert.doesNotMatch(background, /storage\.local\.(set|remove).*location\.href/);
});
