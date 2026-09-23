import type { ProductCandidate } from './commerce.js';
import type { ObjectDescription } from './types.js';
import { normalizeUserFeedback, type UserFeedback } from './feedback.js';

type DurableObjectStubLike = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

export type FeedbackLedgerEnv = {
  FEEDBACK_LEDGER?: DurableObjectNamespaceLike;
};

export type FeedbackResultContext = {
  event_id: string;
  session_id: string | null;
  result_id: string;
  candidate_key: string;
  provider: string;
  provenance: string;
  result_class: string;
  evidence_key: string;
  query: string;
  category: string;
  subcategory: string;
  brand: string | null;
  model: string | null;
  vision_model: string | null;
  ranking_policy: string;
  created_at: string;
};

export type FeedbackPenalty = {
  candidate_key: string;
  wrong_count: number;
  correct_count: number;
};

const WRONG_TYPES = new Set(['wrong_item', 'wrong_category', 'not_similar']);
const CORRECT_TYPES = new Set(['correct_match', 'useful']);
export const FEEDBACK_RANKING_POLICY = 'alpha-feedback-v1';

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stableHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    h1 ^= value.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= value.charCodeAt(value.length - i - 1);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function evidenceFingerprint(description: ObjectDescription): string {
  const payload = [
    description.category,
    description.subcategory,
    description.brand_candidate ?? '',
    description.model_candidate ?? '',
    description.color,
    description.material,
    ...(description.visible_text ?? []).slice(0, 4),
    ...(description.logos_markings ?? []).slice(0, 4),
    ...(description.distinctive_features ?? []).slice(0, 6),
  ].map((v) => bounded(v, 100).toLowerCase()).join('|');
  return stableHash(payload);
}

export function feedbackCandidateKey(product: ProductCandidate): string {
  const provider = bounded(product.provider || product.provenance || 'unknown', 60).toLowerCase();
  const id = bounded(product.id, 180);
  return stableHash(`${provider}|${id}`);
}

function ledgerStub(env: FeedbackLedgerEnv): DurableObjectStubLike | null {
  if (!env.FEEDBACK_LEDGER) return null;
  return env.FEEDBACK_LEDGER.get(env.FEEDBACK_LEDGER.idFromName('alpha-feedback-v1'));
}

async function postJson<T>(env: FeedbackLedgerEnv, path: string, body: unknown): Promise<T | null> {
  const stub = ledgerStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://feedback-ledger${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`feedback ledger ${path} failed: ${response.status}`);
  return await response.json() as T;
}

export async function persistFeedbackContext(env: FeedbackLedgerEnv, context: FeedbackResultContext): Promise<void> {
  await postJson(env, '/context', context);
}

export async function persistFeedback(env: FeedbackLedgerEnv, value: unknown): Promise<UserFeedback> {
  const feedback = normalizeUserFeedback(value);
  const result = await postJson<{ feedback?: UserFeedback }>(env, '/feedback', feedback);
  return result?.feedback ?? feedback;
}

export async function feedbackPenalties(
  env: FeedbackLedgerEnv,
  evidence_key: string,
  products: ProductCandidate[],
): Promise<Map<string, FeedbackPenalty>> {
  if (!env.FEEDBACK_LEDGER || !products.length) return new Map();
  const candidate_keys = [...new Set(products.map(feedbackCandidateKey))];
  const result = await postJson<{ penalties: FeedbackPenalty[] }>(env, '/penalties', { evidence_key, candidate_keys });
  return new Map((result?.penalties ?? []).map((penalty) => [penalty.candidate_key, penalty]));
}

export function applyFeedbackPenalties(
  products: ProductCandidate[],
  penalties: Map<string, FeedbackPenalty>,
): { products: ProductCandidate[]; penalized: number; suppressed: number } {
  let penalized = 0;
  let suppressed = 0;
  const adjusted: ProductCandidate[] = [];
  for (const product of products) {
    const penalty = penalties.get(feedbackCandidateKey(product));
    const netWrong = Math.max(0, (penalty?.wrong_count ?? 0) - (penalty?.correct_count ?? 0));
    if (netWrong >= 2) {
      suppressed++;
      continue;
    }
    if (netWrong === 1) {
      penalized++;
      adjusted.push({
        ...product,
        verification_score: Math.max(0, (product.verification_score ?? 0) - 20),
        verification_reasons: [...(product.verification_reasons ?? []), 'prior comparable user correction'],
      });
      continue;
    }
    adjusted.push(product);
  }
  adjusted.sort((a, b) => (b.verification_score ?? 0) - (a.verification_score ?? 0)
    || (a.identity_key ?? a.id).localeCompare(b.identity_key ?? b.id)
    || a.id.localeCompare(b.id));
  return { products: adjusted, penalized, suppressed };
}

export class FeedbackLedger {
  private readonly sql: { exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>> & { toArray?: () => Record<string, unknown>[] } };

