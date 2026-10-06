import { describe, expect, it } from 'vitest';
import { RuleViolation, addBurden, awardConviction, layDownBurden, spendConviction, startSession } from '../src';
import { validCharacter } from './helpers';

const note = (beliefId: string) => ({ kind: 'belief' as const, beliefId, note: 'cost something real' });

describe('Conviction', () => {
  it('awards a token and marks the Belief for the session', () => {
    const r = awardConviction(validCharacter(), note('b1'));
    expect(r.character.conviction).toBe(2);
    expect(r.character.beliefs[0]?.convictionEarnedThisSession).toBe(true);
    expect(r.event).toMatchObject({ beliefId: 'b1', delta: 1 });
  });
  it('a fourth token is rejected', () => {
    const c = { ...validCharacter(), conviction: 3 };
    expect(() => awardConviction(c, note('b1'))).toThrow(/at most 3/);
  });
  it('a second award to the same Belief in one session is rejected, until the next session', () => {
    const c = awardConviction(validCharacter(), note('b1')).character;
    expect(() => awardConviction({ ...c, conviction: 1 }, note('b1'))).toThrow(RuleViolation);
    expect(awardConviction(startSession({ ...c, conviction: 1 }), note('b1')).character.conviction).toBe(2);
  });
  it('Instinct and harmful-Trait trouble earn Conviction without a Belief', () => {
    const r = awardConviction(validCharacter(), { kind: 'instinct', note: 'checked the exits and missed the ambush' });
    expect(r.event.beliefId).toBeNull();
  });
  it('spending needs a token', () => {
    const c = { ...validCharacter(), conviction: 0 };
    expect(() => spendConviction(c, 'push')).toThrow(RuleViolation);
    expect(spendConviction(validCharacter(), 'takeDanger').conviction).toBe(0);
  });
});

describe('Burdens', () => {
  const withTwo = () => addBurden(addBurden(validCharacter(), 'b1', { id: 'x1', name: 'Doubts the Oath', about: 'the smuggler' }), 'b2', { id: 'x2', name: 'Cannot Trust', about: 'Ilse' });
  it('allows two active Burdens and rejects a third', () => {
    expect(() => addBurden(withTwo(), 'b3', { id: 'x3', name: 'Third', about: 'x' })).toThrow(/third Burden/);
  });
  it('laying one down as a Trait frees a slot, earns Conviction past the Belief limit, and adds the Trait', () => {
    let c = awardConviction(withTwo(), note('b1')).character; // b1 already earned this session; conviction 2
    const r = layDownBurden(c, 'x1', { kind: 'trait', traitId: 'tn', text: 'Keeps the Oath She Chose' });
    expect(r.character.conviction).toBe(3);
    expect(r.event).toMatchObject({ kind: 'burdenLaidDown', delta: 1 });
    expect(r.character.traits.at(-1)).toMatchObject({ text: 'Keeps the Oath She Chose', source: { type: 'burden' } });
    expect(() => addBurden(r.character, 'b3', { id: 'x3', name: 'Third', about: 'x' })).not.toThrow();
  });
  it('rewriting the Belief also resolves a Burden', () => {
    const r = layDownBurden(withTwo(), 'x2', { kind: 'beliefRewrite', text: 'I will let Ilse choose her own road' });
    expect(r.character.beliefs.find((b) => b.id === 'b2')?.text).toBe('I will let Ilse choose her own road');
    expect(r.character.burdens.find((b) => b.id === 'x2')).toMatchObject({ status: 'laidDown', outcome: 'beliefRewrite' });
  });
  it('at the Conviction cap, laying down still works but gains nothing', () => {
    const c = { ...withTwo(), conviction: 3 };
    const r = layDownBurden(c, 'x1', { kind: 'trait', traitId: 'tn', text: 'T' });
    expect(r.character.conviction).toBe(3);
    expect(r.event.delta).toBe(0);
  });
  it('cannot lay down a Burden twice', () => {
    const r = layDownBurden(withTwo(), 'x1', { kind: 'trait', traitId: 'tn', text: 'T' });
    expect(() => layDownBurden(r.character, 'x1', { kind: 'trait', traitId: 'tn2', text: 'T' })).toThrow(RuleViolation);
  });
});
