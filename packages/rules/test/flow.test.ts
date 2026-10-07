import { describe, expect, it } from 'vitest';
import {
  CONCESSION_KINDS, RuleViolation, classifyCard, closeSet, concede, editCard, expandShifts, markWritten, newCard, applyCosts,
  outcomePrompt, previewCard, pushCard, pushOptions, reopenForRetcon, revertCosts, resolveSkill, scriptedDice, suggestShifts, toPublicCard, diceView,
  newCharacter, rollCard, type Character, type FlowActor, type PromptCard,
} from '../src';
import { validCharacter } from './helpers';

const ilse: FlowActor = { id: 'ilse', role: 'player' };
const sella: FlowActor = { id: 'sella', role: 'player' };
const gm: FlowActor = { id: 'gm1', role: 'gm' };

/** Ilse: Swordplay Capable, armor light, Hurt wound, a possession, and helpful + harmful Traits. */
function sheet(): Character {
  const c = validCharacter();
  return {
    ...c,
    id: 'ilse-pc',
    armor: 'light',
    possessions: [{ id: 'pos1', name: "Father's Sword", story: 'carried through the Border War' }],
    traits: [...c.traits, { id: 'tr-help', text: 'Steady Hands', harmful: false, source: { type: 'other' } }],
    wounds: [{ id: 'w1', level: 'Hurt', name: 'Twisted ankle', isExhaustion: false }],
    standing: { 'Royal Army': 'Respected', Cathedral: 'Distrusted' },
  };
}
const fresh = (over: Partial<Parameters<typeof newCard>[0]> = {}): PromptCard =>
  newCard({ id: 'c1', actorId: 'ilse', characterId: 'ilse-pc', anchorParagraphId: 'p1', skill: { name: 'Swordplay', rank: 'Capable' }, want: 'Climb the wall', risk: 'I twist an ankle', ...over });
const filled = (over: Partial<PromptCard> = {}): PromptCard => ({ ...fresh(), difficulty: 'Demanding', danger: 'Serious', dangerKind: 'other', dangerText: 'I twist an ankle', ...over });

describe('classifyCard', () => {
  it('is quick by default', () => expect(classifyCard(fresh())).toBe('quick'));
  it('is big when a Belief is on the line', () => expect(classifyCard(fresh({ onTheLine: 'b1' }))).toBe('big'));
  it('is big when the Danger affects another character, but not when it is the actor\'s own', () => {
    expect(classifyCard(fresh({ dangerTargetId: 'sella-pc' }))).toBe('big');
    expect(classifyCard(fresh({ dangerTargetId: 'ilse-pc' }))).toBe('quick');
  });
  it('is big when the GM marks it', () => expect(classifyCard({ ...fresh(), gmMarkedBig: true })).toBe('big'));
});

describe('resolveSkill', () => {
  it('reads the rank from the sheet, never from the client', () => {
    expect(resolveSkill(sheet(), 'Swordplay')).toEqual({ name: 'Swordplay', rank: 'Capable' });
  });
  it('a Skill not on the sheet is attempted Untrained', () => {
    expect(resolveSkill(sheet(), 'Lockpicking')).toEqual({ name: 'Lockpicking', rank: 'Untrained' });
  });
});

describe('editCard', () => {
  it('the actor fills Want, Risk and proposes ranks on a quick roll', () => {
    const c = editCard(fresh(), ilse, { difficulty: 'Demanding', danger: 'Serious', dangerKind: 'other' }, sheet());
    expect([c.difficulty, c.danger]).toEqual(['Demanding', 'Serious']);
  });
  it('on a big roll only the GM sets ranks', () => {
    const big = fresh({ onTheLine: 'b3' });
    expect(() => editCard(big, ilse, { difficulty: 'Hard' }, sheet())).toThrow(RuleViolation);
    expect(editCard(big, gm, { difficulty: 'Hard', danger: 'Severe' }, sheet()).difficulty).toBe('Hard');
  });
  it('nobody else can edit someone else\'s card; the GM can', () => {
    expect(() => editCard(fresh(), sella, { want: 'x' }, sheet())).toThrow(/not your card/i);
    expect(editCard(fresh(), gm, { want: 'x' }, sheet()).want).toBe('x');
  });
  it('putting a Belief on the line makes the card big and the Danger a Burden', () => {
    const c = editCard(fresh(), ilse, { onTheLine: 'b3' }, sheet());
    expect(c.speed).toBe('big');
    expect(c.dangerKind).toBe('burden');
  });
  it('rejects a Belief that is not on the sheet', () => {
    expect(() => editCard(fresh(), ilse, { onTheLine: 'nope' }, sheet())).toThrow(/Belief/);
    expect(() => editCard(fresh(), ilse, { backingBeliefId: 'nope' }, sheet())).toThrow(/Belief/);
  });
  it('only a draft can be edited', () => {
    const set = closeSet(filled(), ilse, sheet());
    expect(() => editCard(set, ilse, { want: 'x' }, sheet())).toThrow(/draft/i);
  });
});

