import Link from 'next/link';
import { DEV_USERS } from '../lib/dev-users';

export default function Home() {
  return (
    <main className="home">
      <h1>Quillquest</h1>
      <p>Dev sign-in. Open the same table in two windows as two different people.</p>
      <ul>
        {DEV_USERS.map((u) => (
          <li key={u.id}>
            <Link href={`/story/table-1?as=${u.id}`} style={{ color: u.color }}>
              {u.name}
            </Link>{' '}
            <small>({u.role})</small>
          </li>
        ))}
      </ul>
    </main>
  );
}
