import { parseSourceImage } from './candidate-images.js';
import { canonical, compatible, normalize, sleeve } from './verification-evidence.js';
import { normalizeObjectDescription, type ObjectDescription, type NearbyObservation, type VisionProvider } from './types.js';
import type { SelectionPoint } from './selection-target.js';

export const EVIDENCE_FIELDS = ['category', 'subcategory', 'brand_candidate', 'model_candidate', 'color', 'material',
  'style_attributes', 'visible_text', 'logos_markings', 'distinctive_features', 'hardware_details', 'shape_silhouette'] as const;
type Field = typeof EVIDENCE_FIELDS[number];
export type EvidenceFrame = { id: 'previous' | 'next'; timestamp: number; offset: number; dataUrl: string };
type Contribution = { field: Field; value: string | string[] | null; confidence: number; decision: string };
type FrameDebug = { id: string; timestamp: number | null; offset: number; status: string; contributions: Contribution[] };
const known = (value: unknown) => Array.isArray(value) ? value.some(known)
  : typeof value === 'string' && value.trim().length > 0 && !/^(unknown|unclear|n\/a|none|null|not visible|unreadable)$/i.test(value.trim());
const equal = (a: unknown, b: unknown) => JSON.stringify(a)?.toLowerCase() === JSON.stringify(b)?.toLowerCase();
function structure(text: string, attribute: 'sleeve' | 'neckline'): string | null {
  if (attribute === 'sleeve') return sleeve(text);
  const necklines = [/\b(crew[ -]?neck|round neck)\b/i.test(text) ? 'crew' : null,
    /\bv[ -]?neck\b/i.test(text) ? 'v neck' : null, /\b(turtleneck|roll neck)\b/i.test(text) ? 'turtleneck' : null,
    /\b(collared|shirt collar|polo collar)\b/i.test(text) ? 'collared' : null].filter(Boolean);
  return necklines.length === 1 ? necklines[0] : null;
}

export function parseEvidenceFrames(value: unknown, timestamp: number): EvidenceFrame[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error('Use at most two nearby crops');
  const seen = new Set<string>();
  return value.map((entry): EvidenceFrame => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid nearby frame');
    const v = entry as Record<string, unknown>;
    if ((v.id !== 'previous' && v.id !== 'next') || seen.has(v.id) || typeof v.timestamp !== 'number' ||
        !Number.isFinite(v.timestamp) || v.timestamp < 0 || typeof v.offset !== 'number' || !Number.isFinite(v.offset) ||
        Math.abs(v.offset - (v.id === 'previous' ? -0.5 : 0.5)) > 0.1 ||
        Math.abs(v.timestamp - timestamp - v.offset) > 0.001 || !parseSourceImage(v.dataUrl)) {
      throw new Error('Invalid nearby crop or timestamp');
    }
    seen.add(v.id);
    return { id: v.id, timestamp: v.timestamp, offset: v.offset, dataUrl: v.dataUrl as string };
  }).sort((a, b) => a.offset - b.offset);
}

