import { describe, expect, it } from 'vitest';
import {
  RuleViolation, applyBattleCost, answerPush, battleCosts, battleDiceView, concedeBattle, concedeContributor, declareContribution, editLead, newCharacter, openBattle,
  orderBeats, pushReady, requestPush, resolvePush, rollBattle, scriptedDice, setBattleCard, skipContributor, stitchBattle, toPublicBattle, waitingOn, writeBeat,
  type BattleCard, type Character, type CreationActor,
} from '../src';

const gm: CreationActor = { id: 'gm1', role: 'gm' };
const u = (id: string): CreationActor => ({ id: `u-${id}`, role: 'player' });
const sheet = (id: string, over: Partial<Character> = {}): Character => ({
  ...newCharacter(id, id[0]!.toUpperCase() + id.slice(1)), ownerId: `u-${id}`,
  skills: [{ name: 'Swordplay', rank: 'Capable' }],
  beliefs: [{ id: `${id}-core`, kind: 'worldview', text: 'Oaths outlast people', isCore: true, convictionEarnedThisSession: false }],
  ...over,
});
const sheets = (): Record<string, Character> => ({ aric: sheet('aric', { conviction: 1 }), sella: sheet('sella'), ilse: sheet('ilse'), rook: sheet('rook') });
const fails = (fn: () => unknown, code?: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleViolation); if (code) expect((e as RuleViolation).code).toBe(code); return; }
  throw new Error('expected a RuleViolation');
};

/** The barricade (Rules v4 4.6): Aric leads against Hard, battle Danger Severe; Sella, Ilse and Rook contribute. */
function opened(): BattleCard {
  return openBattle(gm, {
    id: 'b1', goal: 'Take the barricade', battleDanger: 'I am cut down at the gap', difficulty: 'Hard', dangerRank: 'Severe', framingParagraphId: 'p-frame',
    lead: { characterId: 'aric', actorId: 'u-aric' }, others: [{ characterId: 'sella', actorId: 'u-sella' }, { characterId: 'ilse', actorId: 'u-ilse' }, { characterId: 'rook', actorId: 'u-rook' }],
  });
}
const lead = (b: BattleCard, over: Record<string, unknown> = {}) => editLead(b, u('aric'), { want: 'Break the line', risk: 'I fall at the gap', skill: { name: 'Swordplay', rank: 'Capable' }, ...over } as never, sheets().aric!);
const open = (id: string) => ({ line: `${id} opens the flank`, type: 'open' as const, dangerRank: 'Serious' as const, dangerText: 'Wounded by return fire' });
function declared(): BattleCard {
  let b = lead(opened());
  b = declareContribution(b, u('sella'), open('sella'));
  b = declareContribution(b, u('ilse'), { line: 'Ilse fires the wagon', type: 'cover', target: 'aric', dangerRank: 'Real', dangerText: 'the fire spreads' });
  b = declareContribution(b, u('rook'), { line: 'Rook charges the gap', type: 'press', dangerRank: 'Serious', dangerText: 'Wounded in the melee' });
  return b;
}
const set = (b = declared()) => setBattleCard(b, gm, sheets());
const rolledFail = () => rollBattle(set(), gm, scriptedDice([1, 8, 1, 1, 1, 1])); // skill 1 vs Difficulty die 8: goal fails; every Danger die is 1: all avoided

