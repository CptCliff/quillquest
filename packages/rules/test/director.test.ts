import { describe, expect, it } from 'vitest';
import {
  RuleViolation, awardDirect, awardNomination, declineNomination, editNpc, emptyDirector, newCharacter, newNpc, nominate, publicNpc, revealField, startTableSession,
  type Character, type DirectorWorld,
} from '../src';

const char = (id: string, owner: string, over: Partial<Character> = {}): Character => ({
  ...newCharacter(id, id), ownerId: owner,
  beliefs: [{ id: `${id}-b1`, kind: 'objective', text: 'Find the truth', isCore: false, convictionEarnedThisSession: false }, { id: `${id}-b2`, kind: 'worldview', text: 'Debts come due', isCore: true, convictionEarnedThisSession: false }],
  ...over,
});
const world = (): DirectorWorld => ({ ...emptyDirector(), characters: { ilse: char('ilse', 'u-ilse'), sella: char('sella', 'u-sella') } });
const fails = (fn: () => unknown, code: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleViolation); expect((e as RuleViolation).code).toBe(code); return; }
  throw new Error('expected a RuleViolation');
};

describe('NPC sheets: hidden until the GM reveals a field', () => {
  const npc = () => editNpc(newNpc('n1', 'Captain Aldous'), { skills: [{ name: 'Swordplay', rank: 'Expert' }], beliefs: ['The crown is owed obedience'], notes: 'Secretly taking the duke\'s coin.' });
  it('starts fully hidden: players see nothing of it', () => {
    expect(publicNpc(npc())).toBeNull();
  });
  it('a revealed field, and only that field, becomes public', () => {
    let n = revealField(npc(), 'beliefs');
    expect(publicNpc(n)).toEqual({ id: 'n1', name: null, revealed: ['beliefs'], beliefs: ['The crown is owed obedience'] });
    expect(JSON.stringify(publicNpc(n))).not.toContain('duke');
    expect(JSON.stringify(publicNpc(n))).not.toContain('Swordplay');
    n = revealField(n, 'name');
    expect(publicNpc(n)).toMatchObject({ name: 'Captain Aldous', revealed: ['beliefs', 'name'] });
  });
  it('revealing twice is harmless; an unknown field is refused', () => {
    expect(revealField(revealField(npc(), 'notes'), 'notes').revealedFields).toEqual(['notes']);
    fails(() => revealField(npc(), 'secrets' as never), 'BAD_INPUT');
  });
  it('editing keeps what was revealed, and rejects a blank name or an invalid rank', () => {
    const n = editNpc(revealField(npc(), 'skills'), { name: 'Captain Aldous Vane' });
    expect(n.revealedFields).toEqual(['skills']);
    expect(n.name).toBe('Captain Aldous Vane');
    fails(() => editNpc(npc(), { name: ' ' }), 'BAD_INPUT');
    fails(() => editNpc(npc(), { skills: [{ name: 'Swordplay', rank: 'Godlike' as never }] }), 'BAD_INPUT');
  });
  it('opposed rolls pull the NPC\'s rank for a Skill, by name', () => {
    expect(editNpc(newNpc('n1', 'A'), { skills: [{ name: 'Swordplay', rank: 'Expert' }] }).skills[0]).toEqual({ name: 'Swordplay', rank: 'Expert' });
  });
});

