import type { ObjectDescription } from './types.js';
import { accessoryContradiction, type ProductCandidate, type ProductContext } from './commerce.js';
import { attributes, canonical, compatible, gender, ageGroup, normalize, phrase, productType, sleeve, type Attribute, type Evidence, type ImageComparison } from './verification-evidence.js';

const HIGH = 0.85;
// Separate identity classification from the lower visual-relevance threshold. These are
// conservative evidence floors, not calibrated probabilities of product correctness.
const IDENTITY_VISUAL = 0.9;
const critical = new Set<Attribute>(['category', 'subtype', 'gender', 'age_group', 'color', 'sleeve', 'brand']);
export type VerificationDecision = { product: ProductCandidate | null; reasons: string[] };

const GENERIC_MARKING_TOKENS = new Set(['logo','logos','mark','marking','markings','wordmark','emblem','patch','symbol','graphic','print','printed','embroidered','embroidery','chest','front','center','centred','centered','red','black','white','blue','green','yellow','orange','pink','purple','grey','gray']);

function markingEvidenceScore(description: ObjectDescription, candidate: ProductCandidate, comparison?: ImageComparison): { score: number; reasons: string[] } {
  const candidateText = normalize([
    candidate.title,
    candidate.brand,
    candidate.model,
    candidate.metadata?.brand,
    candidate.metadata?.model,
    candidate.metadata?.description,
  ].filter(Boolean).join(' '));
  if (!candidateText) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];
  const seen = new Set<string>();

  for (const raw of description.visible_text.slice(0, 4)) {
    const text = normalize(raw);
    if (text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    if (phrase(candidateText, text)) {
      score += 5;
      reasons.push(`visible text agrees: ${raw}`);
    }
    if (score >= 10) break;
  }

  const candidateDetailText = normalize((comparison?.matching_details ?? []).join(' '));
  for (const raw of description.logos_markings.slice(0, 4)) {
    const tokens = normalize(raw).split(' ').filter((token) => token.length >= 4 && !GENERIC_MARKING_TOKENS.has(token));
    if (!tokens.length) continue;
    const hitsInCandidate = tokens.filter((token) => phrase(candidateText, token)).length;
    const hitsInDetails = candidateDetailText ? tokens.filter((token) => phrase(candidateDetailText, token)).length : 0;
    if (hitsInCandidate >= Math.max(1, Math.ceil(tokens.length * 0.5))) {
      score += 4;
      reasons.push(`logo/marking agrees with candidate metadata: ${raw}`);
    } else if (hitsInDetails >= Math.max(1, Math.ceil(tokens.length * 0.5))) {
      score += 3;
      reasons.push(`logo/marking agrees visually: ${raw}`);
    }
    if (score >= 12) break;
  }

  return { score: Math.min(score, 12), reasons: reasons.slice(0, 3) };
}

export function sourceEvidence(description: ObjectDescription): Evidence {
  const visual = [description.subcategory, ...description.style_attributes, ...description.shape_silhouette, ...description.distinctive_features].join(' ');
  const evidence: Evidence = {};
  const add = (key: Attribute, value: string | null, confidence = description.confidence) => {
    if (value) evidence[key] = { value, confidence, basis: 'description' };
  };
  add('category', description.category);
  add('subtype', productType(description.subcategory) ?? productType(visual));
  add('color', description.color);
  add('gender', gender(visual));
  add('age_group', ageGroup(visual));
  add('sleeve', sleeve(visual));
  add('brand', description.brand_candidate, description.identity_confidence);
  add('model', description.model_candidate, description.identity_confidence);
  add('material', description.material, Math.min(description.confidence, 0.7));
  return evidence;
}

export function candidateEvidence(candidate: ProductCandidate): Evidence {
  const metadata = candidate.metadata ?? {};
  const text = `${candidate.title} ${metadata.description ?? ''}`;
  const evidence: Evidence = {};
  const add = (key: Attribute, value: string | null | undefined, confidence = 0.95) => {
    if (value) evidence[key] = { value, confidence, basis: 'metadata' };
  };
  add('category', metadata.category);
  add('subtype', productType(metadata.category ?? '') ?? productType(text));
  add('gender', metadata.gender ?? gender(text));
  add('age_group', ageGroup(`${metadata.gender ?? ''} ${text}`));
  add('sleeve', metadata.sleeve ?? sleeve(text));
  // Multiple colors/variants do not establish a dominant color. Logos can be a secondary color.
  const color = canonical('color', text);
  const secondaryColorOnly = color && new RegExp(`\\b${color} (logo|trim|print|stripe)\\b`, 'i').test(text);
  add('color', metadata.color ?? (secondaryColorOnly || /\b(available|colors|colours)\b/i.test(text) ? null : color));
  add('brand', metadata.brand);
  add('model', metadata.model);
  add('material', metadata.material, 0.8);
  return evidence;
}