describe('opening a battle', () => {
  it('is the GM\'s: a goal, the battle Danger, the Difficulty, a framing post, the lead and everyone else', () => {
    const b = opened();
    expect(b).toMatchObject({ id: 'b1', status: 'declaring', goal: 'Take the barricade', framingParagraphId: 'p-frame' });
    expect(b.lead).toMatchObject({ characterId: 'aric', actorId: 'u-aric', difficulty: 'Hard', danger: 'Severe', dangerText: 'I am cut down at the gap', gmMarkedBig: true });
    expect(waitingOn(b).sort()).toEqual(['ilse', 'rook', 'sella']);
    fails(() => openBattle(u('aric'), { id: 'x', goal: 'g', battleDanger: 'd', difficulty: 'Hard', dangerRank: 'Severe', framingParagraphId: null, lead: { characterId: 'aric', actorId: 'u-aric' }, others: [] }), 'NOT_ALLOWED');
    fails(() => openBattle(gm, { id: 'x', goal: ' ', battleDanger: 'd', difficulty: 'Hard', dangerRank: 'Severe', framingParagraphId: null, lead: { characterId: 'aric', actorId: 'u-aric' }, others: [] }), 'BAD_INPUT');
    fails(() => openBattle(gm, { id: 'x', goal: 'g', battleDanger: 'd', difficulty: 'Trivial', dangerRank: 'Severe', framingParagraphId: null, lead: { characterId: 'aric', actorId: 'u-aric' }, others: [] }), 'BAD_INPUT');
  });
  it('the lead fills the main card; only the lead (or the GM) may, and not the ranks', () => {
    const b = lead(opened());
    expect(b.lead).toMatchObject({ want: 'Break the line', risk: 'I fall at the gap', skillName: 'Swordplay', skillRank: 'Capable' });
    fails(() => editLead(opened(), u('sella'), { want: 'x' }, sheets().sella!), 'NOT_ALLOWED');
    fails(() => editLead(opened(), u('aric'), { difficulty: 'Simple' }, sheets().aric!), 'NOT_ALLOWED'); // the GM sets the ranks
    expect(editLead(opened(), gm, { difficulty: 'Demanding' }, sheets().aric!).lead.difficulty).toBe('Demanding');
  });
});

describe('contributions', () => {
  it('each other player declares a line, a type, a target if Cover, and their own Danger; declaring again replaces it', () => {
    let b = declareContribution(lead(opened()), u('sella'), open('sella'));
    expect(b.contributions.find((c) => c.characterId === 'sella')).toMatchObject({ status: 'declared', type: 'open', dangerRank: 'Serious', dangerText: 'Wounded by return fire' });
    expect(waitingOn(b).sort()).toEqual(['ilse', 'rook']);
    b = declareContribution(b, u('sella'), { ...open('sella'), line: 'changed my mind', type: 'press' });
    expect(b.contributions.find((c) => c.characterId === 'sella')).toMatchObject({ type: 'press', line: 'changed my mind' });
  });
  it('refuses a blank line or Danger, a Cover with no (or a bad) target, the lead, the GM and strangers', () => {
    const b = lead(opened());
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), line: ' ' }), 'BAD_INPUT');
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), dangerText: '' }), 'BAD_INPUT');
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), dangerRank: 'Epic' as never }), 'BAD_INPUT');
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), type: 'cover' }), 'COVER_TARGET');
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), type: 'cover', target: 'sella' }), 'COVER_TARGET');
    fails(() => declareContribution(b, u('sella'), { ...open('sella'), type: 'cover', target: 'nobody' }), 'COVER_TARGET');
    fails(() => declareContribution(b, u('aric'), open('aric')), 'NOT_ALLOWED'); // the lead has the main card
    fails(() => declareContribution(b, gm, open('gm')), 'NOT_ALLOWED');
    fails(() => declareContribution(b, u('stranger'), open('x')), 'NOT_ALLOWED');
  });
  it('shifts any one ladder at most two ranks: a third Open is refused when it is declared', () => {
    let b = declareContribution(lead(opened()), u('sella'), open('sella'));
    b = declareContribution(b, u('ilse'), open('ilse'));
    fails(() => declareContribution(b, u('rook'), open('rook')), 'BATTLE_CAP');
    expect(declareContribution(b, u('rook'), { ...open('rook'), type: 'press' }).contributions.find((c) => c.characterId === 'rook')!.type).toBe('press');
  });
  it('a contributor may concede (they and their Danger leave); the GM may skip someone who has not declared', () => {
    let b = lead(opened());
    b = concedeContributor(b, u('sella'));
    b = skipContributor(b, gm, 'ilse');
    expect(b.contributions.map((c) => [c.characterId, c.status])).toEqual([['sella', 'withdrawn'], ['ilse', 'skipped'], ['rook', 'open']]);
    expect(waitingOn(b)).toEqual(['rook']);
    fails(() => skipContributor(b, u('sella'), 'rook'), 'NOT_ALLOWED');
    const done = declareContribution(b, u('rook'), open('rook'));
    fails(() => skipContributor(done, gm, 'rook'), 'ALREADY_DECLARED');
  });
});

