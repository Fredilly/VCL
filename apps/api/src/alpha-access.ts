type DurableObjectStubLike = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

export type AlphaAccessEnv = {
  ALPHA_INVITE_REQUIRED?: string;
  ALPHA_INVITE_SECRET?: string;
  ALPHA_ATTRIBUTION_SECRET?: string;
  ALPHA_ACCESS_LEDGER?: DurableObjectNamespaceLike;
};

type InvitePayload = {
  invite_id: string;
  expires_at: number;
  max_installs: number;
};

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return b64url(new Uint8Array(sig));
}

function inviteSecret(env: AlphaAccessEnv): string | null {
  return env.ALPHA_INVITE_SECRET || env.ALPHA_ATTRIBUTION_SECRET || null;
}

export function alphaInviteRequired(env: AlphaAccessEnv): boolean {
  return env.ALPHA_INVITE_REQUIRED === 'true';
}

export async function createAlphaInvite(
  env: AlphaAccessEnv,
  inviteId: string,
  ttlDays = 7,
  maxInstalls = 2,
): Promise<{ token: string; expires_at: number; max_installs: number }> {
  const secret = inviteSecret(env);
  if (!secret) throw new Error('Alpha invite signing is not configured');
  const cleanId = inviteId.trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  if (!cleanId) throw new Error('Invalid invite id');
  const expires_at = Math.floor(Date.now() / 1000) + Math.max(1, Math.min(30, ttlDays)) * 86400;
  const safeMax = Math.max(1, Math.min(3, maxInstalls));
  const payload: InvitePayload = { invite_id: cleanId, expires_at, max_installs: safeMax };
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(secret, encoded);
  return { token: `v1.${encoded}.${signature}`, expires_at, max_installs: safeMax };
}

export async function verifyAlphaInvite(env: AlphaAccessEnv, token: string): Promise<InvitePayload | null> {
  const secret = inviteSecret(env);
  if (!secret || !token.startsWith('v1.')) return null;
  const [, encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = await hmac(secret, encoded);
  const a = new TextEncoder().encode(signature);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(encoded))) as InvitePayload;
    if (!payload.invite_id || !Number.isFinite(payload.expires_at) || !Number.isFinite(payload.max_installs)) return null;
    if (payload.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function ledger(env: AlphaAccessEnv): DurableObjectStubLike | null {
  if (!env.ALPHA_ACCESS_LEDGER) return null;
  return env.ALPHA_ACCESS_LEDGER.get(env.ALPHA_ACCESS_LEDGER.idFromName('alpha-access-v1'));
}

async function ledgerPost<T>(env: AlphaAccessEnv, path: string, body: unknown): Promise<T | null> {
  const stub = ledger(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://alpha-access${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return await response.json() as T;
}

export async function activateAlphaInvite(
  env: AlphaAccessEnv,
  token: string,
  installId: string,
): Promise<{ accepted: boolean; invite_id?: string; expires_at?: number }> {
  const payload = await verifyAlphaInvite(env, token);
  if (!payload || !/^[a-f0-9-]{36}$/i.test(installId)) return { accepted: false };
  if (!env.ALPHA_ACCESS_LEDGER) return { accepted: true, invite_id: payload.invite_id, expires_at: payload.expires_at };
  const result = await ledgerPost<{ accepted: boolean }>(env, '/activate', {
    invite_id: payload.invite_id,
    install_id: installId,
    expires_at: payload.expires_at,
    max_installs: payload.max_installs,
  });
  return result?.accepted ? { accepted: true, invite_id: payload.invite_id, expires_at: payload.expires_at } : { accepted: false };
}

export async function authorizeAlphaRequest(env: AlphaAccessEnv, request: Request): Promise<boolean> {
  if (!alphaInviteRequired(env)) return true;
  const token = request.headers.get('x-scoop-alpha-token') ?? '';
  const installId = request.headers.get('x-scoop-install-id') ?? '';
  const payload = await verifyAlphaInvite(env, token);
  if (!payload || !/^[a-f0-9-]{36}$/i.test(installId)) return false;
  if (!env.ALPHA_ACCESS_LEDGER) return true;
  const result = await ledgerPost<{ authorized: boolean }>(env, '/authorize', {
    invite_id: payload.invite_id,
    install_id: installId,
    expires_at: payload.expires_at,
  });
  return Boolean(result?.authorized);
}

export class AlphaAccessLedger {
  private readonly sql: { exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>> & { toArray?: () => Record<string, unknown>[] } };

  constructor(ctx: { storage: { sql: AlphaAccessLedger['sql'] } }) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS alpha_install (
        invite_id TEXT NOT NULL,
        install_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (invite_id, install_id)
      );
      CREATE INDEX IF NOT EXISTS idx_alpha_invite ON alpha_install(invite_id);
    `);
  }

  private rows(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    const cursor = this.sql.exec(query, ...bindings);
    return typeof cursor.toArray === 'function' ? cursor.toArray() : Array.from(cursor);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
    const path = new URL(request.url).pathname;
    const body = await request.json() as Record<string, unknown>;
    const inviteId = typeof body.invite_id === 'string' ? body.invite_id.slice(0, 80) : '';
    const installId = typeof body.install_id === 'string' ? body.install_id : '';
    const expiresAt = Number(body.expires_at);
    if (!inviteId || !/^[a-f0-9-]{36}$/i.test(installId) || !Number.isFinite(expiresAt)) {
      return Response.json({ accepted: false, authorized: false }, { status: 400 });
    }
    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      return Response.json({ accepted: false, authorized: false });
    }

    if (path === '/activate') {
      const maxInstalls = Math.max(1, Math.min(3, Number(body.max_installs) || 1));
      const existing = this.rows('SELECT 1 AS present FROM alpha_install WHERE invite_id = ? AND install_id = ? LIMIT 1', inviteId, installId);
      if (existing.length) return Response.json({ accepted: true });
      const count = this.rows('SELECT COUNT(*) AS count FROM alpha_install WHERE invite_id = ?', inviteId)[0];
      if (Number(count?.count ?? 0) >= maxInstalls) return Response.json({ accepted: false });
      this.sql.exec(
        'INSERT INTO alpha_install (invite_id, install_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
        inviteId, installId, expiresAt, new Date().toISOString(),
      );
      return Response.json({ accepted: true });
    }

    if (path === '/authorize') {
      const found = this.rows(
        'SELECT expires_at FROM alpha_install WHERE invite_id = ? AND install_id = ? LIMIT 1',
        inviteId, installId,
      )[0];
      return Response.json({ authorized: Boolean(found && Number(found.expires_at) > Math.floor(Date.now() / 1000)) });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
