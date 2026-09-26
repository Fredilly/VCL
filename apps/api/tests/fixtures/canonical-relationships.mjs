// Frozen hand-labeled canonical relationship fixtures for #237.
// Ground truth is declared by the fixture, never inferred from Scoop output.
import { example, apparelCases } from './apparel-benchmark.mjs';

function exactCase() {
  const value = example(apparelCases[0], '-merchant-b');
  value.description.model_candidate = 'BUILD-001';
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.description.logos_markings = ['building love language wordmark'];
  value.candidate.title = 'Nike BUILD-001 Building is My Love Language t-shirt';
  value.candidate.model = 'BUILD-001';
  value.candidate.metadata.model = 'BUILD-001';
  value.comparison.source.model = { value: 'BUILD-001', confidence: 0.95, basis: 'image' };
  value.comparison.candidate.model = { value: 'BUILD-001', confidence: 0.95, basis: 'image' };
  value.comparison.matching_details = ['matching building wordmark artwork', 'matching seam placement'];
  return value;
}

function similarCase() {
  const value = example(apparelCases[0], '-different-layout');
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.candidate.title = 'Building is My Love Language black t-shirt';
  value.candidate.metadata = {};
  value.comparison.matching_details = ['different typography and underline treatment'];
  return value;
}

function relatedCase() {
  const value = example(apparelCases[0], '-related');
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.candidate.title = 'Music is My Love Language black t-shirt';
  value.candidate.metadata = {};
  value.comparison.similarity = 0.55;
  value.comparison.confidence = 0.5;
  return value;
}

function textLookalikeCase() {
  const value = example(apparelCases[0], '-text-lookalike');
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.candidate.title = 'Nike Building is My Love Language black t-shirt';
  value.comparison.matching_details = ['generic black shirt', 'same phrase in different layout'];
  return value;
}

function incompleteCase() {
  const value = example(apparelCases[0], '-incomplete');
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.candidate.title = 'Nike Building is My Love Language black t-shirt';
  value.comparison = undefined;
  return value;
}

export const canonicalRelationshipCases = [
  { id: 'same-design-merchant-b', expected: 'EXACT', ...exactCase() },
  { id: 'same-phrase-different-layout', expected: 'SIMILAR', ...similarCase() },
  { id: 'same-theme-different-identity', expected: 'RELATED', ...relatedCase() },
  { id: 'hard-text-lookalike', expected: 'SIMILAR', ...textLookalikeCase() },
  { id: 'incomplete-visual-evidence', expected: 'SIMILAR', ...incompleteCase() },
];
