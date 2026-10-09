/**
 * Fail-closed catalog readiness audit for prepared video inventories.
 * This is an evidence audit, not a visual model or a claim of successful import.
 */
export function auditVideoInventory(manifest, evidence = {}) {
  if (!manifest || !Array.isArray(manifest.sections) || !manifest.video?.id) {
    throw new Error('A video manifest with sections is required');
  }
  const issues = [];
  const offers = [];
  const variants = [];
  const seenIds = new Set();
  for (const section of manifest.sections) {
    const anchor = section.reference_offer;
    if (!anchor?.merchant_item_id || !anchor?.url) {
      issues.push({section: section.section, code: 'OFFER_MISSING'});
    } else {
      const key = String(anchor.merchant_item_id);
      if (seenIds.has(key)) issues.push({section: section.section, code: 'DUPLICATE_MERCHANT_ID', key});
      seenIds.add(key);
      const record = evidence[key];
      const imageReady = record?.image_fetched === true
        && record?.variant_match_verified === true
        && record?.storage_permitted === true
        && typeof record?.image_sha256 === 'string'
        && /^[a-f0-9]{64}$/i.test(record.image_sha256);
      const identityReady = record?.canonical_variant_verified === true;
      offers.push({key, url: anchor.url, identity_ready: identityReady, image_ready: imageReady,
        state: !identityReady ? 'IDENTITY_UNVERIFIED' : !imageReady ? 'IMAGE_UNVERIFIED' : 'READY'});
      if (!identityReady) issues.push({section: section.section, code: 'IDENTITY_UNVERIFIED', key});
      if (!imageReady) issues.push({section: section.section, code: 'IMAGE_UNVERIFIED', key});
    }
    for (const variant of section.mentioned_variants ?? []) {
      variants.push({section: section.section, description: variant.description,
        state: variant.on_screen === 'verified' ? 'APPEARANCE_REVIEW_REQUIRED' : 'APPEARANCE_UNKNOWN'});
    }
  }
  const ready = offers.filter(o => o.state === 'READY').length;
  return {
    video_id: manifest.video.id,
    inspected_offers: offers.length,
    ready_offers: ready,
    unready_offers: offers.length - ready,
    variant_mentions: variants.length,
    unverified_appearances: variants.length,
    status: ready === offers.length && issues.length === 0 && variants.length === 0 ? 'READY' : 'NOT_READY',
    offers, variants, issues
  };
}
