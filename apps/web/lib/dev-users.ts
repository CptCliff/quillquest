import type { Identity } from '@quillquest/sync/auth';

/** Dev-only identities. Ilse, Sella and Rook have ready-made sheets; Mira, Tobin and Wren start with a blank character in creation. Colors are the writers' ink. */
export const DEV_USERS: Identity[] = [
  { id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' },
  { id: 'sella', name: 'Sella', role: 'player', color: '#1d4ed8' },
  { id: 'rook', name: 'Rook', role: 'player', color: '#7e22ce' },
  { id: 'mira', name: 'Mira', role: 'player', color: '#0e7490' },
  { id: 'tobin', name: 'Tobin', role: 'player', color: '#be123c' },
  { id: 'wren', name: 'Wren', role: 'player', color: '#4d7c0f' },
  { id: 'gm1', name: 'GM', role: 'gm', color: '#15803d' },
];

const FALLBACK = ['#b45309', '#0e7490', '#be123c', '#4d7c0f'];
/** Ink for an author who is not connected right now. */
export function inkFor(userId: string): string {
  const known = DEV_USERS.find((u) => u.id === userId);
  if (known) return known.color;
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}
export const nameFor = (userId: string): string => DEV_USERS.find((u) => u.id === userId)?.name ?? userId;
