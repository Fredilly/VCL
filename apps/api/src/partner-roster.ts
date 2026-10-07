import { canonicalProductIdentity, type CanonicalProductIdentity } from './canonical-product-memory.js';
import type { VerifiedProductMapping } from './verified-product-mapping.js';

function normalizeContentRef(platform: string | null | undefined, value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if ((platform ?? '').trim().toLowerCase() !== 'youtube') return raw.toLowerCase();
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('v');
    if (id) return id.toLowerCase();
  } catch {}
  return raw.replace(/^youtube:/i, '').toLowerCase();
}

export type VerifiedRosterCanonicalRow = {
  mapping: VerifiedProductMapping;
  identity: CanonicalProductIdentity;
};

/**
 * Convert any verified multi-product roster into same-video canonical candidates.
 *
 * Roster membership is candidate evidence only. candidate_window_* may narrow the
 * comparison set, but never asserts Exact. Identity still goes through the normal
 * same-video visual verifier and contradiction gates.
 */
export function verifiedRosterCanonicalRowsForContent(
  mappings: VerifiedProductMapping[],
  platform: string | null | undefined,
  contentRef: string | null | undefined,
  timestampMs?: number | null,
): VerifiedRosterCanonicalRow[] {
  const normalizedPlatform = (platform ?? '').trim().toLowerCase();
  const normalizedRef = normalizeContentRef(platform, contentRef);
  if (!normalizedPlatform || !normalizedRef) return [];

  const unique = new Map<string, VerifiedRosterCanonicalRow>();
  for (const mapping of mappings) {
    if (mapping.platform.trim().toLowerCase() !== normalizedPlatform) continue;
    if (normalizeContentRef(mapping.platform, mapping.content_ref) !== normalizedRef) continue;

    if (typeof timestampMs === 'number') {
      const start = mapping.candidate_window_start_ms;
      const end = mapping.candidate_window_end_ms;
      if (typeof start === 'number' && typeof end === 'number' && (timestampMs < start || timestampMs > end)) continue;
    }

    const identity = canonicalProductIdentity({
      mapping,
      model: null,
      merchantItemId: mapping.product_id,
      verifiedAt: mapping.trusted_observations?.[0]?.observed_at ?? '2026-01-01T00:00:00.000Z',
    });
    const effectiveMapping: VerifiedProductMapping = {
      ...mapping,
      canonical_key: identity.canonical_key,
      track_id: identity.canonical_key,
    };
    if (!unique.has(identity.canonical_key)) unique.set(identity.canonical_key, { mapping: effectiveMapping, identity });
  }
  return [...unique.values()];
}