export function mergeFrameEvidence(primary: ObjectDescription, timestamp: number | null,
  observations: { frame: Omit<EvidenceFrame, 'dataUrl'>; observation?: NearbyObservation }[]) {
  const description = normalizeObjectDescription(primary);
  const winners = new Map<Field, { id: string; confidence: number }>();
  const frames: FrameDebug[] = [{ id: 'current', timestamp, offset: 0, status: 'primary', contributions: [] }];
  for (const field of EVIDENCE_FIELDS) {
    // Old single-frame clients have no field confidence: protect their known evidence.
    const confidence = known(primary[field]) ? primary.evidence_confidence?.[field] ?? 0.8 : 0;
    winners.set(field, { id: 'current', confidence });
    if (known(primary[field])) frames[0].contributions.push({ field, value: primary[field], confidence, decision: 'primary' });
  }
  for (const { frame, observation } of observations) {
    const debug: FrameDebug = { ...frame, status: observation ? 'analyzed' : 'analysis_failed', contributions: [] };
    frames.push(debug);
    if (!observation) continue;
    const nearby = observation.description;
    const sameObject = observation.same_object_confidence >= 0.9;
    debug.status = sameObject ? 'same_object' : 'object_not_confirmed';
    // Never join model clues from another brand to the primary identity.
    const conflictingBrand = known(description.brand_candidate) && known(nearby.brand_candidate) &&
      !compatible('brand', canonical('brand', description.brand_candidate)!, canonical('brand', nearby.brand_candidate)!) && winners.get('brand_candidate')!.confidence >= 0.8;
    // Unknown taxonomy labels must not disable the object-category guard.
    // Keep this generic: no selected-product or brand-specific targeting rules.
    const primaryCategory = canonical('category', description.category) ?? normalize(description.category);
    const nearbyCategory = canonical('category', nearby.category) ?? normalize(nearby.category);
    const conflictingCategory = primaryCategory && nearbyCategory && primaryCategory !== nearbyCategory;
    for (const field of EVIDENCE_FIELDS) {
      const value = nearby[field];
      const strength = nearby.evidence_confidence?.[field] ?? 0;
      const winner = winners.get(field)!;
      let decision = 'unknown';
      if (known(value)) {
        if (!sameObject) decision = 'object_not_confirmed';
        else if (conflictingCategory) decision = 'category_conflict';
        else if (strength < 0.8) decision = 'weak_evidence';
        else if (conflictingBrand && ['brand_candidate', 'model_candidate', 'visible_text', 'logos_markings'].includes(field)) decision = 'identity_conflict';
        else if ((field === 'brand_candidate' || field === 'model_candidate') &&
          (!observation.identity_support || !((nearby.visible_text.length && (nearby.evidence_confidence?.visible_text ?? 0) >= 0.8) ||
            (nearby.logos_markings.length && (nearby.evidence_confidence?.logos_markings ?? 0) >= 0.8)))) decision = 'identity_not_grounded';
        else if (Array.isArray(value) && (['sleeve', 'neckline'] as const).some((attribute) => {
          const proposed = structure(value.join(' '), attribute);
          return proposed && EVIDENCE_FIELDS.some((existingField) => {
            if (winners.get(existingField)!.confidence < 0.8) return false;
            const existing = description[existingField];
            const supported = structure(Array.isArray(existing) ? existing.join(' ') : existing ?? '', attribute);
            return supported && supported !== proposed;
          });
        })) decision = 'structural_conflict';
        else if (equal(value, description[field])) decision = 'agreement';
        else if (known(description[field]) && (winner.confidence >= 0.8 || strength < winner.confidence + 0.15)) decision = 'preserve_stronger_or_conflicting_evidence';
        else if (field === 'category' && known(description.category)) decision = 'primary_category_anchor';
        else {
          // Arrays are atomic claims: never concatenate incompatible sleeve/neckline/color assertions.
          Object.assign(description, { [field]: value });
          winners.set(field, { id: frame.id, confidence: strength });
          decision = 'accepted';
        }
      }
      debug.contributions.push({ field, value, confidence: strength, decision });
    }
  }
  const changed = EVIDENCE_FIELDS.filter((field) => !equal(primary[field], description[field]));
  if (changed.includes('brand_candidate') && !changed.includes('model_candidate') && known(primary.model_candidate)) {
    // A model attached to a superseded brand must not leak into the merged query.
    description.model_candidate = null;
    changed.push('model_candidate');
  }
  if (changed.length) {
    description.evidence_confidence = Object.fromEntries([...winners].map(([field, winner]) => [field, winner.confidence]));
    // Rebuild from accepted values only; nearby search queries may contain rejected guesses.
    description.search_terms = [[description.brand_candidate, description.model_candidate, description.color,
      description.subcategory || description.category, ...description.visible_text.slice(0, 2)].filter(known).join(' ')];
    if (changed.includes('brand_candidate') || changed.includes('model_candidate')) {
      description.identity_confidence = Math.min(winners.get('brand_candidate')!.confidence,
        known(description.model_candidate) ? winners.get('model_candidate')!.confidence : 0.7);
    }
  }
  return { ...description, multi_frame: {
    strategy: 'user_requested_previous_current_next', frames_used: frames.filter((frame) => frame.status !== 'analysis_failed').length,
    frames_contributing: new Set(['current', ...[...winners.values()].map((winner) => winner.id)]).size,
    frames, changed_hypothesis: changed.length > 0, changed_fields: changed,
    field_sources: Object.fromEntries([...winners].map(([field, winner]) => [field, winner.id])),
    primary_hypothesis: normalizeObjectDescription(primary),
  } };
}

export async function analyzeWithNearbyFrames(provider: VisionProvider, primaryImage: string, primary: ObjectDescription,
  timestamp: number, frames: EvidenceFrame[], point?: SelectionPoint) {
  // The frames are an explicit user request, including when the primary guess is confident.
  // The merger still decides which evidence is strong enough to contribute.
  if (!provider.analyzeNearbyFrame) return mergeFrameEvidence(primary, timestamp, []);
  const observations = [];
  for (const { dataUrl, ...frame } of frames) {
    try {
      observations.push({ frame, observation: await provider.analyzeNearbyFrame(primaryImage, dataUrl, primary, point) });
    } catch {
      // Never log provider payloads or frame bytes. The primary result survives any extra-frame failure.
      observations.push({ frame });
    }
  }
  return mergeFrameEvidence(primary, timestamp, observations);
}