describe('Conviction: nominations, awards, and the log', () => {
  it('any player may nominate another player\'s moment, never their own', () => {
    const w = nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'instinct', note: 'She checked the exits and was ambushed anyway' });
    expect(w.nominations).toEqual([expect.objectContaining({ characterId: 'ilse', nominatedBy: 'u-sella', status: 'open', kind: 'instinct' })]);
    fails(() => nominate(world(), 'u-ilse', { characterId: 'ilse', kind: 'other', note: 'me!' }), 'OWN_MOMENT');
    fails(() => nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'other', note: '  ' }), 'BAD_INPUT');
    fails(() => nominate(world(), 'u-sella', { characterId: 'nobody', kind: 'other', note: 'x' }), 'NO_CHARACTER');
    fails(() => nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'belief', note: 'x' }), 'BAD_INPUT'); // a Belief nomination names the Belief
    fails(() => nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'belief', beliefId: 'zzz', note: 'x' }), 'NO_SUCH_BELIEF');
  });
  it('the GM awards a nomination: a token, the Belief marked earned, a log entry naming both people', () => {
    let w = nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'belief', beliefId: 'ilse-b1', note: 'She gave up the lead to save Sella' });
    w = awardNomination(w, 'gm1', w.nominations[0]!.id, '2026-10-07T12:00:00Z');
    expect(w.characters.ilse!.conviction).toBe(2);
    expect(w.characters.ilse!.beliefs[0]!.convictionEarnedThisSession).toBe(true);
    expect(w.nominations[0]!.status).toBe('awarded');
    expect(w.log).toEqual([expect.objectContaining({ characterId: 'ilse', beliefId: 'ilse-b1', kind: 'belief', note: 'She gave up the lead to save Sella', delta: 1, awardedBy: 'gm1', nominatedBy: 'u-sella', at: '2026-10-07T12:00:00Z' })]);
  });
  it('one token per Belief per session, and the cap of three, still apply; a refused award leaves the nomination open', () => {
    let w = nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'belief', beliefId: 'ilse-b1', note: 'a' });
    w = awardNomination(w, 'gm1', w.nominations[0]!.id, 't');
    w = nominate(w, 'u-sella', { characterId: 'ilse', kind: 'belief', beliefId: 'ilse-b1', note: 'again' });
    fails(() => awardNomination(w, 'gm1', w.nominations[1]!.id, 't'), 'BELIEF_ALREADY_EARNED');
    expect(w.nominations[1]!.status).toBe('open');
    const full = { ...world(), characters: { ...world().characters, ilse: char('ilse', 'u-ilse', { conviction: 3 }) } };
    const n = nominate(full, 'u-sella', { characterId: 'ilse', kind: 'other', note: 'x' });
    fails(() => awardNomination(n, 'gm1', n.nominations[0]!.id, 't'), 'CONVICTION_CAP');
  });
  it('declining closes a nomination without a token, and a settled nomination cannot be settled again', () => {
    let w = nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'other', note: 'x' });
    w = declineNomination(w, w.nominations[0]!.id);
    expect(w.nominations[0]!.status).toBe('declined');
    expect(w.characters.ilse!.conviction).toBe(1);
    expect(w.log).toEqual([]);
    fails(() => awardNomination(w, 'gm1', w.nominations[0]!.id, 't'), 'BAD_STATE');
    fails(() => declineNomination(w, 'nope'), 'NO_SUCH_NOMINATION');
  });
  it('the GM can award without a nomination (no nominator in the log)', () => {
    const w = awardDirect(world(), 'gm1', { characterId: 'sella', reason: { kind: 'trait', note: 'Her harmful Trait cost her the deal' } }, 't');
    expect(w.characters.sella!.conviction).toBe(2);
    expect(w.log[0]).toMatchObject({ nominatedBy: null, awardedBy: 'gm1', kind: 'trait' });
  });
  it('a new session lets every Belief earn again', () => {
    let w = nominate(world(), 'u-sella', { characterId: 'ilse', kind: 'belief', beliefId: 'ilse-b1', note: 'a' });
    w = awardNomination(w, 'gm1', w.nominations[0]!.id, 't');
    w = startTableSession(w);
    expect(w.characters.ilse!.beliefs.every((b) => !b.convictionEarnedThisSession)).toBe(true);
    expect(w.characters.ilse!.conviction).toBe(2); // tokens carry over
    expect(w.sessionNo).toBe(2);
  });
});