describe('suggestShifts and expandShifts', () => {
  const keys = (c: Character, ctx = {}) => suggestShifts(c, ctx).map((s) => s.key);
  it('offers Traits, possessions, wounds and Standing from the sheet', () => {
    const k = keys(sheet());
    expect(k).toEqual(expect.arrayContaining(['trait:tr-help:skill', 'trait:tr-help:opposition', 'trait:t2:skill', 'possession:pos1', 'wound:w1', 'standing:Royal Army', 'standing:Cathedral']));
  });
  it('a harmful Trait works against the character, a helpful one for them', () => {
    const s = suggestShifts(sheet(), {});
    expect(s.find((x) => x.key === 'trait:t2:skill')!.shifts).toEqual([expect.objectContaining({ ladder: 'skill', delta: -1 })]);
    expect(s.find((x) => x.key === 'trait:tr-help:skill')!.shifts).toEqual([expect.objectContaining({ ladder: 'skill', delta: 1 })]);
  });
  it('offers a strained version of a Wounded wound only', () => {
    const c = { ...sheet(), wounds: [{ id: 'w2', level: 'Wounded' as const, name: 'Deep gash', isExhaustion: false }] };
    expect(keys(c)).toEqual(expect.arrayContaining(['wound:w2', 'wound:w2:strain']));
    expect(keys(sheet())).not.toContain('wound:w1:strain');
  });
  it('offers armor only against a threat it can stop, with the Danger rank in hand', () => {
    expect(keys(sheet(), { threat: 'blade', danger: 'Serious' })).toContain('armor');
    expect(keys(sheet(), { threat: 'fire', danger: 'Serious' })).not.toContain('armor');
    expect(keys(sheet(), { threat: 'blade', danger: 'Severe' })).not.toContain('armor'); // Light stops Real and Serious only
  });
  it('expands chosen keys into shifts and refuses keys that are not offered', () => {
    const r = expandShifts(sheet(), { threat: null, danger: 'Real' }, ['possession:pos1'], []);
    expect(r.shifts).toEqual([expect.objectContaining({ source: 'possession', ladder: 'skill', delta: 1 })]);
    expect(() => expandShifts(sheet(), {}, ['trait:made-up:skill'], [])).toThrow(RuleViolation);
  });
  it('manual shifts are limited to helping, preparation, gear and magic (magic needs a tradition)', () => {
    const ok = expandShifts(sheet(), {}, [], [{ ladder: 'skill', delta: 1, source: 'preparation', reason: 'scouted the wall' }]);
    expect(ok.shifts).toHaveLength(1);
    expect(() => expandShifts(sheet(), {}, [], [{ ladder: 'skill', delta: 1, source: 'trait' as never, reason: 'invented' }])).toThrow(RuleViolation);
    expect(() => expandShifts(sheet(), {}, [], [{ ladder: 'difficulty', delta: -1, source: 'magic', reason: 'spell' }])).toThrow(/tradition/i);
  });
});

