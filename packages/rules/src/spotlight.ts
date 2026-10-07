// The spotlight (design plan 5.1, 10; Rules v4 turn order): whose post is next. Pure; the server keeps the state and sends the notices.
import { RuleViolation } from './errors';

const no = (code: string, message: string): never => { throw new RuleViolation(code, message); };

export interface Spotlight {
  /** Player user ids, in the order they joined. The GM is never in this list; they may hold the spotlight without being on it. */
  players: string[];
  holder: string | null;
  /** Passes since each player last held the spotlight. */
  leftOut: Record<string, number>;
}
export const newSpotlight = (): Spotlight => ({ players: [], holder: null, leftOut: {} });

export function joinSpotlight(s: Spotlight, userId: string): Spotlight {
  if (s.players.includes(userId)) return s;
  return { players: [...s.players, userId], holder: s.holder ?? userId, leftOut: { ...s.leftOut, [userId]: 0 } };
}

export function leaveSpotlight(s: Spotlight, userId: string): Spotlight {
  const at = s.players.indexOf(userId);
  if (at < 0) return s;
  const players = s.players.filter((p) => p !== userId);
  const { [userId]: _gone, ...leftOut } = s.leftOut;
  const holder = s.holder === userId ? (players[at % Math.max(players.length, 1)] ?? null) : s.holder;
  return { players, holder, leftOut };
}

/** Two rounds without the spotlight is two passes for each player at the table. */
export function forcedNext(s: Spotlight): string | null {
  const limit = 2 * s.players.length;
  const due = s.players.filter((p) => (s.leftOut[p] ?? 0) >= limit);
  if (!due.length) return null;
  return due.reduce((a, b) => ((s.leftOut[b] ?? 0) > (s.leftOut[a] ?? 0) ? b : a));
}

function moveTo(s: Spotlight, to: string): Spotlight {
  const leftOut = Object.fromEntries(s.players.map((p) => [p, p === to || p === s.holder ? 0 : (s.leftOut[p] ?? 0) + 1]));
  return { ...s, holder: to, leftOut };
}

/** The holder passes to another player; the GM may pass from anyone. Anyone left out for two rounds must get the next post (the GM may overrule). */
export function passSpotlight(s: Spotlight, actor: { id: string; role: 'gm' | 'player' }, to: string): Spotlight {
  if (actor.role !== 'gm' && actor.id !== s.holder) no('NOT_YOUR_TURN', 'The spotlight is not yours to pass');
  if (!s.players.includes(to) || to === s.holder) no('BAD_INPUT', 'Pass the spotlight to another player at the table');
  const forced = forcedNext(s);
  if (actor.role !== 'gm' && forced && forced !== to) no('LEFT_OUT', 'Someone has been left out for two rounds: they get the next post');
  return moveTo(s, to);
}

/** The GM may take any post. */
export function takeSpotlight(s: Spotlight, actor: { id: string; role: 'gm' | 'player' }): Spotlight {
  if (actor.role !== 'gm') no('NOT_ALLOWED', 'Only the GM takes the spotlight');
  return moveTo(s, actor.id);
}