describe('Set', () => {
  it('waits for every contributor, then the GM sets the Difficulty and every Danger at once; the engine applies the contributions', () => {
    fails(() => set(lead(opened())), 'NOT_ALL_DECLARED');
    fails(() => setBattleCard(declared(), u('aric'), sheets()), 'NOT_ALLOWED');
    fails(() => setBattleCard(declareContribution(opened(), u('sella'), open('sella')), gm, sheets()), 'NOT_ALL_DECLARED');
    fails(() => setBattleCard(opened(), gm, sheets()), 'NOT_ALL_DECLARED');
    const b = set();
    expect(b.status).toBe('set');
    // Sella Open (Hard -> Demanding), Ilse Cover on Aric (Severe -> Serious), Rook Press (Capable -> Expert).
    expect(b.set!.lead).toMatchObject({ difficulty: 'Demanding', danger: 'Serious', skill: 'Expert' });
    expect(b.set!.dangers.map((d) => [d.characterId, d.rank])).toEqual([['aric', 'Serious'], ['sella', 'Serious'], ['ilse', 'Real'], ['rook', 'Serious']]);
  });
  it('the lead must have filled the card first; the GM may adjust the Difficulty and any Danger', () => {
    fails(() => setBattleCard(declareAll(opened()), gm, sheets()), 'MISSING_FIELD');
    const b = setBattleCard(declared(), gm, sheets(), { difficulty: 'Extraordinary', dangers: { sella: 'Severe' } });
    expect(b.set!.lead.difficulty).toBe('Hard'); // Extraordinary, then Open once: one rank easier
    expect(b.set!.dangers.find((d) => d.characterId === 'sella')!.rank).toBe('Severe');
  });
  it('words only for the odds: the battle and each Danger', () => {
    const p = toPublicBattle(set());
    expect(p.odds!.goal).toMatch(/Desperate|Long shot|Even|Favored|Sure bet/);
    expect(p.odds!.dangers.map((d) => d.characterId)).toEqual(['aric', 'sella', 'ilse', 'rook']);
    expect(p.odds!.dangers.every((d) => /Remote|Unlikely|Even|Likely|Near certain/.test(d.word))).toBe(true);
  });
  it('a contributor who concedes after Set sends the battle back to be set again', () => {
    const b = concedeContributor(set(), u('sella'));
    expect(b.status).toBe('declaring');
    expect(b.set).toBeNull();
    expect(set(b).set!.dangers.map((d) => d.characterId)).toEqual(['aric', 'ilse', 'rook']);
  });
});
function declareAll(b: BattleCard): BattleCard {
  b = declareContribution(b, u('sella'), open('sella'));
  for (const id of ['ilse', 'rook']) b = declareContribution(b, u(id), { ...open(id), type: 'press' });
  return b;
}