describe('previewCard and closeSet', () => {
  it('previews odds in words once ranks are named, and says what is missing before that', () => {
    expect(previewCard(fresh(), sheet()).problems).toContain('Name a Difficulty and a Danger');
    const p = previewCard(filled(), sheet());
    expect(p.problems).toEqual([]);
    expect(p.odds?.goal.word).toBe('Even'); // Capable vs Demanding
  });
  it('closes Set on a quick card for the actor, and fixes severity', () => {
    const c = closeSet(filled({ danger: 'Severe', dangerKind: 'wound' }), ilse, sheet());
    expect(c.status).toBe('set');
    expect(c.set?.worstWound).toBe('Critical');
  });
  it('closes Set on a big card only for the GM', () => {
    const big = filled({ onTheLine: 'b3', speed: 'big', dangerKind: 'burden' });
    expect(() => closeSet(big, ilse, sheet())).toThrow(RuleViolation);
    expect(closeSet(big, gm, sheet()).status).toBe('set');
  });
  it('applies chosen shifts, including the edge rule', () => {
    const c = closeSet(filled({ danger: 'Minor', threat: 'blade', shiftKeys: ['possession:pos1'] }), ilse, { ...sheet(), armor: 'heavy' });
    expect(c.set?.skill).toBe('Expert'); // possession up
    const armored = closeSet(filled({ danger: 'Minor', threat: 'blade' }), ilse, { ...sheet(), armor: 'heavy', wounds: [] });
    expect(armored.set?.skill).toBe('Capable'); // heavy armor offered but only applied if chosen
    const chosen = closeSet(filled({ danger: 'Minor', threat: 'blade', shiftKeys: ['armor'] }), ilse, { ...sheet(), armor: 'heavy', wounds: [] });
    expect(chosen.set?.skill).toBe('Expert'); // armor against Minor shifts the Skill up
  });
  it('a Core Belief backs only when it is on the line; otherwise it backs as a Belief', () => {
    const onLine = closeSet(filled({ onTheLine: 'b3', backingBeliefId: 'b3', speed: 'big', dangerKind: 'burden' }), gm, sheet());
    expect(onLine.set?.backing).toBe('core');
    const off = closeSet(filled({ backingBeliefId: 'b3' }), ilse, sheet());
    expect(off.set?.backing).toBe('belief');
    expect(closeSet(filled({ backingBeliefId: 'b1' }), ilse, sheet()).set?.backing).toBe('belief');
  });
  it('requires Want, Risk and both ranks', () => {
    expect(() => closeSet({ ...filled(), want: '' }, ilse, sheet())).toThrow(/Want/);
    expect(() => closeSet({ ...filled(), difficulty: null }, ilse, sheet())).toThrow(/Difficulty/);
  });
});

describe('roll, push, concede', () => {
  const set = () => closeSet(filled(), ilse, sheet());
  it('rolls a Set card for the actor or the GM, not for anyone else', () => {
    expect(() => rollCard(set(), sella, scriptedDice([5, 3, 6]))).toThrow(RuleViolation);
    const r = rollCard(set(), ilse, scriptedDice([5, 3, 6]));
    expect(r.status).toBe('rolled');
    expect(r.roll?.outcome).toBe('successWithCost');
    expect(rollCard(set(), gm, scriptedDice([5, 3, 2])).roll?.outcome).toBe('cleanSuccess');
  });
  it('cannot roll a draft or roll twice', () => {
    expect(() => rollCard(filled(), ilse, scriptedDice([1, 1, 1]))).toThrow(/Set/);
    expect(() => rollCard(rollCard(set(), ilse, scriptedDice([5, 3, 6])), ilse, scriptedDice([1, 1, 1]))).toThrow(RuleViolation);
  });
  it('offers a push only after a failed goal, once', () => {
    const failed = rollCard(set(), ilse, scriptedDice([2, 6, 1]));
    expect(pushOptions(failed, sheet())).toEqual({ available: true, standard: true, conviction: true });
    expect(pushOptions(failed, { ...sheet(), conviction: 0 })).toEqual({ available: true, standard: true, conviction: false });
    const won = rollCard(set(), ilse, scriptedDice([8, 1, 1]));
    expect(pushOptions(won, sheet()).available).toBe(false);
  });
  it('a standard push rechecks an avoided Danger one rank worse and the severity stays', () => {
    const failed = rollCard(closeSet(filled({ danger: 'Severe', dangerKind: 'wound' }), ilse, sheet()), ilse, scriptedDice([4, 6, 3]));
    const r = pushCard(failed, ilse, 'standard', scriptedDice([8, 1, 12]), sheet());
    expect(r.card.roll?.recheck?.rank).toBe('Grave');
    expect(r.card.roll?.severity).toBe('Severe');
    expect(r.card.roll?.worstWound).toBe('Critical');
    expect(r.character.conviction).toBe(sheet().conviction);
  });
  it('a Conviction push spends a token and rechecks nothing', () => {
    const failed = rollCard(set(), ilse, scriptedDice([4, 6, 3]));
    const r = pushCard(failed, ilse, 'conviction', scriptedDice([8, 1]), sheet());
    expect(r.character.conviction).toBe(sheet().conviction - 1);
    expect(r.card.roll?.recheck).toBeUndefined();
  });
  it('a Conviction push without a token is refused before any die is thrown', () => {
    const failed = rollCard(set(), ilse, scriptedDice([4, 6, 3]));
    const dice = scriptedDice([8, 1]);
    expect(() => pushCard(failed, ilse, 'conviction', dice, { ...sheet(), conviction: 0 })).toThrow(RuleViolation);
    expect(dice.remaining()).toBe(2);
  });
  it('only the actor (or GM) pushes, and a second push is refused', () => {
    const failed = rollCard(set(), ilse, scriptedDice([4, 6, 3]));
    expect(() => pushCard(failed, sella, 'standard', scriptedDice([1, 1, 1]), sheet())).toThrow(RuleViolation);
    const once = pushCard(failed, ilse, 'conviction', scriptedDice([1, 1]), sheet()).card;
    expect(() => pushCard(once, ilse, 'standard', scriptedDice([1, 1, 1]), sheet())).toThrow(RuleViolation);
  });
  it('concedes at Set or instead of pushing, but not after a success', () => {
    expect(concede(set(), ilse, 'surrender').status).toBe('conceded');
    expect(concede(filled(), ilse, 'escape').concession).toBe('escape');
    const failed = rollCard(set(), ilse, scriptedDice([2, 6, 1]));
    expect(concede(failed, ilse, 'capture').status).toBe('conceded');
    const won = rollCard(set(), ilse, scriptedDice([8, 1, 1]));
    expect(() => concede(won, ilse, 'surrender')).toThrow(RuleViolation);
    expect(CONCESSION_KINDS).toContain('a debt owed');
    expect(() => concede(set(), ilse, 'made up' as never)).toThrow(RuleViolation);
  });
});

