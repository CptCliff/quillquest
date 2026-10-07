import pg from 'pg';
import { migrate } from './migrate';
import { pgSql } from './pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the Postgres connection string (the privileged role, not the anon key).');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
const ran = await migrate(pgSql(pool));
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Up to date.');
await pool.end();
