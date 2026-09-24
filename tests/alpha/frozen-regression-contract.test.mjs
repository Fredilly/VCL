import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const path = new URL("../golden/alpha-v1.json", import.meta.url);
const suite = JSON.parse(fs.readFileSync(path, "utf8"));

const EXPECTED_IDS = [
  "alpha-v1-001-durant-rockets-7",
  "alpha-v1-002-lakers-12",
  "alpha-v1-003-nike-sleeveless-hoodie",
  "alpha-v1-004-minnesota-grey-duck-shirt",
  "alpha-v1-005-fragrance",
  "alpha-v1-006-funko",
  "alpha-v1-007-sneaker"
];

test("alpha-v1 regression contract stays pinned to the frozen baseline", () => {
  assert.equal(suite.suite, "alpha-v1-regression");
  assert.equal(suite.baseline.branch, "baseline/alpha-v1");
  assert.equal(
    suite.baseline.commit,
    "aef9f97edc97a40ada0d66ae7417f7dccf680018"
  );
});

test("alpha-v1 regression contract contains the seven frozen cases", () => {
  assert.deepEqual(
    suite.cases.map((entry) => entry.id),
    EXPECTED_IDS
  );
});

test("every frozen case preserves evidence needed by intent, retrieval, and explanation", () => {
  for (const entry of suite.cases) {
    assert.ok(entry.expected_identity);
    assert.ok(Array.isArray(entry.required_evidence));
    assert.ok(entry.required_evidence.length > 0);
    assert.ok(Array.isArray(entry.forbidden_identity));
    assert.ok(entry.replay?.status === "ready" || entry.replay?.status === "capture_required");

    if (entry.replay.status === "ready") {
      assert.ok(entry.replay.source);
      assert.ok(entry.replay.source_case);
    }
  }
});

test("trust invariants remain explicit in the frozen contract", () => {
  const rules = suite.rules.join("\n");
  assert.match(rules, /false EXACT must remain 0/);
  assert.match(rules, /unsupported LIKELY must remain 0/);
  assert.match(rules, /must not be dropped from retrieval intent/);
  assert.match(rules, /explanation must not disagree with retrieval intent/);
});