describe('Roll', () => {
  it('the GM rolls once: the battle is won or lost for everyone, and each Danger lands or not on its own; the dice stay out of the public view', () => {
    const b = rollBattle(set(), gm, scriptedDice([8, 1, 1, 1, 1, 1])); // Skill d10, Difficulty d10, then four Danger dice
    expect(b.status).toBe('rolled');
    const p = toPublicBattle(b);
    expect(p.result).toMatchObject({ goal: true });
    expect(p.result!.dangers.map((d) => d.characterId)).toEqual(['aric', 'sella', 'ilse', 'rook']);
    expect(JSON.stringify(p)).not.toMatch(/skillDie|difficultyDie|"kept"|"die"|"value"|"sides"/);
    expect(p.dice).toBeNull();
  });
  it('only the GM rolls, and only a Set battle', () => {
    fails(() => rollBattle(set(), u('aric'), scriptedDice([1])), 'NOT_ALLOWED');
    fails(() => rollBattle(declared(), gm, scriptedDice([1])), 'NOT_SET');
  });
  it('the reveal view is the only place numbers appear', () => {
    const b = rollBattle(set(), gm, scriptedDice([8, 1, 1, 1, 1, 1]));
    const d = battleDiceView(b);
    expect(d.attempt.skill.value).toBe(8);
    expect(d.dangers).toHaveLength(4);
    expect(toPublicBattle({ ...b, revealed: true }).dice).not.toBeNull();
  });
});

describe('push, withdrawals and Conviction', () => {
  const now = 1_000_000;
  const fail = () => rollBattle(set(), gm, scriptedDice([1, 8, 1, 1, 1, 1]));
  it('a push is only for a failed goal, only for the lead, and only once', () => {
    const won = rollBattle(set(), gm, scriptedDice([10, 1, 1, 1, 1, 1]));
    fails(() => requestPush(won, u('aric'), 'standard', { now, windowMs: 1000, dice: scriptedDice([]), sheet: sheets().aric! }), 'NOTHING_TO_PUSH');
    fails(() => requestPush(fail(), u('sella'), 'standard', { now, windowMs: 1000, dice: scriptedDice([]), sheet: sheets().sella! }), 'NOT_ALLOWED');
  });
  it('a standard push opens a window: each contributor may withdraw or stay; it closes when all have answered, at the deadline, or when the GM forces it', () => {
    let { battle: b } = requestPush(fail(), u('aric'), 'standard', { now, windowMs: 60_000, dice: scriptedDice([]), sheet: sheets().aric! });
    expect(b.status).toBe('pushing');
    expect(toPublicBattle(b).push).toMatchObject({ kind: 'standard', waiting: ['sella', 'ilse', 'rook'], deadline: now + 60_000 });
    expect(pushReady(b, now)).toBe(false);
    b = answerPush(b, u('sella'), 'withdraw');
    b = answerPush(b, u('ilse'), 'stay');
    fails(() => answerPush(b, u('aric'), 'stay'), 'NOT_ALLOWED'); // the lead cannot withdraw
    fails(() => answerPush(b, gm, 'stay'), 'NOT_ALLOWED');
    expect(pushReady(b, now)).toBe(false);
    expect(pushReady(b, now + 60_000)).toBe(true); // the window has run out
    b = answerPush(b, u('rook'), 'stay');
    expect(pushReady(b, now)).toBe(true); // everyone answered
    const stuck = requestPush(fail(), u('aric'), 'standard', { now, windowMs: 60_000, dice: scriptedDice([]), sheet: sheets().aric! }).battle;
    fails(() => resolvePush(stuck, u('aric'), scriptedDice([]), now), 'PUSH_NOT_READY');
    expect(() => resolvePush(stuck, gm, scriptedDice([8, 1, 1, 1, 1, 1]), now, { force: true })).not.toThrow(); // the GM forces it
  });
  it('a withdrawal takes that contributor\'s shift and Danger out of the roll: no recheck die is drawn for them', () => {
    let { battle: b } = requestPush(fail(), u('aric'), 'standard', { now, windowMs: 60_000, dice: scriptedDice([]), sheet: sheets().aric! });
    b = answerPush(answerPush(answerPush(b, u('sella'), 'withdraw'), u('ilse'), 'stay'), u('rook'), 'stay');
    const dice = scriptedDice([8, 1, 1, 1, 1, 1]); // second attempt: Skill, Difficulty; then rechecks for Aric, Ilse, Rook only (Sella withdrew)
    const after = resolvePush(b, u('aric'), dice, now);
    expect(after.status).toBe('rolled');
    expect(after.contributions.find((c) => c.characterId === 'sella')!.status).toBe('withdrawn');
    expect(toPublicBattle(after).result!.dangers.find((d) => d.characterId === 'sella')).toMatchObject({ withdrawn: true });
    expect(dice.remaining()).toBe(1); // Skill, Difficulty and three rechecks were drawn out of six values
  });
  it('a Conviction push spends a token, rechecks nothing, and needs no window', () => {
    const r = requestPush(fail(), u('aric'), 'conviction', { now, windowMs: 60_000, dice: scriptedDice([8, 1]), sheet: sheets().aric! });
    expect(r.battle.status).toBe('rolled');
    expect(r.character!.conviction).toBe(0);
    expect(toPublicBattle(r.battle).result).toMatchObject({ push: 'conviction' });
    fails(() => requestPush(fail(), u('aric'), 'conviction', { now, windowMs: 1, dice: scriptedDice([8, 1]), sheet: { ...sheets().aric!, conviction: 0 } }), 'NO_CONVICTION');
    fails(() => requestPush(r.battle, u('aric'), 'standard', { now, windowMs: 1, dice: scriptedDice([]), sheet: sheets().aric! }), 'ALREADY_PUSHED');
  });
  it('with nobody left to withdraw, a standard push resolves at once', () => {
    const solo = openBattle(gm, { id: 'b2', goal: 'g', battleDanger: 'd', difficulty: 'Hard', dangerRank: 'Severe', framingParagraphId: null, lead: { characterId: 'aric', actorId: 'u-aric' }, others: [] });
    const b = setBattleCard(editLead(solo, u('aric'), { want: 'w', risk: 'r', skill: { name: 'Swordplay', rank: 'Capable' } }, sheets().aric!), gm, sheets());
    const lost = rollBattle(b, gm, scriptedDice([1, 9, 1]));
    const r = requestPush(lost, u('aric'), 'standard', { now, windowMs: 1, dice: scriptedDice([8, 1, 1]), sheet: sheets().aric! });
    expect(r.battle.status).toBe('rolled');
    expect(toPublicBattle(r.battle).result).toMatchObject({ push: 'standard' });
  });
  it('the lead may concede instead of pushing; before the roll that ends the battle with no costs', () => {
    expect(concedeBattle(set(), u('aric'), 'surrender').status).toBe('conceded');
  });
});

