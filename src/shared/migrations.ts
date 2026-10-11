/**
 * Versioned D1 migration registry (V3-E).
 *
 * The SQL itself lives in `migrations/*.sql` and is applied with
 * `npx wrangler d1 migrations apply`. This module is the machine-readable index
 * so the application (and the tests) can assert which schema version a
 * deployment expects without opening the files.
 *
 * Migrations are append-only: never edit an applied file, add the next one.
 */

export interface MigrationMeta {
  /** Zero-padded file prefix, e.g. "0001". */
  id: string;
  /** File name inside `migrations/`. */
  file: string;
  /** Human-readable summary. */
  name: string;
  /** Tables this migration creates. Used by the schema tests. */
  tables: readonly string[];
}

export const MIGRATIONS: readonly MigrationMeta[] = [
  {
    id: '0001',
    file: '0001_guest_issues.sql',
    name: 'Guest issue submissions and moderation queue',
    tables: ['guest_issues'],
  },
  {
    id: '0002',
    file: '0002_forge_v3.sql',
    name: 'Forge administration: admins, featured repositories, banners, announcements, advertisements, audit log',
    tables: ['forge_admins', 'featured_repos', 'banners', 'announcements', 'advertisements', 'audit_log'],
  },
];

/** Latest schema version. Compare with the deployment's applied migrations. */
export const LATEST_MIGRATION_ID = MIGRATIONS[MIGRATIONS.length - 1]?.id ?? '0000';

/**
 * Split a SQL script into statements for a lightweight executor.
 *
 * Only used by tests and tooling (D1 applies the files itself). It strips
 * `--` line comments and splits on top-level semicolons, so semicolons inside
 * string literals do not break the split.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    const next = script[index + 1];

    if (!inString && char === '-' && next === '-') {
      const end = script.indexOf('\n', index);
      index = end === -1 ? script.length : end;
      continue;
    }
    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }
    if (!inString && char === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}
