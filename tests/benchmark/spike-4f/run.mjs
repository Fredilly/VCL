import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createCorpus } from './corpus.mjs';
import { validateCorpus, scoreSelection, summarize, reportMarkdown, digest } from './metrics.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.shift() ?? 'static';
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing ${name} value`);
  return args[index + 1];
};
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const output = resolve(option('--output', `${root}/local`));
const corpus = validateCorpus(createCorpus());
await mkdir(output, { recursive: true });
let observations, reviews, provenance;
if (mode === 'static') {
  const { runStatic } = await import('./static.mjs');
  ({ observations, reviews } = await runStatic(corpus));
  const sourceRoot = resolve(root, '../../../apps/api/src');
  const sources = (await readdir(sourceRoot)).filter(f => f.endsWith('.ts')).sort();
  provenance = { pipeline_revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    pipeline_source_sha256: digest(await Promise.all(sources.map(async f => [f, await readFile(`${sourceRoot}/${f}`, 'utf8')]))),
    node_version: process.version, platform: process.platform, architecture: process.arch };
} else if (mode === 'replay') {
  ({ observations, reviews, provenance } = await json(resolve(option('--input', `${root}/results/recording.json`))));
} else throw Error(`Unknown mode ${mode}; use static or replay`);
if (observations.length !== corpus.selections.length) throw Error('Every selection must have an observation, including failures');
if (new Set(observations.map(o => o.selection_id)).size !== observations.length) throw Error('Duplicate observations');
const rows = corpus.selections.map(selection => {
  const observation = observations.find(o => o.selection_id === selection.id);
  if (!observation || observation.corpus_sha256 !== digest(corpus)) throw Error(`Missing observation or changed corpus: ${selection.id}`);
  return scoreSelection(selection, observation, reviews[selection.id]);
});
const metrics = summarize(rows);
const safeguardsPass = metrics.all_returned_exact.false === 0 && metrics.all_returned_exact.unknown === 0
  && metrics.useful_result_rate.value >= .7 && metrics.request_failures === 0;
const calibrationPass = rows.every(r => {
  const level = { NO_RESULT: 0, SIMILAR: 1, LIKELY: 2, EXACT: 3 };
  return level[r.actual_classification] <= level[r.expected_classification];
});
const report = { schema_version: 1, mode: 'static_authored_evidence', corpus_sha256: digest(corpus), provenance,
  decision: safeguardsPass && calibrationPass ? 'PASS (static evidence gate only)' : 'FAIL',
  gates: { no_false_or_unverified_exact: metrics.all_returned_exact.false === 0 && metrics.all_returned_exact.unknown === 0,
    useful_at_least_70_percent: metrics.useful_result_rate.value >= .7, no_request_failures: metrics.request_failures === 0,
    classification_ceiling: calibrationPass }, metrics,
  partitions: { known: rows.filter(r => r.ground_truth.status === 'known').map(r => r.selection_id),
    unknown: rows.filter(r => r.ground_truth.status === 'unknown').map(r => r.selection_id) },
  limitations: ['Static authored evidence, not measured image-model or real-video identification accuracy.',
    'Product identity means the fixture’s named model and color, not authenticity, serial number, or unstated SKU variants.',
    'Precision uses independently labeled top candidates; usefulness and false EXACT inspect every returned candidate.',
    'Unknown identities are excluded from precision. No EXACT claims means precision is N/A.',
    'Latency is local resolver/merger execution with mocked providers and image comparisons, not live end-to-end latency.',
    'Provider failures are injected and counted per call; they are not an estimate of live reliability.',
    'Repeated scenarios and product families are correlated; this is a regression benchmark, not a population estimate.'], rows };
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
await writeFile(`${output}/report.md`, reportMarkdown(report));
if (mode === 'static') await writeFile(`${output}/recording.json`, JSON.stringify({ schema_version: 1, provenance,
  corpus_sha256: digest(corpus), observations, reviews }, null, 2) + '\n');
console.log(JSON.stringify({ decision: report.decision, gates: report.gates, ...metrics }, null, 2));
if (args.includes('--strict') && report.decision === 'FAIL') process.exitCode = 1;