export function highConfidenceMetadataContradiction(description: ObjectDescription, candidate: ProductCandidate): string | null {
  const accessoryConflict = accessoryContradiction(description, candidate);
  if (accessoryConflict) return accessoryConflict;
  const expected = sourceEvidence(description);
  const observed = candidateEvidence(candidate);
  for (const key of critical) {
    const selected = expected[key];
    const item = observed[key];
    const a = canonical(key, selected?.value);
    const b = canonical(key, item?.value);
    if (!a || !b || !selected || !item) continue;
    if (selected.confidence >= HIGH && item.confidence >= HIGH && !compatible(key, a, b)) {
      return `${key} contradiction: selected ${a}, candidate ${b} (${item.basis})`;
    }
  }
  return null;
}

function groundedIdentity(description: ObjectDescription, observed: Evidence, comparison?: ImageComparison): boolean {
  if (!comparison) return false;
  return (['brand', 'model'] as const).every(key => {
    const source = comparison.source[key];
    const value = canonical(key, source?.value);
    if (!source || source.basis !== 'image' || source.confidence < HIGH || !value) return false;
    // A model/brand hypothesis is not a reading. Require literal source markings from
    // the initial/nearby analysis, corroborated by the independent image comparison.
    const fields = key === 'brand' ? ['visible_text', 'logos_markings'] as const : ['visible_text'] as const;
    const readable = fields.some(field => (description.evidence_confidence?.[field] ?? description.identity_confidence) >= HIGH
      && description[field].some(text => phrase(text, value)));
    if (!readable) return false;
    // Real provider metadata or candidate pixels can corroborate the identifier.
    // A title hit or model-generated "metadata" that the provider never supplied cannot.
    const image = comparison.candidate[key];
    return [observed[key], image?.basis === 'image' ? image : undefined].some(item => {
      const candidateValue = canonical(key, item?.value);
      return item && item.confidence >= HIGH && candidateValue && compatible(key, value, candidateValue);
    });
  });
}

