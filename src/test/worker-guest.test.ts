// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';

/**
 * Milestone E: guest issue submission (Turnstile + D1 + moderation).
 *
 * Invariants: feature is OFF without D1/Turnstile (503), honeypot bots are
 * silently dropped, captcha failures fail closed, emails never appear in
 * responses or GitHub issues, approve uses the ADMIN's token, and rate limits
 * are enforced per hashed client address.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const ADMIN_TOKEN = 'ghu_ADMIN_TOKEN_111';

interface FakeRow {
  id: number;
  created_at: string;
  name: string;
  email: string;
  category: string;
  title: string;
  body: string;
  state: string;
  issue_number: number | null;
  ip_hash: string;
}

/** Minimal D1 stand-in covering the statements guest.ts uses. */
class FakeD1 {
  rows: FakeRow[] = [];
  nextId = 1;
  inserts = 0;

  prepare = (sql: string) => {
    let binds: unknown[] = [];
    const builder = {
      sql,
      bind: (...values: unknown[]) => {
        binds = values;
        return builder;
      },
      first: async <T>(): Promise<T | null> => {
        if (/COUNT\(\*\)/.test(sql)) {
          const ipHash = binds[0];
          const recent = this.rows.filter((row) => row.ip_hash === ipHash && row.state !== 'rejected-counted');
          return { n: recent.length } as unknown as T;
        }
        if (/SELECT \* FROM guest_issues WHERE id/.test(sql)) {
          return (this.rows.find((row) => row.id === binds[0]) ?? null) as T | null;
        }
        if (/INSERT INTO guest_issues/.test(sql)) {
          const [name, email, category, title, body, ipHash] = binds as [string, string, string, string, string, string];
          const row: FakeRow = {
            id: this.nextId++,
            created_at: '2026-01-01T00:00:00Z',
            name,
            email,
            category,
            title,
            body,
            state: 'pending',
            issue_number: null,
            ip_hash: ipHash,
          };
          this.rows.push(row);
          this.inserts += 1;
          return { id: row.id, created_at: row.created_at } as unknown as T;
        }
        return null;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        const state = binds[0];
        const results = (state ? this.rows.filter((row) => row.state === state) : this.rows).map((row) => ({ ...row }));
        return { results: results as unknown as T[] };
      },
      run: async () => {
        if (/UPDATE guest_issues SET state = 'rejected'/.test(sql)) {
          const row = this.rows.find((entry) => entry.id === binds[0]);
          if (row) row.state = 'rejected';
        }
        if (/issue_number/.test(sql)) {
          const row = this.rows.find((entry) => entry.id === binds[0]);
          if (row) {
            row.state = 'approved';
            row.issue_number = binds[1] as number;
          }
        }
        return { success: true };
      },
    };
    return builder;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function adminCookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 1, login: 'maintainer', name: null, avatarUrl: '', htmlUrl: '' },
    token: ADMIN_TOKEN,
    iat: now,
    exp: now + 3600,
  };
  return encryptSession(payload, SESSION_KEY);
}

const SUBMISSION = {
  name: 'Ada',
  email: 'ada@example.test',
  category: 'bug',
  title: 'Login button broken',
  body: 'Steps to reproduce…',
  turnstileToken: 'cf-token',
};

