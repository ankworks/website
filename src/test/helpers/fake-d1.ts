/**
 * Minimal in-memory D1 stand-in for Worker tests.
 *
 * It implements only the surface the Forge V3 code uses (`prepare`, `bind`,
 * `first`, `all`, `run`, `batch`) and only the SQL shapes that appear in
 * `migrations/`. Queries are matched against a small set of statement
 * patterns rather than parsed — the goal is to exercise the CALLER (validation,
 * authorization, sanitization), not to be a database engine.
 *
 * Anything the mock does not recognise throws, so a new query shape fails loudly
 * in tests instead of silently returning empty results.
 */

type Row = Record<string, unknown>;
type Value = string | number | null;

interface BoundStatement {
  sql: string;
  params: Value[];
}

class FakePreparedStatement {
  constructor(private readonly db: FakeD1, readonly statement: BoundStatement) {}

  bind(...params: Value[]): FakePreparedStatement {
    return new FakePreparedStatement(this.db, { ...this.statement, params });
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const rows = this.db.execute(this.statement);
    const row = rows[0];
    if (!row) return null;
    if (column) return (row[column] ?? null) as T;
    return { ...row } as T;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.db.execute(this.statement).map((row) => ({ ...row }) as T), success: true };
  }

  async run(): Promise<{ success: boolean; changes: number }> {
    const changes = this.db.execute(this.statement);
    return { success: true, changes: changes.length };
  }
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

export class FakeD1 {
  readonly tables: Record<string, Row[]> = {};
  /** Every statement the mock executed, in order. Useful for assertions. */
  readonly executed: BoundStatement[] = [];

  constructor(tables: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(tables)) {
      this.tables[name] = rows.map((row) => ({ ...row }));
    }
  }

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(this, { sql, params: [] });
  }

  async batch(statements: FakePreparedStatement[]): Promise<Array<{ results: Row[]; success: boolean }>> {
    return statements.map((statement) => {
      const rows = this.execute(statement.statement);
      return { results: rows, success: true };
    });
  }

  /** Exposed for tests: run a statement synchronously. */
  execute(statement: BoundStatement): Row[] {
    const sql = normalize(statement.sql);
    const params = statement.params;
    this.executed.push({ sql, params });

    const table = (name: string): Row[] => {
      if (!this.tables[name]) this.tables[name] = [];
      return this.tables[name] as Row[];
    };

    // featured_repos -------------------------------------------------------
    if (/^SELECT repo, position FROM featured_repos/.test(sql)) {
      return [...table('featured_repos')].sort(
        (a, b) => Number(a.position) - Number(b.position) || String(a.repo).localeCompare(String(b.repo))
      );
    }
    if (/^SELECT COUNT\(\*\) AS n FROM featured_repos/.test(sql)) {
      return [{ n: table('featured_repos').length }];
    }
    if (/^SELECT 1 AS ok FROM featured_repos WHERE repo = \?1/.test(sql)) {
      const hit = table('featured_repos').find((row) => row.repo === params[0]);
      return hit ? [{ ok: 1 }] : [];
    }
    if (/^INSERT INTO featured_repos .*ON CONFLICT\(repo\) DO UPDATE SET position = excluded\.position/.test(sql)) {
      const [repo, position, addedBy] = params;
      const existing = table('featured_repos').find((row) => row.repo === repo);
      if (existing) {
        existing.position = position;
      } else {
        table('featured_repos').push({
          repo,
          position,
          added_at: '2026-01-01 00:00:00',
          added_by: addedBy,
        });
      }
      return [{ repo, position }];
    }
    if (/^UPDATE featured_repos SET position = \?2 WHERE repo = \?1/.test(sql)) {
      const row = table('featured_repos').find((entry) => entry.repo === params[0]);
      if (row) row.position = params[1];
      return row ? [{ ...row }] : [];
    }
    if (/^DELETE FROM featured_repos WHERE repo = \?1/.test(sql)) {
      const rows = table('featured_repos');
      const index = rows.findIndex((row) => row.repo === params[0]);
      if (index >= 0) return rows.splice(index, 1);
      return [];
    }

    // forge_admins ---------------------------------------------------------
    if (/^SELECT 1 AS ok FROM forge_admins WHERE github_id = \?1 OR login = \?2 LIMIT 1/.test(sql)) {
      const hit = table('forge_admins').find((row) => row.github_id === params[0] || row.login === params[1]);
      return hit ? [{ ok: 1 }] : [];
    }

    // audit_log ------------------------------------------------------------
    if (/^INSERT INTO audit_log/.test(sql)) {
      const row = {
        id: table('audit_log').length + 1,
        actor_id: params[0],
        actor_login: params[1],
        action: params[2],
        target: params[3],
        result: params[4],
        detail: params[5],
        created_at: '2026-01-01 00:00:00',
      };
      table('audit_log').push(row);
      return [row];
    }
    if (/^SELECT \* FROM audit_log/.test(sql)) {
      const limit = typeof params[0] === 'number' ? params[0] : 100;
      return table('audit_log').slice(-limit).reverse();
    }

    // banners / announcements / advertisements ------------------------------
    for (const name of ['banners', 'announcements', 'advertisements'] as const) {
      if (new RegExp(`^SELECT \\* FROM ${name} ORDER BY`).test(sql)) {
        return [...table(name)].reverse();
      }
      if (new RegExp(`^SELECT \\* FROM ${name} WHERE id = \\?1$`).test(sql)) {
        return table(name).filter((row) => row.id === params[0]);
      }
      if (new RegExp(`^INSERT INTO ${name}`).test(sql)) {
        const row = { id: table(name).length + 1, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' };
        table(name).push(row);
        return [row];
      }
      if (new RegExp(`^UPDATE ${name} SET`).test(sql)) {
        const row = table(name).find((entry) => entry.id === params[params.length - 1]);
        return row ? [{ ...row }] : [];
      }
      if (new RegExp(`^DELETE FROM ${name} WHERE id = \\?1$`).test(sql)) {
        const rows = table(name);
        const index = rows.findIndex((row) => row.id === params[0]);
        if (index >= 0) return rows.splice(index, 1);
        return [];
      }
    }

    throw new Error(`FakeD1: unsupported statement → ${sql}`);
  }
}

/** Cast helper: the Worker code expects the Cloudflare D1Database type. */
export function asD1(value: FakeD1): D1Database {
  return value as unknown as D1Database;
}
