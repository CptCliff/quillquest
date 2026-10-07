import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createDb, migrate, type Db, type Sql } from '../src';
import { pgSql } from '../src/pg';
import { pgliteSql } from '../src/pglite';

/** The little of PGlite's API the tests poke at directly. */
export interface Raw {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(text: string): Promise<unknown>;
}
export interface Harness { pg: Raw; sql: Sql; db: Db; clock: { now: Date }; close(): Promise<void> }

/**
 * A real Postgres with every migration applied: PGlite in process by default, or a real server when TEST_DATABASE_URL is
 * set (a fresh database is created for the run). The same suite runs against both.
 */
export async function freshDb(): Promise<Harness> {
  const clock = { now: new Date('2026-10-07T12:00:00Z') };
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const lite = new PGlite();
    const sql = pgliteSql(lite);
    await migrate(sql);
    return { pg: lite as unknown as Raw, sql, db: createDb(sql, { now: () => clock.now }), clock, close: () => lite.close() };
  }
  const name = `qq_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`create database ${name}`);
  const dbUrl = url.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
  const pool = new pg.Pool({ connectionString: dbUrl });
  const sql = pgSql(pool);
  await migrate(sql);
  // The raw runner is ONE dedicated connection. A Pool throws away a connection after an error, which would silently drop
  // a `set role` and run the next statement as the superuser; a test of row security must not be fooled by that.
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const raw: Raw = {
    query: async (text, params) => { const r = await client.query(text, params as unknown[]); return { rows: r.rows as never, affectedRows: r.rowCount ?? undefined }; },
    exec: async (text) => { await client.query(text); },
  };
  return {
    pg: raw, sql, db: createDb(sql, { now: () => clock.now }), clock,
    close: async () => { await client.end(); await pool.end(); await admin.query(`drop database ${name} with (force)`); await admin.end(); },
  };
}

export async function withUsers(h: Harness, ...ids: string[]) {
  for (const id of ids) await h.db.upsertProfile(id, { displayName: id[0]!.toUpperCase() + id.slice(1) });
}
