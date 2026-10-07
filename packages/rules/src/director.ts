// The GM's table: NPC sheets with hidden fields, Conviction nominations and the Conviction log (Rules v4 5.5; design plan 8.1).
import { RuleViolation } from './errors';
import { RATED_SKILL_RANKS, type RatedSkillRank } from './ranks';
import { awardConviction, startSession, type ConvictionReason } from './conviction';
import type { Character } from './character';

const no = (code: string, message: string): never => { throw new RuleViolation(code, message); };

// ---------- NPCs ----------
export const NPC_FIELDS = ['name', 'skills', 'beliefs', 'notes'] as const;
export type NpcField = (typeof NPC_FIELDS)[number];
export interface Npc { id: string; name: string; skills: { name: string; rank: RatedSkillRank }[]; beliefs: string[]; notes: string; revealedFields: NpcField[] }
/** What the table may see of an NPC: only the fields the GM has revealed. */
export interface PublicNpc { id: string; name: string | null; revealed: NpcField[]; skills?: Npc['skills']; beliefs?: string[]; notes?: string }

export const newNpc = (id: string, name: string): Npc => ({ id, name: name.trim() || no('BAD_INPUT', 'An NPC needs a name'), skills: [], beliefs: [], notes: '', revealedFields: [] });

export function editNpc(n: Npc, patch: Partial<Pick<Npc, 'name' | 'skills' | 'beliefs' | 'notes'>>): Npc {
  if (patch.name !== undefined && !patch.name.trim()) no('BAD_INPUT', 'An NPC needs a name');
  if (patch.skills?.some((s) => !s.name.trim() || !RATED_SKILL_RANKS.includes(s.rank))) no('BAD_INPUT', 'Each Skill needs a name and a rated rank');
  return { ...n, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.skills ? { skills: patch.skills } : {}), ...(patch.beliefs ? { beliefs: patch.beliefs } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}) };
}

export function revealField(n: Npc, field: NpcField): Npc {
  if (!NPC_FIELDS.includes(field)) no('BAD_INPUT', `A field is one of: ${NPC_FIELDS.join(', ')}`);
  return n.revealedFields.includes(field) ? n : { ...n, revealedFields: [...n.revealedFields, field] };
}

/** Null until something is revealed. Hidden fields are never copied, so nothing downstream can leak them. */
export function publicNpc(n: Npc): PublicNpc | null {
  if (!n.revealedFields.length) return null;
  const out: PublicNpc = { id: n.id, name: n.revealedFields.includes('name') ? n.name : null, revealed: [...n.revealedFields] };
  if (n.revealedFields.includes('skills')) out.skills = n.skills;
  if (n.revealedFields.includes('beliefs')) out.beliefs = n.beliefs;
  if (n.revealedFields.includes('notes')) out.notes = n.notes;
  return out;
}

// ---------- Conviction ----------
export type NominationKind = 'belief' | 'instinct' | 'trait' | 'other';
export interface Nomination { id: string; characterId: string; nominatedBy: string; kind: NominationKind; beliefId: string | null; note: string; status: 'open' | 'awarded' | 'declined' }
export interface ConvictionLogEntry { id: string; at: string; characterId: string; beliefId: string | null; kind: string; note: string; delta: number; awardedBy: string; nominatedBy: string | null }
export interface DirectorWorld { characters: Record<string, Character>; nominations: Nomination[]; log: ConvictionLogEntry[]; sessionNo: number; seq: number }

export const emptyDirector = (): DirectorWorld => ({ characters: {}, nominations: [], log: [], sessionNo: 1, seq: 0 });

const sheet = (w: DirectorWorld, id: string): Character => w.characters[id] ?? no('NO_CHARACTER', 'No such character');

/** Any player may nominate another player's moment (never their own). The GM decides. */
export function nominate(w: DirectorWorld, byUserId: string, a: { characterId: string; kind: NominationKind; beliefId?: string; note: string }): DirectorWorld {
  const c = sheet(w, a.characterId);
  if (c.left) no('NO_CHARACTER', 'No such character');
  if (c.ownerId === byUserId) no('OWN_MOMENT', 'Nominate another player\'s moment, not your own');
  const note = a.note.trim();
  if (!note) no('BAD_INPUT', 'Say what happened');
  if (!['belief', 'instinct', 'trait', 'other'].includes(a.kind)) no('BAD_INPUT', 'A nomination is for a Belief, Instinct, Trait or something else');
  if (a.kind === 'belief') {
    if (!a.beliefId) no('BAD_INPUT', 'Name the Belief it paid for');
    if (!c.beliefs.some((b) => b.id === a.beliefId)) no('NO_SUCH_BELIEF', 'No such Belief');
  }
  const id = `nom-${w.seq + 1}`;
  return { ...w, seq: w.seq + 1, nominations: [...w.nominations, { id, characterId: c.id, nominatedBy: byUserId, kind: a.kind, beliefId: a.kind === 'belief' ? a.beliefId! : null, note, status: 'open' }] };
}

const find = (w: DirectorWorld, id: string): Nomination => {
  const n = w.nominations.find((x) => x.id === id) ?? no('NO_SUCH_NOMINATION', 'No such nomination');
  if (n.status !== 'open') no('BAD_STATE', 'That nomination is already settled');
  return n;
};
const setStatus = (w: DirectorWorld, id: string, status: Nomination['status']): DirectorWorld => ({ ...w, nominations: w.nominations.map((n) => (n.id === id ? { ...n, status } : n)) });

function grant(w: DirectorWorld, gmId: string, characterId: string, reason: ConvictionReason, nominatedBy: string | null, at: string): DirectorWorld {
  const r = awardConviction(sheet(w, characterId), reason); // may refuse: the cap, one per Belief per session
  const entry: ConvictionLogEntry = { id: `cl-${w.seq + 1}`, at, characterId, beliefId: r.event.beliefId, kind: r.event.kind, note: r.event.note, delta: r.event.delta, awardedBy: gmId, nominatedBy };
  return { ...w, seq: w.seq + 1, characters: { ...w.characters, [characterId]: r.character }, log: [...w.log, entry] };
}

export function awardNomination(w: DirectorWorld, gmId: string, nominationId: string, at: string): DirectorWorld {
  const n = find(w, nominationId);
  const reason: ConvictionReason = n.kind === 'belief' ? { kind: 'belief', beliefId: n.beliefId!, note: n.note } : { kind: n.kind, note: n.note };
  return setStatus(grant(w, gmId, n.characterId, reason, n.nominatedBy, at), n.id, 'awarded');
}
export const declineNomination = (w: DirectorWorld, nominationId: string): DirectorWorld => setStatus(w, find(w, nominationId).id, 'declined');

export function awardDirect(w: DirectorWorld, gmId: string, a: { characterId: string; reason: ConvictionReason }, at: string): DirectorWorld {
  if (!a.reason.note.trim()) no('BAD_INPUT', 'Say what happened');
  return grant(w, gmId, a.characterId, a.reason, null, at);
}

/** A new session: every Belief may earn Conviction again; tokens carry over. */
export const startTableSession = (w: DirectorWorld): DirectorWorld => ({
  ...w, sessionNo: w.sessionNo + 1, characters: Object.fromEntries(Object.entries(w.characters).map(([id, c]) => [id, startSession(c)])),
});
