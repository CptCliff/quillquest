import { describe, expect, it } from 'vitest';
import { RuleViolation, type Character } from '@quillquest/rules';
import type { Cell, StoryDoc } from '@quillquest/story';
import type { Identity } from '../src/auth';
import { QueuedDice } from '../src/game/dice';
import { GameError } from '../src/game/errors';
import { GameService, type DocPort, type LedgerEntry } from '../src/game/service';
import { MemoryGameStore } from '../src/game/store';

const ILSE: Identity = { id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' };
const SELLA: Identity = { id: 'sella', name: 'Sella', role: 'player', color: '#1d4ed8' };
const GM: Identity = { id: 'gm1', name: 'GM', role: 'gm', color: '#15803d' };
const C = 'table-1';

const cells = (t: string): Cell[] => [...t].map((ch) => ({ ch, ins: null, del: null, fmt: '' }));
const para = (id: string, authorId: string, text = 'x', locked = false) => ({ paragraphId: id, authorId, pov: 'own', locked, cells: cells(text) });

class FakeDocs implements DocPort {
  doc: StoryDoc = [para('p1', 'ilse', 'I reach the wall.'), para('p2', 'ilse', 'I climb.')];
  published: { ledger: Record<string, LedgerEntry>; characters: Record<string, Character> } | null = null;
  lockCalls: { ids: string[]; locked: boolean }[] = [];
  async story() { return structuredClone(this.doc); }
  async setLocked(_c: string, ids: string[], locked: boolean) {
    this.lockCalls.push({ ids, locked });
    this.doc = this.doc.map((p) => (ids.includes(p.paragraphId) ? { ...p, locked } : p));
  }
  async publish(_c: string, projection: FakeDocs['published']) { this.published = structuredClone(projection); }
}

function setup() {
  const docs = new FakeDocs();
  const dice = new QueuedDice();
  const now = () => new Date('2026-10-07T12:00:00Z');
  const svc = new GameService({ store: new MemoryGameStore(), dice, docs, now });
  return { svc, docs, dice };
}

/** Open a quick card for Ilse with ranks filled in. dangerKind 'other' unless told otherwise. */
async function quickCard(t: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const card = await t.svc.createCard(C, ILSE, { skillName: 'Climb', anchorParagraphId: 'p1', want: 'Climb the wall', risk: 'I twist an ankle' });
  return t.svc.editCard(C, ILSE, card.id, { difficulty: 'Demanding', danger: 'Serious', dangerKind: 'other', dangerText: 'I twist an ankle', ...over });
}
const reject = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e);