describe('outcomePrompt (Rules v4 3.5-3.6)', () => {
  const prompt = (dice: number[], over: Partial<PromptCard> = {}) => {
    const r = rollCard(closeSet(filled(over), ilse, sheet()), ilse, scriptedDice(dice));
    return outcomePrompt(r);
  };
  it('states what must be true, never finished prose', () => {
    expect(prompt([8, 1, 1]).headline).toBe('Clean success. Write how you get it.');
    expect(prompt([5, 3, 6]).headline).toBe('Success, with the cost. Write how you get it; then the cost lands: I twist an ankle.');
    expect(prompt([2, 6, 1]).headline).toBe('Failure, no cost. Write how it slips away and what changes.');
    expect(prompt([2, 6, 8]).headline).toBe('Failure, and the cost lands: I twist an ankle. Write both.');
  });
  it('adds Flourish and Room to spare to a success, and Belief success when a Belief backed it', () => {
    const p = prompt([8, 1, 1]);
    expect(p.voice).toEqual(expect.arrayContaining(['flourish', 'roomToSpare']));
    expect(p.lines.join(' ')).toContain('What do you do with the room?');
    const b = prompt([8, 1, 1, 1], { backingBeliefId: 'b1' }); // Skill, backing, Difficulty, Danger
    expect(b.voice).toContain('beliefSuccess');
  });
  it('adds no success voice to a failure', () => {
    expect(prompt([2, 6, 1]).voice).toEqual([]);
  });
  it('after a standard push names the Danger that was checked again, in rank words', () => {
    const first = rollCard(closeSet(filled({ danger: 'Severe', dangerKind: 'wound' }), ilse, sheet()), ilse, scriptedDice([4, 6, 3]));
    const p = outcomePrompt(pushCard(first, ilse, 'standard', scriptedDice([2, 6, 5]), sheet()).card);
    expect(p.recheckNote).toBe('You pushed: the Danger was checked again at Grave.');
  });
  it('names who writes a cost that lands on another character', () => {
    const r = rollCard(closeSet(filled({ dangerTargetId: 'sella-pc', speed: 'big' }), gm, sheet()), ilse, scriptedDice([5, 3, 6]));
    expect(outcomePrompt(r, { targetName: 'Sella' }).lines.join(' ')).toContain('Sella writes the cost');
  });
});

