import type { Pool, PoolClient } from 'pg';
import type { QueryResult, Sql } from './sql';

const wrap = (q: Pick<Pool | PoolClient, 'query'>, tx: (fn: (t: Sql) => Promise<unknown>) => Promise<unknown>): Sql => ({
  async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const r = await q.query(text, params as unknown[]);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
  },
  async exec(text) { await q.query(text); },
  transaction: (fn) => tx(fn as never) as never,
});

/** Production adapter over a `pg` Pool. */
export function pgSql(pool: Pool): Sql {
  return wrap(pool, async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const inner: Sql = wrap(client, () => { throw new Error('nested transactions are not supported'); });
      const out = await fn(inner);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });
}