export function verifyCandidate(
  description: ObjectDescription, candidate: ProductCandidate,
  comparison?: ImageComparison, context?: ProductContext, useMarkingEvidence = false,
): VerificationDecision {
  const accessoryConflict = accessoryContradiction(description, candidate);
  if (accessoryConflict) return { product: null, reasons: [accessoryConflict] };
  const expected = sourceEvidence(description);
  const observed = candidateEvidence(candidate);
  // Pixels outrank the initial model description, which may have mistaken a generic top.
  for (const key of attributes) {
    const source = comparison?.source[key];
    if (source && canonical(key, source.value) && source.confidence >= HIGH) expected[key] = source;
  }
  const reasons: string[] = [];
  const matched = new Set<Attribute>();
  const weights: Record<Attribute, number> = { category: 3, subtype: 20, gender: 3, age_group: 3, color: 8, sleeve: 7, brand: 18, model: 16, material: 3, neckline: 3 };
  let score = 0;
  let brandDisagrees = false;
  let identityConflict = false;
  const contradicted = new Set<Attribute>();
  for (const key of attributes) {
    const selected = expected[key];
    const a = canonical(key, selected?.value);
    if (!a || !selected) continue;
    const evidence = [observed[key], comparison?.candidate[key]].filter((item) => item && canonical(key, item.value));
    for (const item of evidence) {
      if (!item) continue;
      const b = canonical(key, item.value)!;
      if (!compatible(key, a, b)) {
        if (key === 'brand') brandDisagrees = true;
        if (selected.confidence >= HIGH && item.confidence >= HIGH) { identityConflict = true; contradicted.add(key); }
        if (critical.has(key) && selected.confidence >= HIGH && item.confidence >= HIGH) {
          return { product: null, reasons: [`${key} contradiction: selected ${a}, candidate ${b} (${item.basis})`] };
        }
      } else if (selected.confidence >= 0.6 && item.confidence >= 0.6 && !matched.has(key)) {
        matched.add(key);
        score += weights[key];
        reasons.push(`${key} agrees (${item.basis})`);
      }
    }
  }
  // Matching text corroborates identity; missing brand/model text never proves a mismatch.
  for (const key of ['brand', 'model'] as const) {
    const value = expected[key]?.value;
    if (!brandDisagrees && !contradicted.has(key) && value && phrase(candidate.title, value) && !matched.has(key) && (expected[key]?.confidence ?? 0) >= 0.6) {
      matched.add(key); score += weights[key]; reasons.push(`${key} agrees (title)`);
    }
  }
  const visual = comparison && comparison.confidence >= 0.65 ? comparison.similarity : 0;
  // A usable comparison must contribute positive visual relevance. This is an eligibility
  // threshold, not a claim of an attribute contradiction; truly uncertain images stay unknown.
  if (comparison && comparison.confidence >= 0.65 && visual < 0.6) return { product: null, reasons: ['insufficient visual agreement'] };
  if (visual >= 0.6) { score += Math.round(visual * 30); reasons.push('selected crop and candidate image agree'); }
  // Do not double-count basic attributes when the model repeats them as "distinctive" details.
  const basicTokens = new Set(['matching', 'same', 'both', 'product', 'garment', 'color', 'colour', 'sleeve', 'sleeves', 'neck', 'neckline', 'necklines', 'crew', 'round', 'short', 'long', 'shirt', 't',
    'solid', 'plain', 'basic', 'simple', 'scheme', 'regular', 'casual', 'fit', 'style', 'design', 'and', 'with', 'a', 'the',
    ...attributes.flatMap((key) => normalize(expected[key]?.value).split(' '))]);
  const details = (comparison?.matching_details ?? []).filter((detail) => normalize(detail).split(' ').filter((token) => !basicTokens.has(token)).length >= 2);
  const detailCount = visual >= 0.6 ? Math.min(new Set(details.map(normalize)).size, 3) : 0;
  score += detailCount * 3;
  if (detailCount) reasons.push(...details.slice(0, 3).map((detail) => `visual detail: ${detail}`));
  // Experiment: use already-extracted OCR/logo evidence only as a bounded
  // verification/reranking bonus. It cannot create candidates, add provider/model
  // calls, override contradictions, or independently qualify a result as LIKELY.
  if (useMarkingEvidence) {
    const marking = markingEvidenceScore(description, candidate, comparison);
    score += marking.score;
    reasons.push(...marking.reasons);
  }
  // Context is a tie-breaker only when it corroborates existing visual identity; never a gate.
  if (visual >= 0.6 && matched.has('brand') && matched.has('subtype') && context?.title && expected.brand?.value && phrase(context.title, expected.brand.value)) {
    score += 2; reasons.push('context corroborates visual identity');
  }
  const usefulMetadata = matched.has('subtype') && (matched.has('brand') || matched.has('color'));
  if ((!usefulMetadata && visual < 0.65) || score < 20) return { product: null, reasons: ['insufficient positive relevance evidence'] };
  const identityGrounded = groundedIdentity(description, observed, comparison);
  const strongVisual = visual >= IDENTITY_VISUAL && (comparison?.confidence ?? 0) >= IDENTITY_VISUAL;
  const likely = !brandDisagrees && !identityConflict && strongVisual && identityGrounded && matched.has('subtype') && score >= 60;
  if (!identityGrounded) reasons.push('readable source brand/model and independent candidate identity corroboration required for LIKELY');
  if (!strongVisual) reasons.push('strong visual agreement and comparison confidence required for LIKELY');
  // Search IDs and model guesses are not verified SKU evidence. Never manufacture EXACT.
  const result_class = likely ? 'LIKELY' : 'SIMILAR';
  if (!comparison) reasons.push('image comparison unavailable; identity remains uncertain');
  const identity = matched.has('brand') && matched.has('model')
    ? [expected.brand?.value, expected.model?.value, expected.subtype?.value, expected.color?.value, expected.gender?.value].map(normalize).join(':')
    : `${candidate.provenance}:${candidate.id}`;
  return { product: { ...candidate, result_class, verification_score: Math.round(score / 125 * 100), verification_reasons: reasons,
    verification_image_similarity: comparison?.similarity, verification_image_confidence: comparison?.confidence,
    verification_status: comparison ? 'multimodal' : 'metadata_only', identity_key: identity }, reasons };
}

export function rankVerified(products: ProductCandidate[]): ProductCandidate[] {
  return [...products].sort((a, b) => (b.verification_score ?? 0) - (a.verification_score ?? 0)
    || (a.identity_key ?? a.id).localeCompare(b.identity_key ?? b.id) || a.id.localeCompare(b.id));
}
