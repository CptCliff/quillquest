import { MIGRATIONS } from './migrations';
import type { Sql } from './sql';

/** Applies any migration not yet recorded. Safe to run on every start. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await sql.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await sql.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [m.name]);
    });
    ran.push(m.name);
  }
  return ran;
}
