import { readFileSync } from 'node:fs';

const path = new URL('../wrangler.jsonc', import.meta.url);
const raw = readFileSync(path, 'utf8');

const required = [
  ['BENCHMARK_MODE', 'false'],
  ['VERIFIED_PRODUCT_TEST_MODE', 'false'],
];

for (const [name, value] of required) {
  const pattern = new RegExp(`"${name}"\\s*:\\s*"${value}"`);
  if (!pattern.test(raw)) {
    console.error(`Production config must set ${name}=${value}`);
    process.exit(1);
  }
}

const forbidden = [
  /"VERIFIED_PRODUCT_MAPPINGS_JSON"\s*:/,
  /"provenance"\s*:\s*"test_fixture"/,
  /"BENCHMARK_MODE"\s*:\s*"true"/,
  /"VERIFIED_PRODUCT_TEST_MODE"\s*:\s*"true"/,
];

for (const pattern of forbidden) {
  if (pattern.test(raw)) {
    console.error(`Unsafe production config matched: ${pattern}`);
    process.exit(1);
  }
}

console.log('Production config guard passed.');