describe('quick roll, end to end', () => {
  it('opens a card from the sheet, rolls in one tap, and gives the outcome prompt', async () => {
    const t = setup();
    const card = await quickCard(t);
    expect(card).toMatchObject({ status: 'draft', speed: 'quick', skillName: 'Climb', skillRank: 'Capable' });
    t.dice.queue(C, [5, 3, 6]); // Skill, Difficulty, Danger (Capable d8 vs Demanding d8, Serious d8)
    const rolled = await t.svc.roll(C, ILSE, card.id);
    expect(rolled).toMatchObject({ status: 'rolled', outcome: 'successWithCost', odds: { goal: 'Even', danger: 'Even' } });
    const p = await t.svc.prompt(C, ILSE, card.id);
    expect(p.prompt?.headline).toBe('Success, with the cost. Write how you get it; then the cost lands: I twist an ankle.');
    expect(p.push.available).toBe(false);
  });

  it('writing the outcome locks the story from the start through that paragraph', async () => {
    const t = setup();
    const card = await quickCard(t);
    t.dice.queue(C, [8, 1, 1]);
    await t.svc.roll(C, ILSE, card.id);
    const written = await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' });
    expect(written.status).toBe('written');
    expect(written.written?.lockedParagraphIds).toEqual(['p1', 'p2']);
    expect(t.docs.doc.every((p) => p.locked)).toBe(true);
    expect(t.docs.published?.ledger[card.id]).toMatchObject({ status: 'written', seq: 0 });
  });

  it('a landed wound is named by the writer and recorded on the sheet', async () => {
    const t = setup();
    const card = await quickCard(t, { dangerKind: 'wound' });
    t.dice.queue(C, [2, 6, 8]); // goal fails, Danger lands
    await t.svc.roll(C, ILSE, card.id);
    await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2', woundName: 'Twisted ankle', woundLevel: 'Hurt' });
    const me = (await t.svc.me(C, ILSE)).character!;
    expect(me.wounds).toEqual([expect.objectContaining({ name: 'Twisted ankle', level: 'Hurt' })]);
  });

  it('a refused cost leaves nothing behind: no lock, no wound, card still rolled', async () => {
    const t = setup();
    const card = await quickCard(t, { dangerKind: 'wound' });
    t.dice.queue(C, [2, 6, 8]);
    await t.svc.roll(C, ILSE, card.id);
    const err = await reject(t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2', woundLevel: 'Critical', woundName: 'Broken leg' }));
    expect(err).toBeInstanceOf(RuleViolation);
    expect(t.docs.lockCalls).toEqual([]);
    expect((await t.svc.me(C, ILSE)).character!.wounds).toEqual([]);
    expect((t.docs.published?.ledger[card.id] as LedgerEntry).status).toBe('rolled');
  });

  it('checks the outcome paragraph: it must exist, be yours, be unlocked, and not precede the action', async () => {
    const t = setup();
    const card = await quickCard(t);
    t.dice.queue(C, [8, 1, 1]);
    await t.svc.roll(C, ILSE, card.id);
    t.docs.doc.push(para('p3', 'sella', 'Sella speaks.'));
    expect((await reject(t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'zzz' })) as GameError).code).toBe('NO_SUCH_PARAGRAPH');
    expect((await reject(t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p3' })) as GameError).code).toBe('NOT_YOUR_PARAGRAPH');
    t.docs.doc[1] = { ...t.docs.doc[1]!, locked: true };
    expect((await reject(t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' })) as GameError).code).toBe('ALREADY_LOCKED');
  });

  it('keeps dice out of the public projection until Reveal', async () => {
    const t = setup();
    const card = await quickCard(t);
    t.dice.queue(C, [5, 3, 6]);
    await t.svc.roll(C, ILSE, card.id);
    const hidden = JSON.stringify(t.docs.published);
    for (const key of ['skillDie', 'backingDie', 'difficultyDie', 'kept', 'hits', '"total"', '"value"', '"sides"']) expect(hidden).not.toContain(key);
    expect((t.docs.published!.ledger[card.id] as LedgerEntry).dice).toBeNull();
    await t.svc.reveal(C, SELLA, card.id); // any player may reveal
    const shown = t.docs.published!.ledger[card.id] as LedgerEntry;
    expect(shown.dice).toMatchObject({ skill: { value: 5 }, difficulty: { value: 3 }, danger: { value: 6 }, kept: 5 });
  });
});

describe('big roll', () => {
  const big = async (t: ReturnType<typeof setup>) => {
    const card = await t.svc.createCard(C, ILSE, { skillName: 'Sneak', anchorParagraphId: 'p1', want: 'Slip past the guard', risk: 'I doubt the oath', onTheLine: 'ilse-core', backingBeliefId: 'ilse-core' });
    return card;
  };
  it('putting a Belief on the line makes it big: the player cannot set ranks or roll a draft; the GM sets, then the player rolls', async () => {
    const t = setup();
    const card = await big(t);
    expect(card).toMatchObject({ speed: 'big', dangerKind: 'burden' });
    expect(await reject(t.svc.editCard(C, ILSE, card.id, { difficulty: 'Hard' }))).toBeInstanceOf(RuleViolation);
    expect((await reject(t.svc.roll(C, ILSE, card.id)) as GameError).code).toBe('NOT_SET');
    await t.svc.editCard(C, GM, card.id, { difficulty: 'Hard', danger: 'Serious', dangerText: 'I doubt the oath' });
    expect(await reject(t.svc.closeSet(C, ILSE, card.id))).toBeInstanceOf(RuleViolation);
    const set = await t.svc.closeSet(C, GM, card.id);
    expect(set).toMatchObject({ status: 'set', backing: 'core', severity: 'Serious' });
    expect((await reject(t.svc.roll(C, GM, 'nope')) as GameError).code).toBe('NO_CARD');
    // Expert Sneak d10 + core backing d8 vs Hard d10, Serious d8: dice Skill, backing, Difficulty, Danger
    t.dice.queue(C, [9, 2, 3, 1]);
    expect((await t.svc.roll(C, ILSE, card.id)).outcome).toBe('cleanSuccess');
  });

  it('a failed goal can be pushed once: standard rechecks one rank worse, Conviction spends a token and rechecks nothing', async () => {
    const t = setup();
    const card = await big(t);
    await t.svc.editCard(C, GM, card.id, { difficulty: 'Hard', danger: 'Severe', dangerText: 'I doubt the oath' });
    await t.svc.closeSet(C, GM, card.id);
    t.dice.queue(C, [2, 1, 9, 1]); // goal fails, Danger avoided
    const first = await t.svc.roll(C, ILSE, card.id);
    expect(first).toMatchObject({ outcome: 'failureNoCost', push: 'none' });
    expect((await t.svc.prompt(C, ILSE, card.id)).push).toEqual({ available: true, standard: true, conviction: true });

    t.dice.queue(C, [9, 2, 1, 10]); // retry: skill, backing, difficulty; recheck at Grave d12 -> 10 beats kept 9
    const pushed = await t.svc.push(C, ILSE, card.id, 'standard');
    expect(pushed).toMatchObject({ push: 'standard', recheckRank: 'Grave', severity: 'Severe', outcome: 'successWithCost' });
    expect(await reject(t.svc.push(C, ILSE, card.id, 'conviction'))).toBeInstanceOf(RuleViolation);
    expect((await t.svc.me(C, ILSE)).character!.conviction).toBe(1); // a standard push is free
  });

  it('a Conviction push spends the token', async () => {
    const t = setup();
    const card = await big(t);
    await t.svc.editCard(C, GM, card.id, { difficulty: 'Hard', danger: 'Severe', dangerText: 'x' });
    await t.svc.closeSet(C, GM, card.id);
    t.dice.queue(C, [2, 1, 9, 1]);
    await t.svc.roll(C, ILSE, card.id);
    t.dice.queue(C, [9, 2, 1]);
    const pushed = await t.svc.push(C, ILSE, card.id, 'conviction');
    expect(pushed.recheckRank).toBeNull();
    expect((await t.svc.me(C, ILSE)).character!.conviction).toBe(0);
  });

  it('a landed Burden is named after the roll; a third is refused', async () => {
    const t = setup();
    const card = await big(t);
    await t.svc.editCard(C, GM, card.id, { difficulty: 'Hard', danger: 'Serious', dangerText: 'I doubt the oath' });
    await t.svc.closeSet(C, GM, card.id);
    t.dice.queue(C, [2, 1, 9, 8]); // fails, Danger lands (8 > 2)
    await t.svc.roll(C, ILSE, card.id);
    expect(await reject(t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' }))).toBeInstanceOf(RuleViolation); // unnamed
    await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2', burdenName: 'Doubts the Oath' });
    const me = (await t.svc.me(C, ILSE)).character!;
    expect(me.burdens).toEqual([expect.objectContaining({ name: 'Doubts the Oath', beliefId: 'ilse-core', status: 'active' })]);
    // Lay it down: it becomes a Trait and earns Conviction.
    const after = await t.svc.layDownBurden(C, ILSE, 'ilse-pc', me.burdens[0]!.id, { kind: 'trait', traitId: 'tn', text: 'Keeps the Oath She Chose' });
    expect(after.conviction).toBe(2);
    expect(after.traits.at(-1)?.text).toBe('Keeps the Oath She Chose');
  });
});

describe('concession', () => {
  it('conceding at Set ends the card; the defeat is then written and locks the prose', async () => {
    const t = setup();
    const card = await quickCard(t);
    await t.svc.closeSet(C, ILSE, card.id);
    expect((await t.svc.concede(C, ILSE, card.id, 'surrender')).status).toBe('conceded');
    expect((await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' })).status).toBe('written');
    expect(t.docs.doc.every((p) => p.locked)).toBe(true);
  });
});

describe('retcon', () => {
  const written = async (t: ReturnType<typeof setup>, dice: number[], over: Record<string, unknown> = {}) => {
    const card = await quickCard(t, over);
    t.dice.queue(C, dice);
    await t.svc.roll(C, ILSE, card.id);
    await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2', woundName: 'Bruised ribs', woundLevel: 'Hurt' });
    return card;
  };
  it('the GM reopens a quick roll while nothing builds on it: costs undone, prose unlocked, override logged', async () => {
    const t = setup();
    const card = await written(t, [2, 6, 8], { dangerKind: 'wound' });
    expect((await t.svc.me(C, ILSE)).character!.wounds).toHaveLength(1);
    const reopened = await t.svc.retcon(C, GM, card.id);
    expect(reopened).toMatchObject({ status: 'draft', retcons: 1, outcome: null });
    expect((await t.svc.me(C, ILSE)).character!.wounds).toHaveLength(0);
    expect(t.docs.doc.some((p) => p.locked)).toBe(false);

    // The GM changes the ranks and the writer rolls again; the new outcome re-locks.
    await t.svc.editCard(C, GM, card.id, { difficulty: 'Ordinary' });
    t.dice.queue(C, [8, 1, 1]);
    expect((await t.svc.roll(C, ILSE, card.id)).outcome).toBe('cleanSuccess');
    await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' });
    expect(t.docs.doc.every((p) => p.locked)).toBe(true);
  });
  it('is refused once a later post builds on the outcome, and for anyone but the GM', async () => {
    const t = setup();
    const card = await written(t, [8, 1, 1]);
    expect((await reject(t.svc.retcon(C, ILSE, card.id)) as GameError).code).toBe('NOT_ALLOWED');
    t.docs.doc.push(para('p3', 'sella', 'Sella follows.'));
    expect((await reject(t.svc.retcon(C, GM, card.id)) as GameError).code).toBe('BUILT_ON');
    expect(t.docs.doc.slice(0, 2).every((p) => p.locked)).toBe(true);
  });
  it('a retcon refunds a Conviction push', async () => {
    const t = setup();
    const card = await quickCard(t);
    t.dice.queue(C, [2, 6, 1]);
    await t.svc.roll(C, ILSE, card.id);
    t.dice.queue(C, [8, 1]);
    await t.svc.push(C, ILSE, card.id, 'conviction');
    await t.svc.written(C, ILSE, card.id, { outcomeParagraphId: 'p2' });
    expect((await t.svc.me(C, ILSE)).character!.conviction).toBe(0);
    await t.svc.retcon(C, GM, card.id);
    expect((await t.svc.me(C, ILSE)).character!.conviction).toBe(1);
  });
});

describe('who may do what', () => {
  it('the GM has no character and opens no cards; any other player gets a starter character, named for them, owned by them', async () => {
    const t = setup();
    expect((await reject(t.svc.createCard(C, GM, { skillName: 'Climb' })) as GameError).status).toBe(403);
    const newcomer = { id: 'uuid-1234', name: 'Wren', role: 'player' as const, color: '#0e7490' };
    const me = (await t.svc.me(C, newcomer)).character!;
    expect(me).toMatchObject({ id: 'uuid-1234-pc', name: 'Wren', ownerId: 'uuid-1234' });
    expect(me.skills.length).toBeGreaterThan(0); // the first starter uses the first template
    const second = (await t.svc.me(C, { ...newcomer, id: 'uuid-5678', name: 'Pike' })).character!;
    expect(second.skills.map((s) => s.name)).not.toEqual(me.skills.map((s) => s.name)); // the next template
  });
  it('a player who leaves keeps their character, marked left; rejoining clears it', async () => {
    const t = setup();
    await t.svc.me(C, ILSE);
    await t.svc.onLeave(C, ILSE);
    expect(t.docs.published!.characters['ilse-pc']).toMatchObject({ left: true });
    await t.svc.onJoin(C, ILSE);
    expect(t.docs.published!.characters['ilse-pc']).toMatchObject({ left: false });
  });
  it('another player cannot edit, roll, push, concede on or write someone else\'s card', async () => {
    const t = setup();
    const card = await quickCard(t);
    await t.svc.closeSet(C, ILSE, card.id);
    for (const attempt of [
      () => t.svc.editCard(C, SELLA, card.id, { want: 'x' }),
      () => t.svc.roll(C, SELLA, card.id),
      () => t.svc.concede(C, SELLA, card.id, 'surrender'),
    ]) expect(await reject(attempt())).toBeInstanceOf(RuleViolation);
    t.dice.queue(C, [8, 1, 1]);
    await t.svc.roll(C, ILSE, card.id);
    expect((await reject(t.svc.written(C, SELLA, card.id, { outcomeParagraphId: 'p2' })) as GameError).status).toBe(403);
  });
  it('dice are GM-only until revealed, and cannot be revealed before they exist', async () => {
    const t = setup();
    const card = await quickCard(t);
    expect((await reject(t.svc.reveal(C, ILSE, card.id)) as GameError).code).toBe('NOT_ROLLED');
    t.dice.queue(C, [5, 3, 6]);
    await t.svc.roll(C, ILSE, card.id);
    expect((await reject(t.svc.dice(C, ILSE, card.id)) as GameError).status).toBe(403);
    expect(await t.svc.dice(C, GM, card.id)).toMatchObject({ skill: { sides: 8, value: 5 } });
  });
  it('only a character\'s player or the GM lays down its Burdens', async () => {
    const t = setup();
    await t.svc.me(C, ILSE);
    await t.svc.me(C, SELLA);
    expect(((await reject(t.svc.layDownBurden(C, SELLA, 'ilse-pc', 'x', { kind: 'trait', traitId: 't', text: 'y' }))) as GameError).status).toBe(403);
  });
});

describe('concurrency', () => {
  it('serializes mutations per campaign: parallel cards get distinct ids and all survive', async () => {
    const t = setup();
    const made = await Promise.all([1, 2, 3, 4, 5].map(() => t.svc.createCard(C, ILSE, { skillName: 'Climb' })));
    expect(new Set(made.map((c) => c.id)).size).toBe(5);
    expect(Object.keys(t.docs.published!.ledger)).toHaveLength(5);
  });
  it('a failed mutation does not block the next', async () => {
    const t = setup();
    await reject(t.svc.createCard(C, GM, { skillName: 'Climb' }));
    expect((await t.svc.createCard(C, ILSE, { skillName: 'Climb' })).id).toBe('c1');
  });
});
