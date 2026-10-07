import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { QueryResult, Sql } from './sql';

type Runner = Pick<PGlite, 'query' | 'exec'> | Pick<Transaction, 'query' | 'exec'>;

function adapt(db: Runner, transaction: Sql['transaction']): Sql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const r = await db.query<T>(text, params as unknown[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(text) { await db.exec(text); },
    transaction,
  };
}

/** Test adapter: a real Postgres running in process. Never imported by the server. */
export function pgliteSql(pg: PGlite): Sql {
  return adapt(pg, (fn) => pg.transaction((tx) => fn(adapt(tx, () => { throw new Error('nested transactions are not supported'); }))));
}
