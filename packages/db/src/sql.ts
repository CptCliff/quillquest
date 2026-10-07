export interface QueryResult<T> { rows: T[]; rowCount: number }

/** The two methods the data layer needs. `pg` implements it in production, PGlite in tests. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run several statements (migrations). No parameters. */
  exec(text: string): Promise<void>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export class DbError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DbError';
  }
}

/** Postgres unique violation (23505): a concurrent join took the color or the seat. */
export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
export const isForeignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';
