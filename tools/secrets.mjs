import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const registry = JSON.parse(readFileSync(new URL('../apps/api/secrets.registry.json', import.meta.url), 'utf8'));
const config = 'apps/api/wrangler.jsonc';
const [command, name] = process.argv.slice(2);

function run(args, options = {}) {
  return spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    stdio: options.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
}

if (command === 'add') {
  if (!name || !registry[name]) {
    console.error('Unknown secret name.');
    console.error('Known names:');
    for (const key of Object.keys(registry)) console.error('  ' + key);
    process.exit(1);
  }
  console.log(name + ' — ' + registry[name]);
  const put = run(['secret', 'put', name, '--config', config]);
  if (put.status !== 0) process.exit(put.status ?? 1);

  console.log('\nChecking production health...');
  const health = await fetch('https://api.vcl.article6.org/health');
  if (!health.ok) {
    console.error('Secret updated, but production health check failed: HTTP ' + health.status);
    process.exit(1);
  }
  const body = await health.json().catch(() => ({}));
  if (body?.status !== 'ok') {
    console.error('Secret updated, but production health response was unexpected.');
    process.exit(1);
  }
  console.log('Production health: ok');
  process.exit(0);
}

if (command === 'check') {
  const listed = run(['secret', 'list', '--format', 'json', '--config', config], { capture: true });
  if (listed.status !== 0) process.exit(listed.status ?? 1);
  let rows;
  try { rows = JSON.parse(listed.stdout || '[]'); }
  catch {
    console.error('Could not parse Wrangler secret list output.');
    process.exit(1);
  }
  const present = new Set(rows.map((row) => row?.name).filter(Boolean));
  for (const [key, purpose] of Object.entries(registry)) {
    console.log((present.has(key) ? '✓' : '○') + ' ' + key + ' — ' + purpose);
  }
  console.log('\n✓ present   ○ not configured / optional');
  process.exit(0);
}

console.log('Usage:');
console.log('  pnpm secret:add OPENROUTER_API_KEY');
console.log('  pnpm secrets:check');
process.exit(command ? 1 : 0);
