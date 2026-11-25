/**
 * One budget for every outbound request a single `/resolve-products` call makes.
 *
 * Workers Free allows 50 subrequests per invocation. Before this existed, four
 * different call sites each minted their own budget (image fetch, page metadata,
 * image recovery, commerce), so the roster size bounded nothing: 24 variants
 * behind dead URLs could quietly cost 52+ requests and the click came back as a
 * verifier failure instead of a budget one.
 *
 * Scope: third-party requests only (page metadata, images, redirect hops, model
 * calls, marketplace searches). Durable Object and KV traffic inside the account
 * is not counted here.
 */

export type SubrequestKind = 'page' | 'image' | 'redirect' | 'model' | 'commerce';

export type SubrequestSpend = Record<SubrequestKind, number>;

export type SubrequestLedger = {
  readonly limit: number;
  readonly spent: SubrequestSpend;
  total(): number;
  remaining(): number;
  reserve(kind: SubrequestKind, count?: number): boolean;
  exhausted(): boolean;
  snapshot(): { limit: number; total: number; remaining: number; spent: SubrequestSpend; exhausted: boolean };
};

const KINDS: SubrequestKind[] = ['page', 'image', 'redirect', 'model', 'commerce'];

/** A 34-row partner roster needs one image fetch per row, plus model batches,
 * page metadata and the commerce fan-out. Measured on a real Bagholic click, the old
 * 44 refused 68 requests and left most rows uncompared. 60 is the paid-plan headroom;
 * the platform still enforces its own hard ceiling below this. */
export const DEFAULT_SUBREQUEST_LIMIT = 60;

export function createSubrequestLedger(limit = DEFAULT_SUBREQUEST_LIMIT): SubrequestLedger {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_SUBREQUEST_LIMIT;
  const spent = Object.fromEntries(KINDS.map(kind => [kind, 0])) as SubrequestSpend;
  const used = () => KINDS.reduce((sum, kind) => sum + spent[kind], 0);

  return {
    limit: cap,
    spent,
    total: used,
    remaining: () => Math.max(0, cap - used()),
    exhausted: () => used() >= cap,
    reserve(kind, count = 1) {
      const amount = Math.max(1, Math.trunc(count));
      if (used() + amount > cap) return false;
      spent[kind] += amount;
      return true;
    },
    snapshot: () => ({ limit: cap, total: used(), remaining: Math.max(0, cap - used()), spent: { ...spent }, exhausted: used() >= cap }),
  };
}

/**
 * Wrap `fetch` so every call is charged to the ledger before it leaves the
 * Worker. When the budget is gone the call is refused rather than made: callers
 * already treat a rejected fetch as a fail-closed failure, so the click abstains
 * instead of exceeding the platform quota.
 */
export function ledgerFetch(ledger: SubrequestLedger, kind: SubrequestKind, base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!ledger.reserve(kind)) throw new Error(`subrequest_budget:${kind}`);
    return base(input, init);
  }) as typeof fetch;
}
