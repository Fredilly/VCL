export type AffiliateComplianceStatus =
  | 'COMPLIANT_ENABLED'
  | 'PLAIN_LINK_ONLY'
  | 'DISABLED_IN_EXTENSION';

const KNOWN_STATUSES = new Set<AffiliateComplianceStatus>([
  'COMPLIANT_ENABLED',
  'PLAIN_LINK_ONLY',
  'DISABLED_IN_EXTENSION',
]);

export function normalizeAffiliateComplianceStatus(value: unknown): AffiliateComplianceStatus {
  if (typeof value !== 'string') return 'DISABLED_IN_EXTENSION';
  const normalized = value.trim().toUpperCase() as AffiliateComplianceStatus;
  return KNOWN_STATUSES.has(normalized) ? normalized : 'DISABLED_IN_EXTENSION';
}

export function shouldRequestAffiliateTreatment(status: unknown): boolean {
  return normalizeAffiliateComplianceStatus(status) === 'COMPLIANT_ENABLED';
}

export function resolveChromeMerchantDestination(input: {
  plain_url?: string | null;
  affiliate_url?: string | null;
  status?: unknown;
}): string | null {
  const status = normalizeAffiliateComplianceStatus(input.status);
  if (status === 'COMPLIANT_ENABLED' && input.affiliate_url) return input.affiliate_url;
  return input.plain_url ?? null;
}