describe('beats, costs and the stitched post', () => {
  const beats = (b: BattleCard) => {
    b = writeBeat(b, u('aric'), { text: 'Aric breaks the line. The barricade falls.' });
    b = writeBeat(b, u('sella'), { text: 'Sella\'s archers pin the flank.' });
    b = writeBeat(b, u('ilse'), { text: 'Ilse fires the wagon. Smoke rolls across the gap. She slips away.' });
    return writeBeat(b, u('rook'), { text: 'Rook charges the gap.' });
  };
  it('each participant writes one to three sentences; a beat can be rewritten until the post is stitched', () => {
    const b = rolledFail();
    const w = writeBeat(b, u('sella'), { text: 'One. Two. Three.' });
    expect(toPublicBattle(w).beatsWritten).toEqual(['sella']);
    fails(() => writeBeat(b, u('sella'), { text: '' }), 'BAD_INPUT');
    fails(() => writeBeat(b, u('sella'), { text: 'One. Two. Three. Four.' }), 'BEAT_LENGTH');
    fails(() => writeBeat(b, u('sella'), { text: 'x'.repeat(601) }), 'BEAT_LENGTH');
    fails(() => writeBeat(b, gm, { text: 'x' }), 'NOT_ALLOWED');
    fails(() => writeBeat(set(), u('sella'), { text: 'Too early.' }), 'NOT_ROLLED');
    fails(() => writeBeat(b, u('stranger'), { text: 'x' }), 'NOT_ALLOWED');
  });
  it('stitches the lead first, then the contributions in the GM\'s order; each keeps its writer', () => {
    const b = beats(rolledFail());
    const ordered = orderBeats(b, gm, ['rook', 'ilse', 'sella']);
    fails(() => orderBeats(b, u('aric'), ['rook', 'ilse', 'sella']), 'NOT_ALLOWED');
    fails(() => orderBeats(b, gm, ['rook', 'ilse']), 'BAD_INPUT');
    const r = stitchBattle(ordered, gm);
    expect(r.post.map((p) => [p.characterId, p.actorId, p.kind])).toEqual([['aric', 'u-aric', 'beat'], ['rook', 'u-rook', 'beat'], ['ilse', 'u-ilse', 'beat'], ['sella', 'u-sella', 'beat']]);
    expect(r.battle.status).toBe('written');
    fails(() => stitchBattle(r.battle, gm), 'NOT_ROLLED');
  });
  it('waits for every beat unless the GM chooses to leave a missing one out; only the GM stitches', () => {
    let b = writeBeat(rolledFail(), u('aric'), { text: 'Aric fights.' });
    fails(() => stitchBattle(b, gm), 'BEATS_PENDING');
    fails(() => stitchBattle(beats(rolledFail()), u('aric')), 'NOT_ALLOWED');
    b = writeBeat(b, u('sella'), { text: 'Sella shoots.' });
    expect(stitchBattle(b, gm, { skipMissing: true }).post.map((p) => p.characterId)).toEqual(['aric', 'sella']);
  });
  it('a Danger that hit needs a cost line, and costs follow the beats; a wound is applied through the engine and never worse than its severity', () => {
    // Skill 1 fails the goal; Sella's Danger die 8 hits; the rest avoid.
    const b0 = rollBattle(set(), gm, scriptedDice([1, 8, 1, 8, 1, 1]));
    let b = beats(b0);
    expect(battleCosts(b).map((c) => c.characterId)).toEqual(['sella']);
    fails(() => stitchBattle(b, gm), 'COST_PENDING');
    b = writeBeat(b, u('sella'), { text: 'Sella\'s archers pin the flank.', cost: { text: 'A bolt takes her in the shoulder.', woundName: 'Bolt in the shoulder', woundLevel: 'Wounded' } });
    const r = stitchBattle(b, gm);
    expect(r.post.map((p) => [p.characterId, p.kind])).toEqual([['aric', 'beat'], ['sella', 'beat'], ['ilse', 'beat'], ['rook', 'beat'], ['sella', 'cost']]);
    const hurt = applyBattleCost(sheets().sella!, r.battle, 'sella', { woundName: 'Bolt in the shoulder', woundLevel: 'Wounded' });
    expect(hurt.wounds).toEqual([expect.objectContaining({ name: 'Bolt in the shoulder', level: 'Wounded' })]);
    fails(() => applyBattleCost(sheets().sella!, r.battle, 'sella', { woundLevel: 'Critical' }), 'WOUND_TOO_SEVERE');
    expect(applyBattleCost(sheets().ilse!, r.battle, 'ilse', {}).wounds).toEqual([]); // a Danger that was avoided costs nothing
  });
  it('a withdrawn contributor\'s Danger leaves the roll, so there is no cost to write', () => {
    let { battle: b } = requestPush(rollBattle(set(), gm, scriptedDice([1, 8, 1, 8, 1, 1])), u('aric'), 'standard', { now: 0, windowMs: 1, dice: scriptedDice([]), sheet: sheets().aric! });
    b = answerPush(answerPush(answerPush(b, u('sella'), 'withdraw'), u('ilse'), 'stay'), u('rook'), 'stay');
    b = resolvePush(b, u('aric'), scriptedDice([1, 8, 1, 1, 1]), 0);
    expect(battleCosts(b).find((c) => c.characterId === 'sella')).toBeUndefined();
  });
});
