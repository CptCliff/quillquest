import { describe, expect, it } from 'vitest';
import { RuleViolation, forcedNext, joinSpotlight, leaveSpotlight, newSpotlight, passSpotlight, takeSpotlight, type Spotlight } from '../src';

const fails = (fn: () => unknown, code: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleViolation); expect((e as RuleViolation).code).toBe(code); return; }
  throw new Error('expected a RuleViolation');
};
const gm = { id: 'gm1', role: 'gm' as const };
const p = (id: string) => ({ id, role: 'player' as const });
const table = (): Spotlight => ['a', 'b', 'c'].reduce(joinSpotlight, newSpotlight());

describe('the spotlight', () => {
  it('starts with the first player, and the holder passes it to another player', () => {
    let s = table();
    expect(s.holder).toBe('a');
    s = passSpotlight(s, p('a'), 'b');
    expect(s.holder).toBe('b');
    fails(() => passSpotlight(s, p('a'), 'c'), 'NOT_YOUR_TURN');
    fails(() => passSpotlight(s, p('b'), 'b'), 'BAD_INPUT');
    fails(() => passSpotlight(s, p('b'), 'nobody'), 'BAD_INPUT');
  });
  it('the GM may pass it from anyone and take any post', () => {
    let s = passSpotlight(table(), gm, 'c');
    expect(s.holder).toBe('c');
    s = takeSpotlight(s, gm);
    expect(s.holder).toBe('gm1');
    s = passSpotlight(s, gm, 'a');
    expect(s.holder).toBe('a');
    fails(() => takeSpotlight(s, p('a')), 'NOT_ALLOWED');
  });
  it('anyone left out for two rounds gets the next post: the others may not pass past them', () => {
    let s = table(); // a holds; 3 players, so two rounds is six passes without holding
    for (let i = 0; i < 6; i++) s = passSpotlight(s, p(s.holder!), s.holder === 'a' ? 'b' : 'a');
    expect(forcedNext(s)).toBe('c');
    fails(() => passSpotlight(s, p(s.holder!), s.holder === 'a' ? 'b' : 'a'), 'LEFT_OUT');
    expect(passSpotlight(s, p(s.holder!), 'c').holder).toBe('c');
    expect(forcedNext(passSpotlight(s, p(s.holder!), 'c'))).toBeNull();
    expect(passSpotlight(s, gm, s.holder === 'a' ? 'b' : 'a')).toMatchObject({ holder: expect.any(String) }); // the GM may take any post
  });
  it('someone who leaves is dropped (and the spotlight moves on); someone who joins starts fresh', () => {
    let s = passSpotlight(table(), p('a'), 'b');
    s = leaveSpotlight(s, 'b');
    expect(s.players).toEqual(['a', 'c']);
    expect(s.holder).toBe('c'); // it moves on to the next player
    s = joinSpotlight(s, 'd');
    expect(s.players).toEqual(['a', 'c', 'd']);
    expect(joinSpotlight(s, 'd')).toEqual(s);
  });
});
