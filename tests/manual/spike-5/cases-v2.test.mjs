import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const originalCasesHash = '9b8ef2e0b7e7a4b6e0a7f5a0e3b8c2d1';

test('original cases.json remains unchanged (historical frozen corpus)', async () => {
  const cases = await read('./cases.json');
  assert.equal(cases.schema_version, 1);
  assert.equal(cases.cases.length, 10);
  assert.equal(cases.frozen_at, '2026-09-15T00:00:00Z');
  const ids = cases.cases.map((c) => c.id);
  assert.deepEqual(ids, ['s5-01', 's5-02', 's5-03', 's5-04', 's5-05', 's5-06', 's5-07', 's5-08', 's5-09', 's5-10']);
  assert.equal(cases.cases.find((c) => c.id === 's5-08').timestamp_s, 80);
  assert.equal(cases.cases.find((c) => c.id === 's5-10').timestamp_s, 60);
});

test('cases-v2.json has 10 entries with correct metadata', async () => {
  const v2 = await read('./cases-v2.json');
  assert.equal(v2.schema_version, 2);
  assert.equal(v2.corpus_version, 2);
  assert.equal(v2.based_on, 'tests/manual/spike-5/cases-corrected.json');
  assert.equal(v2.corrected_at, '2026-09-18');
  assert.equal(v2.cases.length, 10);
  assert.ok(v2.rules.length >= 4);
});

test('s5-08 timestamp is exactly 90 in v2', async () => {
  const v2 = await read('./cases-v2.json');
  const s508 = v2.cases.find((c) => c.id === 's5-08');
  assert.equal(s508.timestamp_s, 90);
  assert.equal(s508.corrected, true);
  assert.ok(s508.correction_note.includes('90s'));
});

test('s5-10 has valid=false in v2', async () => {
  const v2 = await read('./cases-v2.json');
  const s510 = v2.cases.find((c) => c.id === 's5-10');
  assert.equal(s510.valid, false);
  assert.ok(s510.correction_note.includes('60s frame did not contain'));
});

test('s5-09 has valid=false in v2', async () => {
  const v2 = await read('./cases-v2.json');
  const s509 = v2.cases.find((c) => c.id === 's5-09');
  assert.equal(s509.valid, false);
  assert.ok(s509.correction_note.includes('packaging/workstation'));
});

test('s5-05 corrected coordinates preserved in v2', async () => {
  const v2 = await read('./cases-v2.json');
  const s505 = v2.cases.find((c) => c.id === 's5-05');
  assert.deepEqual(s505.selection, { x: 0.3, y: 0.4 });
  assert.equal(s505.corrected, true);
});

test('invalid cases are excluded from Golden pass/fail denominator', async () => {
  const v2 = await read('./cases-v2.json');
  const validCases = v2.cases.filter((c) => c.valid !== false);
  const invalidCases = v2.cases.filter((c) => c.valid === false);
  assert.equal(validCases.length, 8);
  assert.equal(invalidCases.length, 2);
  const invalidIds = invalidCases.map((c) => c.id).sort();
  assert.deepEqual(invalidIds, ['s5-09', 's5-10']);
});

test('no false EXACT / unsupported LIKELY remains a hard failure rule', async () => {
  const v2 = await read('./cases-v2.json');
  const validCases = v2.cases.filter((c) => c.valid !== false);
  for (const c of validCases) {
    assert.ok(c.id, `case ${c.id} must have an id`);
    assert.ok(c.source, `case ${c.id} must have a source`);
    assert.ok(typeof c.timestamp_s === 'number', `case ${c.id} must have a numeric timestamp_s`);
    assert.ok(c.selected_item, `case ${c.id} must have a selected_item`);
  }
});

test('useful SIMILAR or truthful NO_RESULT remains acceptable', async () => {
  const v2 = await read('./cases-v2.json');
  const validCases = v2.cases.filter((c) => c.valid !== false);
  assert.equal(validCases.length, 8, '8 valid cases for Golden gate');
  const ids = validCases.map((c) => c.id);
  assert.ok(ids.includes('s5-08'), 's5-08 (corrected to 90s) is valid');
  assert.ok(!ids.includes('s5-09'), 's5-09 is excluded as invalid');
  assert.ok(!ids.includes('s5-10'), 's5-10 is excluded as invalid');
});
