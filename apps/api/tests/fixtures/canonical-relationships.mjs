// Frozen hand-labeled canonical relationship fixtures for #237.
// Ground truth is declared by the fixture, never inferred from Scoop output.
import { example, apparelCases } from './apparel-benchmark.mjs';

function exactCase() {
  const value = example(apparelCases[0], '-merchant-b');
  value.description.brand_candidate = 'Nike';
  value.description.model_candidate = 'Style 123';
  value.description.visible_text = ['Nike', 'Style 123'];
  value.description.logos_markings = ['Nike'];
  value.description.evidence_confidence = { visible_text: 0.95, logos_markings: 0.95 };
  value.description.identity_confidence = 0.95;
  value.candidate.title = 'Nike Style 123 t-shirt';
  value.candidate.metadata = { ...value.candidate.metadata, brand: 'Nike', model: 'Style 123' };
  value.comparison.source.brand = { value: 'Nike', confidence: 0.95, basis: 'image' };
  value.comparison.source.model = { value: 'Style 123', confidence: 0.95, basis: 'image' };
  value.comparison.candidate.brand = { value: 'Nike', confidence: 0.95, basis: 'image' };
  value.comparison.candidate.model = { value: 'Style 123', confidence: 0.95, basis: 'image' };
  value.comparison.similarity = 0.96;
  value.comparison.confidence = 0.96;
  value.comparison.matching_details = ['distinctive diagonal artwork placement'];
  return value;
}

function visibleMarkingExactCase() {
  const value = example(apparelCases[0], '-visible-marking-exact');
  value.description.brand_candidate = null;
  value.description.model_candidate = null;
  value.description.visible_text = ['BUILDING IS MY LOVE LANGUAGE'];
  value.description.logos_markings = [];
  value.description.evidence_confidence = { visible_text: 0.96, logos_markings: 0 };
  value.candidate.title = 'Building Is My Love Language black t-shirt';
  value.candidate.metadata = {};
  value.comparison.source.brand = { value: null, confidence: 0, basis: 'image' };
  value.comparison.source.model = { value: null, confidence: 0, basis: 'image' };
  value.comparison.candidate.brand = { value: null, confidence: 0, basis: 'image' };
  value.comparison.candidate.model = { value: null, confidence: 0, basis: 'image' };
  value.comparison.similarity = 0.96;
  value.comparison.confidence = 0.96;
  value.comparison.matching_details = ['matching typography placement and letter spacing', 'matching stacked text layout'];
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
  { id: 'same-design-visible-marking', expected: 'EXACT', ...visibleMarkingExactCase() },
  { id: 'hard-text-lookalike', expected: 'SIMILAR', ...textLookalikeCase() },
  { id: 'incomplete-visual-evidence', expected: 'SIMILAR', ...incompleteCase() },
];