describe('guest issues', () => {
  let db: FakeD1;
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

  function env(overrides: Partial<Env> = {}): Env {
    return {
      ASSETS: {} as Fetcher,
      SESSION_ENCRYPTION_KEY: SESSION_KEY,
      DB: db as unknown as D1Database,
      TURNSTILE_SECRET_KEY: 'ts-secret',
      TURNSTILE_SITE_KEY: 'ts-site',
      ...overrides,
    };
  }

  function stubFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) =>
      handler(new URL(String(input), ORIGIN), init)
    );
    vi.stubGlobal('fetch', fetchMock);
  }

  function submitRequest(body: unknown = SUBMISSION, headers: Record<string, string> = {}) {
    return new Request(`${ORIGIN}/api/guest/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    db = new FakeD1();
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is disabled without the D1 binding or Turnstile secret (fail closed)', async () => {
    for (const overrides of [{ DB: undefined }, { TURNSTILE_SECRET_KEY: undefined }]) {
      const response = await handleApiRequest(submitRequest(), env(overrides));
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toBe('GUEST_SUBMISSION_DISABLED');
    }
    expect(db.inserts).toBe(0);
  });

  it('publishes the public config (site key only, no secrets)', async () => {
    const response = await handleApiRequest(new Request(`${ORIGIN}/api/guest/config`), env());
    expect(await response.json()).toEqual({ enabled: true, siteKey: 'ts-site' });
    const text = JSON.stringify(await (await handleApiRequest(new Request(`${ORIGIN}/api/guest/config`), env())).json());
    expect(text).not.toContain('ts-secret');
  });

  it('stores a verified submission and never returns the email', async () => {
    stubFetch((url) => (url.hostname === 'challenges.cloudflare.com' ? json({ success: true }) : json({}, 500)));
    const response = await handleApiRequest(submitRequest(), env());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('ada@example.test');
    expect(JSON.parse(text)).toMatchObject({ status: 'pending' });
    expect(db.inserts).toBe(1);
    expect(db.rows[0].email).toBe('ada@example.test');
  });

  it('silently drops honeypot submissions', async () => {
    stubFetch(() => json({ success: true }));
    const response = await handleApiRequest(submitRequest({ ...SUBMISSION, website: 'http://spam.example' }), env());
    expect(response.status).toBe(200);
    expect(db.inserts).toBe(0);
  });

  it('fails closed when Turnstile rejects the token', async () => {
    stubFetch(() => json({ success: false }));
    const response = await handleApiRequest(submitRequest(), env());
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('CAPTCHA_FAILED');
    expect(db.inserts).toBe(0);
  });

  it('requires the captcha token', async () => {
    stubFetch(() => json({ success: true }));
    const response = await handleApiRequest(submitRequest({ ...SUBMISSION, turnstileToken: '' }), env());
    expect(response.status).toBe(403);
    expect(db.inserts).toBe(0);
  });

  it('validates fields before any upstream work', async () => {
    stubFetch(() => json({ success: true }));
    for (const body of [
      { ...SUBMISSION, email: 'not-an-email' },
      { ...SUBMISSION, category: 'invalid' },
      { ...SUBMISSION, title: '' },
      { ...SUBMISSION, body: '' },
    ]) {
      const response = await handleApiRequest(submitRequest(body), env());
      expect(response.status).toBe(400);
    }
    expect(db.inserts).toBe(0);
  });

  it('rate-limits by hashed client address', async () => {
    stubFetch(() => json({ success: true }));
    for (let i = 0; i < 5; i += 1) {
      const response = await handleApiRequest(submitRequest(), env());
      expect(response.status).toBe(200);
    }
    const limited = await handleApiRequest(submitRequest(), env());
    expect(limited.status).toBe(429);
    expect(db.inserts).toBe(5);
  });

  describe('moderation', () => {
    function moderationRequest(path: string, method: string, cookie: string | null, body: unknown = {}) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`;
      return new Request(`${ORIGIN}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) });
    }

    function stubAdmin(permissions: Record<string, unknown>, onWrite?: (url: URL, init?: RequestInit) => Response) {
      stubFetch((url, init) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions });
        return onWrite ? onWrite(url, init) : json({ number: 42, title: '[guest] Login button broken' });
      });
    }

    it('requires a signed-in repository admin', async () => {
      stubAdmin({ admin: false });
      const cookie = await adminCookie();
      const denied = await handleApiRequest(moderationRequest('/api/admin/moderation', 'GET', cookie), env());
      expect(denied.status).toBe(403);

      const anonymous = await handleApiRequest(moderationRequest('/api/admin/moderation', 'GET', null), env());
      expect(anonymous.status).toBe(403);
    });

    it('lists pending submissions with emails for admins only', async () => {
      db.rows.push({
        id: 1,
        created_at: '2026-01-01T00:00:00Z',
        name: 'Ada',
        email: 'ada@example.test',
        category: 'bug',
        title: 'Broken',
        body: 'info',
        state: 'pending',
        issue_number: null,
        ip_hash: 'aa',
      });
      stubAdmin({ admin: true });
      const cookie = await adminCookie();
      const response = await handleApiRequest(moderationRequest('/api/admin/moderation', 'GET', cookie), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<Record<string, unknown>> };
      expect(body.items[0].email).toBe('ada@example.test');
    });

    it('approves by creating a GitHub issue with the admin token and WITHOUT the email', async () => {
      db.rows.push({
        id: 1,
        created_at: '2026-01-01T00:00:00Z',
        name: 'Ada',
        email: 'ada@example.test',
        category: 'bug',
        title: 'Broken',
        body: 'info',
        state: 'pending',
        issue_number: null,
        ip_hash: 'aa',
      });
      stubAdmin({ admin: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/issues');
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
        const payload = String(init?.body);
        expect(payload).not.toContain('ada@example.test');
        expect(payload).toContain('Submitted by Ada (guest)');
        return json({ number: 42, title: 'x' });
      });
      const cookie = await adminCookie();
      const response = await handleApiRequest(moderationRequest('/api/admin/moderation/1/approve', 'POST', cookie), env());
      expect(response.status).toBe(200);
      expect(db.rows[0].state).toBe('approved');
      expect(db.rows[0].issue_number).toBe(42);
    });

    it('rejects submissions and blocks double review', async () => {
      db.rows.push({
        id: 1,
        created_at: '2026-01-01T00:00:00Z',
        name: 'Ada',
        email: 'ada@example.test',
        category: 'other',
        title: 'No',
        body: 'x',
        state: 'pending',
        issue_number: null,
        ip_hash: 'aa',
      });
      stubAdmin({ admin: true });
      const cookie = await adminCookie();
      const rejected = await handleApiRequest(moderationRequest('/api/admin/moderation/1/reject', 'POST', cookie), env());
      expect(rejected.status).toBe(200);
      expect(db.rows[0].state).toBe('rejected');
      const again = await handleApiRequest(moderationRequest('/api/admin/moderation/1/reject', 'POST', cookie), env());
      expect(again.status).toBe(409);
    });

    it('still approves when email delivery is unavailable', async () => {
      db.rows.push({
        id: 1,
        created_at: '2026-01-01T00:00:00Z',
        name: 'Ada',
        email: 'ada@example.test',
        category: 'bug',
        title: 'Broken',
        body: 'info',
        state: 'pending',
        issue_number: null,
        ip_hash: 'aa',
      });
      stubFetch((url) => {
        if (url.hostname === 'api.resend.com') return Promise.reject(new TypeError('resend down'));
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { admin: true } });
        return json({ number: 42 });
      });
      const cookie = await adminCookie();
      const envWithResend = env({ RESEND_API_KEY: 'rk', MODERATION_NOTIFY_EMAIL: 'team@example.test' });
      const response = await handleApiRequest(moderationRequest('/api/admin/moderation/1/approve', 'POST', cookie), envWithResend);
      expect(response.status).toBe(200);
      expect(db.rows[0].state).toBe('approved');
    });
  });
});