  constructor(ctx: { storage: { sql: FeedbackLedger['sql'] } }) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS result_context (
        event_id TEXT NOT NULL,
        session_id TEXT,
        result_id TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        provenance TEXT NOT NULL,
        result_class TEXT NOT NULL,
        evidence_key TEXT NOT NULL,
        query_text TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT NOT NULL,
        brand TEXT,
        model TEXT,
        vision_model TEXT,
        ranking_policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (event_id, result_id)
      );
      CREATE TABLE IF NOT EXISTS feedback (
        event_id TEXT NOT NULL,
        result_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, result_id, feedback_type)
      );
      CREATE TABLE IF NOT EXISTS mapping_signal (
        evidence_key TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (evidence_key, candidate_key)
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback(event_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(feedback_type);
      CREATE INDEX IF NOT EXISTS idx_context_session ON result_context(session_id);
    `);
  }

  private rows(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    const cursor = this.sql.exec(query, ...bindings);
    return typeof cursor.toArray === 'function' ? cursor.toArray() : Array.from(cursor);
  }

  private applyUnapplied(eventId: string, resultId: string) {
    const context = this.rows(
      'SELECT evidence_key, candidate_key FROM result_context WHERE event_id = ? AND result_id = ? LIMIT 1',
      eventId, resultId,
    )[0];
    if (!context) return;
    const feedbackRows = this.rows(
      'SELECT feedback_type FROM feedback WHERE event_id = ? AND result_id = ? AND applied = 0',
      eventId, resultId,
    );
    for (const row of feedbackRows) {
      const type = String(row.feedback_type ?? '');
      const wrong = WRONG_TYPES.has(type) ? 1 : 0;
      const correct = CORRECT_TYPES.has(type) ? 1 : 0;
      this.sql.exec(
        `INSERT INTO mapping_signal (evidence_key, candidate_key, wrong_count, correct_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(evidence_key, candidate_key) DO UPDATE SET
           wrong_count = wrong_count + excluded.wrong_count,
           correct_count = correct_count + excluded.correct_count,
           updated_at = excluded.updated_at`,
        context.evidence_key, context.candidate_key, wrong, correct, new Date().toISOString(),
      );
      this.sql.exec(
        'UPDATE feedback SET applied = 1 WHERE event_id = ? AND result_id = ? AND feedback_type = ?',
        eventId, resultId, type,
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });

    if (path === '/context') {
      const value = await request.json() as FeedbackResultContext;
      this.sql.exec(
        `INSERT OR IGNORE INTO result_context (
          event_id, session_id, result_id, candidate_key, provider, provenance, result_class,
          evidence_key, query_text, category, subcategory, brand, model, vision_model, ranking_policy, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bounded(value.event_id, 160), value.session_id ? bounded(value.session_id, 160) : null,
        bounded(value.result_id, 180), bounded(value.candidate_key, 80), bounded(value.provider, 80),
        bounded(value.provenance, 80), bounded(value.result_class, 20), bounded(value.evidence_key, 80),
        bounded(value.query, 300), bounded(value.category, 80), bounded(value.subcategory, 80),
        value.brand ? bounded(value.brand, 100) : null, value.model ? bounded(value.model, 120) : null,
        value.vision_model ? bounded(value.vision_model, 120) : null, bounded(value.ranking_policy, 80),
        bounded(value.created_at, 40),
      );
      this.applyUnapplied(value.event_id, value.result_id);
      return Response.json({ accepted: true });
    }

    if (path === '/feedback') {
      const feedback = normalizeUserFeedback(await request.json());
      const exists = this.rows(
        'SELECT 1 AS present FROM feedback WHERE event_id = ? AND result_id = ? AND feedback_type = ? LIMIT 1',
        feedback.event_id, feedback.result_id, feedback.feedback_type,
      ).length > 0;
      if (!exists) {
        this.sql.exec(
          'INSERT INTO feedback (event_id, result_id, feedback_type, created_at, applied) VALUES (?, ?, ?, ?, 0)',
          feedback.event_id, feedback.result_id, feedback.feedback_type, feedback.created_at,
        );
        this.applyUnapplied(feedback.event_id, feedback.result_id);
      }
      return Response.json({ accepted: true, duplicate: exists, feedback });
    }

    if (path === '/penalties') {
      const body = await request.json() as { evidence_key?: unknown; candidate_keys?: unknown };
      const evidenceKey = bounded(body.evidence_key, 80);
      const keys = Array.isArray(body.candidate_keys) ? body.candidate_keys.map((v) => bounded(v, 80)).filter(Boolean).slice(0, 12) : [];
      const penalties: FeedbackPenalty[] = [];
      for (const key of keys) {
        const row = this.rows(
          'SELECT wrong_count, correct_count FROM mapping_signal WHERE evidence_key = ? AND candidate_key = ? LIMIT 1',
          evidenceKey, key,
        )[0];
        if (row) penalties.push({
          candidate_key: key,
          wrong_count: Number(row.wrong_count ?? 0),
          correct_count: Number(row.correct_count ?? 0),
        });
      }
      return Response.json({ penalties });
    }

    if (path === '/report') {
      const totals = this.rows(`
        SELECT
          COUNT(*) AS feedback_count,
          SUM(CASE WHEN feedback_type IN ('wrong_item','wrong_category','not_similar') THEN 1 ELSE 0 END) AS wrong_count,
          SUM(CASE WHEN feedback_type IN ('correct_match','useful') THEN 1 ELSE 0 END) AS correct_count
        FROM feedback
      `)[0] ?? {};
      const repeated = this.rows(`
        SELECT evidence_key, candidate_key, wrong_count, correct_count
        FROM mapping_signal
        WHERE wrong_count >= 2
        ORDER BY wrong_count DESC
        LIMIT 25
      `);
      const providerPatterns = this.rows(`
        SELECT c.provider, c.query_text, COUNT(*) AS corrections
        FROM feedback f
        JOIN result_context c ON c.event_id = f.event_id AND c.result_id = f.result_id
        WHERE f.feedback_type IN ('wrong_item','wrong_category','not_similar')
        GROUP BY c.provider, c.query_text
        ORDER BY corrections DESC
        LIMIT 25
      `);
      return Response.json({ totals, repeated_bad_candidates: repeated, provider_query_patterns: providerPatterns });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
