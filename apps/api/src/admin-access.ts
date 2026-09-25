type DurableObjectStubLike = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export type AdminAccessNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

export type AdminAccessEnv = {
  ADMIN_ACCESS_LEDGER?: AdminAccessNamespaceLike;
};

export type AdminSession = {
  admin_id: string;
  label: string;
  session_token: string;
  expires_at: string;
};

type AdminRecord = {
  admin_id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
};

type SessionRecord = {
  admin_id: string;
  created_at: string;
  expires_at: string;
};

type InviteRecord = {
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

type AuditRecord = {
  admin_id: string;
  action: string;
  at: string;
  detail?: Record<string, string | number | boolean | null>;
};

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function ledgerStub(env: AdminAccessEnv): DurableObjectStubLike | null {
  if (!env.ADMIN_ACCESS_LEDGER) return null;
  return env.ADMIN_ACCESS_LEDGER.get(env.ADMIN_ACCESS_LEDGER.idFromName('admin-access-v1'));
}

async function postJson<T>(env: AdminAccessEnv, path: string, body: unknown): Promise<T | null> {
  const stub = ledgerStub(env);
  if (!stub) return null;
  const response = await stub.fetch(`https://admin-access${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return await response.json() as T;
}

export async function createBootstrapAdmin(env: AdminAccessEnv, label = 'Owner'): Promise<AdminSession | null> {
  return await postJson<AdminSession>(env, '/bootstrap', { label });
}

export async function redeemAdminInvite(env: AdminAccessEnv, code: string, label = 'Admin'): Promise<AdminSession | null> {
  return await postJson<AdminSession>(env, '/redeem', { code, label });
}

export async function authorizeAdminSession(env: AdminAccessEnv, token: string): Promise<{ admin: boolean; admin_id?: string; label?: string }> {
  if (!token) return { admin: false };
  return await postJson<{ admin: boolean; admin_id?: string; label?: string }>(env, '/status', { token }) ?? { admin: false };
}

export async function createAdminInvite(env: AdminAccessEnv, sessionToken: string): Promise<{ code: string; expires_at: string } | null> {
  return await postJson<{ code: string; expires_at: string }>(env, '/invite', { session_token: sessionToken });
}

export async function auditAdminAction(
  env: AdminAccessEnv,
  adminId: string,
  action: string,
  detail?: Record<string, string | number | boolean | null>,
): Promise<void> {
  await postJson(env, '/audit', { admin_id: adminId, action, detail: detail ?? {} });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

export class AdminAccessLedger {
  private readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
  };

  constructor(ctx: { storage: AdminAccessLedger['storage'] }) {
    this.storage = ctx.storage;
  }

  private async admin(adminId: string): Promise<AdminRecord | null> {
    return await this.storage.get<AdminRecord>(`admin:${adminId}`) ?? null;
  }

  private async issueSession(admin: AdminRecord): Promise<AdminSession> {
    const token = randomToken('scoop_admin');
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const hash = await sha256(token);
    const session: SessionRecord = { admin_id: admin.admin_id, created_at: new Date().toISOString(), expires_at: expires };
    await this.storage.put(`session:${hash}`, session);
    return { admin_id: admin.admin_id, label: admin.label, session_token: token, expires_at: expires };
  }

  private async authorize(token: string): Promise<AdminRecord | null> {
    const hash = await sha256(token);
    const session = await this.storage.get<SessionRecord>(`session:${hash}`);
    if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
    const admin = await this.admin(session.admin_id);
    if (!admin || admin.revoked_at) return null;
    return admin;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
    const path = new URL(request.url).pathname;

    if (path === '/bootstrap') {
      const body = await request.json() as Record<string, unknown>;
      const label = bounded(body.label, 80) || 'Owner';
      let ownerId = await this.storage.get<string>('owner-admin-id');
      let admin: AdminRecord | null = ownerId ? await this.admin(ownerId) : null;
      if (!admin || admin.revoked_at) {
        ownerId = `admin_${crypto.randomUUID()}`;
        admin = { admin_id: ownerId, label, created_at: new Date().toISOString(), revoked_at: null };
        await this.storage.put(`admin:${ownerId}`, admin);
        await this.storage.put('owner-admin-id', ownerId);
      }
      return Response.json(await this.issueSession(admin));
    }

    if (path === '/status') {
      const body = await request.json() as Record<string, unknown>;
      const token = bounded(body.token, 300);
      const admin = token ? await this.authorize(token) : null;
      return Response.json(admin ? { admin: true, admin_id: admin.admin_id, label: admin.label } : { admin: false });
    }

    if (path === '/invite') {
      const body = await request.json() as Record<string, unknown>;
      const sessionToken = bounded(body.session_token, 300);
      const admin = sessionToken ? await this.authorize(sessionToken) : null;
      if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const code = randomToken('scoop_admin_invite');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const hash = await sha256(code);
      const invite: InviteRecord = { created_by: admin.admin_id, created_at: new Date().toISOString(), expires_at: expiresAt, used_at: null };
      await this.storage.put(`invite:${hash}`, invite);
      return Response.json({ code, expires_at: expiresAt });
    }

    if (path === '/redeem') {
      const body = await request.json() as Record<string, unknown>;
      const code = bounded(body.code, 300);
      const label = bounded(body.label, 80) || 'Admin';
      if (!code) return Response.json({ error: 'Invalid invite' }, { status: 400 });
      const hash = await sha256(code);
      const invite = await this.storage.get<InviteRecord>(`invite:${hash}`);
      if (!invite || invite.used_at || Date.parse(invite.expires_at) <= Date.now()) {
        return Response.json({ error: 'Invalid or expired invite' }, { status: 403 });
      }
      invite.used_at = new Date().toISOString();
      await this.storage.put(`invite:${hash}`, invite);
      const adminId = `admin_${crypto.randomUUID()}`;
      const admin: AdminRecord = { admin_id: adminId, label, created_at: new Date().toISOString(), revoked_at: null };
      await this.storage.put(`admin:${adminId}`, admin);
      return Response.json(await this.issueSession(admin));
    }

    if (path === '/audit') {
      const body = await request.json() as Record<string, unknown>;
      const adminId = bounded(body.admin_id, 100);
      const action = bounded(body.action, 100);
      if (!adminId || !action) return Response.json({ error: 'Invalid audit record' }, { status: 400 });
      const current = await this.storage.get<AuditRecord[]>('audit') ?? [];
      const detail = body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)
        ? body.detail as Record<string, string | number | boolean | null>
        : {};
      current.unshift({ admin_id: adminId, action, at: new Date().toISOString(), detail });
      await this.storage.put('audit', current.slice(0, 500));
      return Response.json({ accepted: true });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