describe('written and costs', () => {
  const rolled = (dice: number[], over: Partial<PromptCard> = {}) => rollCard(closeSet(filled(over), ilse, sheet()), ilse, scriptedDice(dice));
  it('only the actor marks an outcome written', () => {
    expect(() => markWritten(rolled([8, 1, 1]), sella, { outcomeParagraphId: 'p2' })).toThrow(RuleViolation);
    const w = markWritten(rolled([8, 1, 1]), ilse, { outcomeParagraphId: 'p2' });
    expect(w.status).toBe('written');
    expect(w.written?.outcomeParagraphId).toBe('p2');
  });
  it('cannot be written before it is rolled or conceded', () => {
    expect(() => markWritten(closeSet(filled(), ilse, sheet()), ilse, { outcomeParagraphId: 'p2' })).toThrow(RuleViolation);
    expect(markWritten(concede(filled(), ilse, 'surrender'), ilse, { outcomeParagraphId: 'p2' }).status).toBe('written');
  });
  it('a landed wound is named by the writer and may be lesser, never worse than severity', () => {
    const c = rolled([2, 6, 8], { danger: 'Serious', dangerKind: 'wound' }); // Serious: worst Wounded
    const ok = applyCosts(sheet(), c, { woundId: 'w9', woundName: 'Bruised ribs', woundLevel: 'Hurt' });
    expect(ok.wounds.at(-1)).toMatchObject({ id: 'w9', level: 'Hurt', name: 'Bruised ribs' });
    expect(() => applyCosts(sheet(), c, { woundId: 'w9', woundName: 'Broken leg', woundLevel: 'Critical' })).toThrow(/worse/i);
    expect(applyCosts(sheet(), c, { woundId: 'w9', woundName: 'Deep gash' }).wounds.at(-1)?.level).toBe('Wounded'); // default: the worst
  });
  it('a landed Burden is named after the roll and refused past two', () => {
    const c = rollCard(closeSet(filled({ onTheLine: 'b1', backingBeliefId: 'b1', speed: 'big', dangerKind: 'burden', danger: 'Serious' }), gm, sheet()), ilse, scriptedDice([1, 1, 7, 8]));
    expect(c.roll?.dangerHit).toBe(true);
    const out = applyCosts(sheet(), c, { burdenId: 'bd1', burdenName: 'Doubts the Oath' });
    expect(out.burdens.at(-1)).toMatchObject({ beliefId: 'b1', name: 'Doubts the Oath', status: 'active' });
    const two = { ...out, burdens: [...out.burdens, { id: 'bd2', beliefId: 'b2', name: 'x', about: '', status: 'active' as const }] };
    expect(() => applyCosts(two, c, { burdenId: 'bd3', burdenName: 'Third' })).toThrow(/third Burden/i);
  });
  it('requires naming the Burden, and applies nothing when the Danger missed or landed on someone else', () => {
    const hit = rollCard(closeSet(filled({ onTheLine: 'b1', speed: 'big', dangerKind: 'burden' }), gm, sheet()), ilse, scriptedDice([1, 7, 8]));
    expect(() => applyCosts(sheet(), hit, {})).toThrow(/Burden/);
    const miss = rolled([8, 1, 1]);
    expect(applyCosts(sheet(), miss, {})).toEqual(sheet());
    const other = rollCard(closeSet(filled({ dangerTargetId: 'sella-pc', speed: 'big', dangerKind: 'wound' }), gm, sheet()), ilse, scriptedDice([5, 3, 6]));
    expect(applyCosts(sheet(), other, {})).toEqual(sheet());
  });
});

describe('revertCosts (a retcon undoes what the first roll did)', () => {
  it('removes the wound and refunds a Conviction push', () => {
    const failed = rollCard(closeSet(filled({ danger: 'Serious', dangerKind: 'wound' }), ilse, sheet()), ilse, scriptedDice([2, 6, 3]));
    const pushed = pushCard(failed, ilse, 'conviction', scriptedDice([1, 6]), sheet()); // spends the token; the retry also fails
    const hit = rollCard(closeSet(filled({ danger: 'Serious', dangerKind: 'wound' }), ilse, sheet()), ilse, scriptedDice([2, 6, 8]));
    const afterCost = applyCosts(sheet(), hit, { woundName: 'Bruised ribs' });
    expect(afterCost.wounds).toHaveLength(2);
    expect(revertCosts(afterCost, hit).wounds).toHaveLength(1); // back to the seed's one Hurt
    expect(revertCosts({ ...pushed.character }, pushed.card).conviction).toBe(sheet().conviction); // 1 spent, 1 refunded
  });
  it('removes a Burden added by the roll, and never exceeds the Conviction cap', () => {
    const c = rollCard(closeSet(filled({ onTheLine: 'b1', dangerKind: 'burden' }), gm, sheet()), ilse, scriptedDice([1, 7, 8]));
    const after = applyCosts(sheet(), c, { burdenName: 'Doubts the Oath' });
    expect(after.burdens).toHaveLength(1);
    expect(revertCosts(after, c).burdens).toHaveLength(0);
    const capped = rollCard(closeSet(filled(), ilse, sheet()), ilse, scriptedDice([2, 6, 1]));
    const pushed = pushCard(capped, ilse, 'conviction', scriptedDice([1, 1]), sheet());
    expect(revertCosts({ ...pushed.character, conviction: 3 }, pushed.card).conviction).toBe(3);
  });
  it('does nothing for a roll that cost nothing', () => {
    const clean = rollCard(closeSet(filled(), ilse, sheet()), ilse, scriptedDice([8, 1, 1]));
    expect(revertCosts(sheet(), clean)).toEqual(sheet());
  });
});

