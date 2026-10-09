#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { auditVideoInventory } from '../tests/benchmark/roster-outliers/inventory-readiness.mjs';

const [, , manifestPath, evidencePath] = process.argv;
if (!manifestPath) {
  console.error('Usage: node tools/audit-video-inventory.mjs <manifest.json> [verified-ingestion-evidence.json]');
  process.exit(2);
}
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const evidence = evidencePath ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {};
  const report = auditVideoInventory(manifest, evidence);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'READY') process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