describe('retcon', () => {
  const written = (over: Partial<PromptCard> = {}) =>
    markWritten(rollCard(closeSet(filled(over), ilse, sheet()), ilse, scriptedDice([5, 3, 6])), ilse, { outcomeParagraphId: 'p2' });
  it('lets the GM reopen a written quick roll as a draft, clearing the dice', () => {
    const r = reopenForRetcon(written(), gm);
    expect(r).toMatchObject({ status: 'draft', roll: null, set: null, written: null, retcons: 1, revealed: false });
  });
  it('is the GM only, and quick rolls only', () => {
    expect(() => reopenForRetcon(written(), ilse)).toThrow(RuleViolation);
    const big = markWritten(rollCard(closeSet(filled({ onTheLine: 'b1', dangerKind: 'burden' }), gm, sheet()), ilse, scriptedDice([5, 3, 6])), ilse, { outcomeParagraphId: 'p2' });
    expect(() => reopenForRetcon(big, gm)).toThrow(/quick/i);
    expect(() => reopenForRetcon(rollCard(closeSet(filled(), ilse, sheet()), ilse, scriptedDice([5, 3, 6])), gm)).toThrow(RuleViolation);
  });
});

describe('public view: dice stay hidden until revealed', () => {
  const rolled = () => rollCard(closeSet(filled(), ilse, sheet()), ilse, scriptedDice([5, 3, 6]));
  const scan = (v: unknown): string => JSON.stringify(v);
  it('carries ranks and words, and no dice or numeric odds', () => {
    const p = toPublicCard(rolled());
    expect(p).toMatchObject({ status: 'rolled', difficulty: 'Demanding', danger: 'Serious', odds: { goal: 'Even', danger: 'Even' }, outcome: 'successWithCost' });
    const s = scan(p);
    for (const key of ['skillDie', 'backingDie', 'difficultyDie', 'kept', 'hits', 'total']) expect(s).not.toContain(`"${key}"`);
    expect(p.dice).toBeNull();
  });
  it('declaring a Danger Mortal is a public fact, set at Set', () => {
    expect(toPublicCard({ ...filled({ danger: 'Grave', declaredMortal: true }) }).declaredMortal).toBe(true);
    expect(toPublicCard(filled()).declaredMortal).toBe(false);
  });
  it('reveal publishes the dice view', () => {
    const p = toPublicCard({ ...rolled(), revealed: true });
    expect(p.dice).toMatchObject({ skill: { sides: 8, value: 5 }, difficulty: { sides: 8, value: 3 }, danger: { sides: 8, value: 6 }, kept: 5 });
  });
  it('diceView lists a push and a recheck too', () => {
    const first = rollCard(closeSet(filled({ danger: 'Severe', dangerKind: 'wound' }), ilse, sheet()), ilse, scriptedDice([4, 6, 3]));
    const pushed = pushCard(first, ilse, 'standard', scriptedDice([8, 1, 12]), sheet()).card;
    const v = diceView(pushed.roll!);
    expect(v.second).toMatchObject({ skill: { value: 8 } });
    expect(v.recheck).toMatchObject({ rank: 'Grave', sides: 12, value: 12 });
  });
});

it('a character with no trait of the right kind still produces an empty suggestion list', () => {
  expect(suggestShifts(newCharacter('x', 'X'), {})).toEqual([]);
});
