import { describe, expect, it } from 'vitest';
import {
  RuleViolation, offerChapter, pickChapterGrants, objectToPick, acceptProposal, addCreatingCharacter, addReadyCharacter, addWorldFact, beginPlay, canRoll, chooseHook, chooseOutput, confirmCrossing,
  declineCrossing, draftProblems, emptyWorld, endCheck, finishCreation, gmResolveGrant, importDraft, majorityOf, overrideCheck, pickOrigin,
  postChapter, postOrigin, proposeCrossing, proposeSkill, proposeTrait, withdrawVote, setBeliefs, setCapital, setInstincts, setVeteran, setWorldFact, startingBurden, swapGrant,
  othersOf, slotState, newCharacter, type CreationWorld, type CreationActor,
} from '../src';

const gm: CreationActor = { id: 'gm1', role: 'gm' };
const p = (id: string): CreationActor => ({ id, role: 'player' });
const [ilse, sella, rook] = [p('ilse'), p('sella'), p('rook')];
const cid = (user: string) => `${user}-pc`;

function table(users = ['ilse', 'sella', 'rook']): CreationWorld {
  return users.reduce((w, u) => addCreatingCharacter(w, { userId: u, name: u[0]!.toUpperCase() + u.slice(1) }), emptyWorld());
}
const fails = (fn: () => unknown, code?: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleViolation); if (code) expect((e as RuleViolation).code).toBe(code); return; }
  throw new Error('expected a RuleViolation');
};
const sheet = (w: CreationWorld, user: string) => w.characters[cid(user)]!;
const st = (w: CreationWorld, user: string) => w.creation[cid(user)]!;

/** Ilse: origin, then chapters 0..2 posted (the second is the bad one). */
function withChapters(w: CreationWorld, user: string, paras: string[], bad = 1): CreationWorld {
  const a = p(user);
  w = postOrigin(w, a, { paragraphId: `${user}-o` });
  paras.forEach((para, i) => { w = postChapter(w, a, { paragraphId: para, summary: `Chapter ${i + 1} of ${user}`, endsBadly: i === bad }); });
  return w;
}

describe('joining and the roll gate', () => {
  it('a new player has a blank character in creation, owned by them, who cannot roll yet', () => {
    const w = table();
    expect(sheet(w, 'ilse')).toMatchObject({ id: 'ilse-pc', name: 'Ilse', ownerId: 'ilse', skills: [], wealthRung: 1, networkRung: 1 });
    expect(st(w, 'ilse')).toMatchObject({ status: 'creating', veteran: false, chapters: [] });
    expect(canRoll(w, 'ilse-pc')).toBe(false);
  });
  it('a ready-made character is ready at once (preset dev users, the dev skip route)', () => {
    const w = addReadyCharacter(emptyWorld(), { ...newCharacter('ilse-pc', 'Ilse'), ownerId: 'ilse' });
    expect(canRoll(w, 'ilse-pc')).toBe(true);
  });
  it('joining twice does not make a second character', () => {
    const w = addCreatingCharacter(table(), { userId: 'ilse', name: 'Ilse again' });
    expect(Object.keys(w.characters)).toHaveLength(3);
    expect(sheet(w, 'ilse').name).toBe('Ilse');
  });
  it('lists the other players, never the writer or anyone who left', () => {
    let w = table();
    expect(othersOf(w, 'ilse-pc').sort()).toEqual(['rook', 'sella']);
    w = { ...w, characters: { ...w.characters, 'rook-pc': { ...w.characters['rook-pc']!, left: true } } };
    expect(othersOf(w, 'ilse-pc')).toEqual(['sella']);
  });
});

describe('the world fact (step 0)', () => {
  it('the GM writes exactly one table-wide fact into the Canon; rewriting replaces it', () => {
    let w = setWorldFact(table(), gm, 'The Border War ended in a treaty nobody trusts.');
    expect(w.canon).toEqual([expect.objectContaining({ kind: 'worldFact', authorId: 'gm1', source: { type: 'gm' } })]);
    w = setWorldFact(w, gm, 'The war is not over.');
    expect(w.canon).toHaveLength(1);
    expect(w.canon[0]!.text).toBe('The war is not over.');
  });
  it('only the GM, and only text', () => {
    fails(() => setWorldFact(table(), ilse, 'x'), 'NOT_ALLOWED');
    fails(() => setWorldFact(table(), gm, '  '), 'BAD_INPUT');
  });
});

describe('origin (step 1)', () => {
  it('posts the origin paragraph and picks one Skill at Trained and one Connection', () => {
    let w = postOrigin(table(), ilse, { paragraphId: 'o1' });
    w = pickOrigin(w, ilse, { skill: 'Sneak', connection: 'My sister Wren, still in the village' });
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Sneak', rank: 'Trained' }]);
    expect(sheet(w, 'ilse').connections).toEqual([expect.objectContaining({ text: 'My sister Wren, still in the village' })]);
    expect(st(w, 'ilse').origin).toMatchObject({ paragraphId: 'o1', skill: 'Sneak' });
  });
  it('the picks and the paragraph come in either order, and each only once', () => {
    let w = pickOrigin(table(), ilse, { skill: 'Sneak', connection: 'Wren' });
    w = postOrigin(w, ilse, { paragraphId: 'o1' });
    fails(() => pickOrigin(w, ilse, { skill: 'Climb', connection: 'x' }), 'ORIGIN_DONE');
    fails(() => postOrigin(w, ilse, { paragraphId: 'o2' }), 'ORIGIN_DONE');
  });
  it('is the owner\'s own step, and a paragraph can be used only once across the table', () => {
    const w = postOrigin(table(), ilse, { paragraphId: 'shared' });
    fails(() => postOrigin(w, sella, { paragraphId: 'shared' }), 'PARAGRAPH_USED');
    fails(() => postOrigin(table(), gm, { paragraphId: 'x' }), 'NO_CHARACTER');
  });
  it('rejects blank Skills and Connections', () => {
    fails(() => pickOrigin(table(), ilse, { skill: ' ', connection: 'x' }), 'BAD_INPUT');
    fails(() => pickOrigin(table(), ilse, { skill: 'Sneak', connection: '' }), 'BAD_INPUT');
  });
  it('veterans have four chapters; that is chosen before the first one is posted', () => {
    let w = setVeteran(table(), ilse, true);
    expect(st(w, 'ilse').veteran).toBe(true);
    w = withChapters(w, 'ilse', ['a', 'b', 'c']);
    fails(() => setVeteran(w, ilse, false), 'CHAPTERS_STARTED');
  });
});

describe('life chapters (step 2)', () => {
  it('posts chapters in order, up to three (four for a veteran), then no more', () => {
    let w = withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);
    expect(st(w, 'ilse').chapters.map((c) => c.index)).toEqual([0, 1, 2]);
    fails(() => postChapter(w, ilse, { paragraphId: 'c4', summary: 'x', endsBadly: false }), 'CHAPTERS_FULL');
    w = withChapters(setVeteran(table(), ilse, true), 'ilse', ['c1', 'c2', 'c3']);
    expect(() => postChapter(w, ilse, { paragraphId: 'c4', summary: 'The long years', endsBadly: false })).not.toThrow();
  });
  it('needs the origin posted first, and a one-line summary', () => {
    fails(() => postChapter(table(), ilse, { paragraphId: 'c1', summary: 'x', endsBadly: false }), 'ORIGIN_FIRST');
    const w = postOrigin(table(), ilse, { paragraphId: 'o' });
    fails(() => postChapter(w, ilse, { paragraphId: 'c1', summary: '', endsBadly: false }), 'BAD_INPUT');
    fails(() => postChapter(w, ilse, { paragraphId: 'c1', summary: 'x'.repeat(141), endsBadly: false }), 'BAD_INPUT');
  });
  it('the bad chapter is neither first nor most recent, and there is only one', () => {
    const w = postOrigin(table(), ilse, { paragraphId: 'o' });
    fails(() => postChapter(w, ilse, { paragraphId: 'c1', summary: 's', endsBadly: true }), 'BAD_CHAPTER_POSITION'); // first
    const two = postChapter(postChapter(w, ilse, { paragraphId: 'c1', summary: 's', endsBadly: false }), ilse, { paragraphId: 'c2', summary: 's', endsBadly: true });
    fails(() => postChapter(two, ilse, { paragraphId: 'c3', summary: 's', endsBadly: true }), 'BAD_CHAPTER_COUNT'); // a second bad one
    // With three chapters the third is the most recent, so only the second qualifies.
    const third = postChapter(postChapter(w, ilse, { paragraphId: 'd1', summary: 's', endsBadly: false }), ilse, { paragraphId: 'd2', summary: 's', endsBadly: false });
    fails(() => postChapter(third, ilse, { paragraphId: 'd3', summary: 's', endsBadly: true }), 'BAD_CHAPTER_POSITION');
  });
  it('a veteran\'s bad chapter may be the second or third', () => {
    let w = setVeteran(table(), ilse, true);
    w = postOrigin(w, ilse, { paragraphId: 'o' });
    w = postChapter(w, ilse, { paragraphId: 'c1', summary: 's', endsBadly: false });
    w = postChapter(w, ilse, { paragraphId: 'c2', summary: 's', endsBadly: false });
    expect(() => postChapter(w, ilse, { paragraphId: 'c3', summary: 's', endsBadly: true })).not.toThrow();
  });
  it('keeps the sheet\'s chapter list in step', () => {
    const w = withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);
    expect(sheet(w, 'ilse').chapters.map((c) => [c.summary, c.endsBadly])).toEqual([['Chapter 1 of ilse', false], ['Chapter 2 of ilse', true], ['Chapter 3 of ilse', false]]);
  });
});

describe('grant cards (7.3)', () => {
  const posted = () => withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);

  it('majority is more than half of the other players', () => {
    expect([1, 2, 3, 4].map(majorityOf)).toEqual([1, 2, 2, 3]);
  });
  it('with two players the other player decides at once', () => {
    const w0 = withChapters(table(['ilse', 'sella']), 'ilse', ['c1', 'c2', 'c3']);
    const w = proposeSkill(w0, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Climb', rank: 'Trained' }]);
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ by: 'other-player', name: 'Climb', toRank: 'Trained' });
  });
  it('with three players it takes both others to agree; the proposer counts as accepting their own', () => {
    let w = proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    const slot = st(w, 'ilse').chapters[0]!.skill;
    expect(slot.applied).toBeNull();
    expect(slot.proposals[0]!.accepts).toEqual(['sella']);
    expect(slotState(slot, 2)).toBe('open');
    w = acceptProposal(w, rook, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: slot.proposals[0]!.id });
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ by: 'majority', name: 'Climb' });
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Climb', rank: 'Trained' }]);
  });
  it('different proposals tie, and the GM breaks the tie', () => {
    let w = proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    w = proposeSkill(w, rook, { characterId: 'ilse-pc', chapter: 0, skill: 'Persuade', mode: 'new' });
    const slot = st(w, 'ilse').chapters[0]!.skill;
    expect(slotState(slot, 2)).toBe('tied');
    w = gmResolveGrant(w, gm, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: slot.proposals[1]!.id });
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ by: 'gm', name: 'Persuade' });
    expect(sheet(w, 'ilse').skills.map((s) => s.name)).toEqual(['Persuade']);
  });
  it('the GM can also enter a grant outright when nobody has proposed', () => {
    const w = gmResolveGrant(posted(), gm, { characterId: 'ilse-pc', chapter: 0, part: 'trait', value: 'Quick Tempered' });
    expect(sheet(w, 'ilse').traits).toEqual([expect.objectContaining({ text: 'Quick Tempered', harmful: false, source: { type: 'chapter', index: 0 } })]);
    fails(() => gmResolveGrant(posted(), ilse, { characterId: 'ilse-pc', chapter: 0, part: 'trait', value: 'x' }), 'NOT_ALLOWED');
  });
  it('moving your vote to another proposal does not count twice', () => {
    let w = proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    w = proposeSkill(w, rook, { characterId: 'ilse-pc', chapter: 0, skill: 'Persuade', mode: 'new' });
    const [a, b] = st(w, 'ilse').chapters[0]!.skill.proposals;
    w = acceptProposal(w, rook, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: a!.id }); // rook moves to sella's
    const slot = st(w, 'ilse').chapters[0]!.skill;
    expect(slot.applied).toMatchObject({ name: 'Climb' });
    expect(slot.proposals.find((x) => x.id === b!.id)?.accepts ?? []).not.toContain('rook');
  });
  it('a player can withdraw their own vote; an unbacked proposal falls away, a backed one stays', () => {
    let w = proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    w = withdrawVote(w, sella, { characterId: 'ilse-pc', chapter: 0, part: 'skill' });
    expect(st(w, 'ilse').chapters[0]!.skill.proposals).toEqual([]);
    fails(() => withdrawVote(w, sella, { characterId: 'ilse-pc', chapter: 0, part: 'skill' }), 'NO_VOTE');
    fails(() => withdrawVote(w, ilse, { characterId: 'ilse-pc', chapter: 0, part: 'skill' }), 'NOT_ALLOWED');
  });
  it('only another player proposes or accepts: not the writer, not the GM, not a stranger', () => {
    const w = posted();
    fails(() => proposeSkill(w, ilse, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' }), 'NOT_ALLOWED');
    fails(() => proposeSkill(w, gm, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' }), 'NOT_ALLOWED');
    fails(() => proposeTrait(w, p('stranger'), { characterId: 'ilse-pc', chapter: 0, trait: 'x' }), 'NOT_ALLOWED');
    const one = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    fails(() => acceptProposal(one, ilse, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: st(one, 'ilse').chapters[0]!.skill.proposals[0]!.id }), 'NOT_ALLOWED');
  });
  it('a new Skill comes in at Trained; a raise lifts an existing one a rank, never past Expert', () => {
    let w = pickOrigin(posted(), ilse, { skill: 'Sneak', connection: 'Wren' });
    w = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'sneak', mode: 'raise' });
    w = acceptProposal(w, rook, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: st(w, 'ilse').chapters[0]!.skill.proposals[0]!.id });
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Sneak', rank: 'Capable' }]);
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ mode: 'raise', fromRank: 'Trained', toRank: 'Capable' });
    const up = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 1, skill: 'Sneak', mode: 'raise' });
    w = acceptProposal(up, rook, { characterId: 'ilse-pc', chapter: 1, part: 'skill', proposalId: st(up, 'ilse').chapters[1]!.skill.proposals[0]!.id });
    fails(() => proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 2, skill: 'Sneak', mode: 'raise' }), 'SKILL_CAP');
    expect(sheet(w, 'ilse').skills[0]!.rank).toBe('Expert');
  });
  it('refuses a new Skill that is already there, and a raise of a Skill that is not', () => {
    const w = pickOrigin(posted(), ilse, { skill: 'Sneak', connection: 'Wren' });
    fails(() => proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Sneak', mode: 'new' }), 'SKILL_EXISTS');
    fails(() => proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'raise' }), 'NO_SUCH_SKILL');
  });
  it('the bad chapter\'s Trait is harmful', () => {
    const w = gmResolveGrant(posted(), gm, { characterId: 'ilse-pc', chapter: 1, part: 'trait', value: 'Haunted by the siege' });
    expect(sheet(w, 'ilse').traits[0]).toMatchObject({ harmful: true, source: { type: 'chapter', index: 1 } });
  });
  it('a chapter that does not exist, or a grant already applied, is refused', () => {
    fails(() => proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 5, skill: 'Climb', mode: 'new' }), 'NO_SUCH_CHAPTER');
    const done = proposeSkill(withChapters(table(['ilse', 'sella']), 'ilse', ['c1', 'c2', 'c3']), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    fails(() => proposeSkill(done, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Ride', mode: 'new' }), 'GRANT_APPLIED');
  });
});

describe('the swap', () => {
  const granted = () => {
    let w = withChapters(table(['ilse', 'sella']), 'ilse', ['c1', 'c2', 'c3']);
    w = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    return proposeTrait(w, sella, { characterId: 'ilse-pc', chapter: 0, trait: 'Steady Hands' });
  };
  it('reopens one granted Skill or Trait once for all of creation, taking its effect off the sheet', () => {
    let w = swapGrant(granted(), ilse, { chapter: 0, part: 'skill' });
    expect(sheet(w, 'ilse').skills).toEqual([]);
    expect(st(w, 'ilse')).toMatchObject({ swapUsed: true });
    expect(st(w, 'ilse').chapters[0]!.skill).toMatchObject({ applied: null, proposals: [], reopened: true });
    w = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Ride', mode: 'new' });
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Ride', rank: 'Trained' }]);
    fails(() => swapGrant(w, ilse, { chapter: 0, part: 'trait' }), 'SWAP_USED');
  });
  it('can swap a Trait; undoes a raise to the old rank', () => {
    const w = swapGrant(granted(), ilse, { chapter: 0, part: 'trait' });
    expect(sheet(w, 'ilse').traits).toEqual([]);
    expect(sheet(w, 'ilse').skills).toEqual([{ name: 'Climb', rank: 'Trained' }]); // the Skill is untouched
  });
  it('only the writer, and only a grant that has been applied', () => {
    fails(() => swapGrant(granted(), gm, { chapter: 0, part: 'skill' }), 'NO_CHARACTER');
    fails(() => swapGrant(withChapters(table(), 'ilse', ['c1', 'c2', 'c3']), ilse, { chapter: 0, part: 'skill' }), 'NOTHING_TO_SWAP');
  });
});

describe('chapter output (7.2): a Connection, a Resource or a Thread', () => {
  const posted = () => withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);
  it('a Connection is added to the sheet, naming a character if the writer chooses', () => {
    const w = chooseOutput(posted(), ilse, { chapter: 0, output: { kind: 'connection', text: 'Captain Aldous, who taught me the sword', withCharacterId: 'sella-pc' } });
    expect(sheet(w, 'ilse').connections).toEqual([expect.objectContaining({ text: 'Captain Aldous, who taught me the sword', withCharacterId: 'sella-pc' })]);
    expect(sheet(w, 'ilse').chapters[0]!.pick).toBe('connection');
  });
  it('a Resource raises Wealth or Network a rung, up to the top', () => {
    let w = chooseOutput(posted(), ilse, { chapter: 0, output: { kind: 'resource', raise: 'network', text: 'A guild friend' } });
    expect(sheet(w, 'ilse')).toMatchObject({ networkRung: 2, wealthRung: 1 });
    w = { ...w, characters: { ...w.characters, 'ilse-pc': { ...sheet(w, 'ilse'), wealthRung: 4 } } };
    w = chooseOutput(w, ilse, { chapter: 2, output: { kind: 'resource', raise: 'wealth', text: 'x' } });
    expect(sheet(w, 'ilse').wealthRung).toBe(4);
  });
  it('a Thread is unfinished business, remembered as coming from that chapter', () => {
    const w = chooseOutput(posted(), ilse, { chapter: 1, output: { kind: 'thread', text: 'The captain wants me silenced' } });
    expect(sheet(w, 'ilse').threads).toEqual([expect.objectContaining({ text: 'The captain wants me silenced', source: { type: 'chapter', index: 1 } })]);
  });
  it('the bad chapter must leave a Thread', () => {
    fails(() => chooseOutput(posted(), ilse, { chapter: 1, output: { kind: 'connection', text: 'x' } }), 'BAD_CHAPTER_THREAD');
  });
  it('is chosen once, by the writer, with text', () => {
    const w = chooseOutput(posted(), ilse, { chapter: 0, output: { kind: 'connection', text: 'x' } });
    fails(() => chooseOutput(w, ilse, { chapter: 0, output: { kind: 'thread', text: 'y' } }), 'OUTPUT_CHOSEN');
    fails(() => chooseOutput(posted(), sella, { chapter: 0, output: { kind: 'connection', text: 'x' } }), 'NO_SUCH_CHAPTER');
    fails(() => chooseOutput(posted(), ilse, { chapter: 0, output: { kind: 'connection', text: ' ' } }), 'BAD_INPUT');
  });
});

describe('world facts (step 3)', () => {
  const posted = () => withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);
  it('one per chapter, into the Canon, written by the chapter\'s author', () => {
    const w = addWorldFact(posted(), ilse, { chapter: 0, text: 'The treaty ended the war, and nobody trusts it.' });
    expect(w.canon.at(-1)).toMatchObject({ kind: 'worldFact', authorId: 'ilse', source: { type: 'chapter', characterId: 'ilse-pc', index: 0 } });
    expect(st(w, 'ilse').chapters[0]!.factId).toBe(w.canon.at(-1)!.id);
    fails(() => addWorldFact(w, ilse, { chapter: 0, text: 'Another' }), 'FACT_EXISTS');
    fails(() => addWorldFact(posted(), sella, { chapter: 0, text: 'x' }), 'NO_SUCH_CHAPTER');
  });
  it('a fact that names a community prompts a Standing word', () => {
    const w = addWorldFact(posted(), ilse, { chapter: 0, text: 'The Cathedral keeps the ledgers.', community: 'Cathedral' });
    expect(st(w, 'ilse').standingPrompts).toEqual(['Cathedral']);
  });
});

describe('crossing paths (step 4)', () => {
  const ready = () => {
    let w = withChapters(table(), 'ilse', ['i1', 'i2', 'i3']);
    w = withChapters(w, 'sella', ['s1', 's2', 's3']);
    return withChapters(w, 'rook', ['r1', 'r2', 'r3']);
  };
  const propose = (w: CreationWorld, by: CreationActor, over: Record<string, unknown> = {}) =>
    proposeCrossing(w, by, { toCharacterId: 'sella-pc', fromChapter: 0, toChapter: 1, paragraphId: 'x1', touchesBelief: true, fromConnection: 'Sella, who pulled me from the river', toConnection: 'Ilse, who owes me a debt', ...over } as never);

  it('needs the other player to confirm; then both sheets get the Connection and the crossing', () => {
    let w = propose(ready(), ilse);
    expect(w.proposals).toEqual([expect.objectContaining({ status: 'pending', from: 'ilse-pc', to: 'sella-pc' })]);
    expect(sheet(w, 'sella').connections).toEqual([]);
    w = confirmCrossing(w, sella, { proposalId: w.proposals[0]!.id });
    expect(sheet(w, 'ilse').connections.at(-1)).toMatchObject({ text: 'Sella, who pulled me from the river', withCharacterId: 'sella-pc' });
    expect(sheet(w, 'sella').connections.at(-1)).toMatchObject({ text: 'Ilse, who owes me a debt', withCharacterId: 'ilse-pc' });
    expect(sheet(w, 'ilse').crossings).toEqual([{ withCharacterId: 'sella-pc', myChapter: 0, theirChapter: 1, touchesBelief: true }]);
    expect(sheet(w, 'sella').crossings).toEqual([{ withCharacterId: 'ilse-pc', myChapter: 1, theirChapter: 0, touchesBelief: true }]);
    expect(w.proposals[0]!.status).toBe('confirmed');
  });
  it('adds at most one Thread between them, to both', () => {
    let w = propose(ready(), ilse, { thread: 'We both saw the duke\'s man at the bridge' });
    w = confirmCrossing(w, sella, { proposalId: w.proposals[0]!.id });
    for (const u of ['ilse', 'sella']) expect(sheet(w, u).threads).toEqual([expect.objectContaining({ text: 'We both saw the duke\'s man at the bridge', source: { type: 'crossing' } })]);
  });
  it('can be declined, which changes nothing', () => {
    let w = propose(ready(), ilse);
    w = declineCrossing(w, sella, { proposalId: w.proposals[0]!.id });
    expect(w.proposals[0]!.status).toBe('declined');
    expect(sheet(w, 'ilse').crossings).toEqual([]);
  });
  it('only the other player confirms or declines; the proposer cannot confirm their own', () => {
    const w = propose(ready(), ilse);
    fails(() => confirmCrossing(w, ilse, { proposalId: w.proposals[0]!.id }), 'NOT_ALLOWED');
    fails(() => confirmCrossing(w, rook, { proposalId: w.proposals[0]!.id }), 'NOT_ALLOWED');
    fails(() => declineCrossing(w, rook, { proposalId: w.proposals[0]!.id }), 'NOT_ALLOWED');
  });
  it('both chapters must exist, the partner must be another player, and a paragraph is used once', () => {
    fails(() => propose(ready(), ilse, { toChapter: 5 }), 'NO_SUCH_CHAPTER');
    fails(() => propose(ready(), ilse, { fromChapter: 5 }), 'NO_SUCH_CHAPTER');
    fails(() => propose(ready(), ilse, { toCharacterId: 'ilse-pc' }), 'BAD_INPUT');
    fails(() => propose(ready(), ilse, { toCharacterId: 'nobody' }), 'NO_CHARACTER');
    fails(() => propose(ready(), ilse, { paragraphId: 'i1' }), 'PARAGRAPH_USED');
  });
  it('is two crossings each, so nobody is left out', () => {
    let w = ready();
    w = propose(w, ilse, { paragraphId: 'x1' }); w = confirmCrossing(w, sella, { proposalId: w.proposals.at(-1)!.id });
    w = propose(w, ilse, { toCharacterId: 'rook-pc', paragraphId: 'x2', toChapter: 0 }); w = confirmCrossing(w, rook, { proposalId: w.proposals.at(-1)!.id });
    fails(() => propose(w, ilse, { toCharacterId: 'rook-pc', paragraphId: 'x3', toChapter: 2 }), 'CROSSINGS_FULL'); // ilse has two
    fails(() => propose(w, sella, { toCharacterId: 'ilse-pc', paragraphId: 'x4' }), 'CROSSINGS_FULL'); // and so cannot take a third
  });
});

describe('capital, Beliefs, Instincts, hook (steps 5-8)', () => {
  it('sets Standing words and up to three possessions with a line of story each', () => {
    const w = setCapital(table(), ilse, { standing: { Cathedral: 'Distrusted', 'Royal Army': 'Respected' }, possessions: [{ name: "Father's Sword", story: 'Carried through the Border War.' }] });
    expect(sheet(w, 'ilse').standing).toEqual({ Cathedral: 'Distrusted', 'Royal Army': 'Respected' });
    expect(sheet(w, 'ilse').possessions).toEqual([expect.objectContaining({ name: "Father's Sword", story: 'Carried through the Border War.' })]);
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, story: 's' }));
    fails(() => setCapital(table(), ilse, { standing: {}, possessions: four }), 'TOO_MANY_POSSESSIONS');
    fails(() => setCapital(table(), ilse, { standing: {}, possessions: [{ name: 'x', story: '' }] }), 'BAD_INPUT');
    fails(() => setCapital(table(), ilse, { standing: { X: 'Famous' as never }, possessions: [] }), 'BAD_INPUT');
  });
  it('three Beliefs: an objective, a relationship and a worldview, which is the Core', () => {
    const w = setBeliefs(table(), ilse, [
      { kind: 'objective', text: 'Expose the duke before the council meets' }, { kind: 'relationship', text: 'I will not leave Sella behind' }, { kind: 'worldview', text: 'Oaths outlast the people who swear them' },
    ]);
    expect(sheet(w, 'ilse').beliefs.map((b) => [b.kind, b.isCore])).toEqual([['objective', false], ['relationship', false], ['worldview', true]]);
    fails(() => setBeliefs(table(), ilse, [{ kind: 'objective', text: 'a' }, { kind: 'objective', text: 'b' }, { kind: 'worldview', text: 'c' }]), 'BAD_INPUT');
    fails(() => setBeliefs(table(), ilse, [{ kind: 'objective', text: ' ' }, { kind: 'relationship', text: 'b' }, { kind: 'worldview', text: 'c' }]), 'BAD_INPUT');
  });
  it('three Instincts', () => {
    expect(sheet(setInstincts(table(), ilse, ['Check the exits', 'Sit facing the door', 'Count the guards']), 'ilse').instincts).toHaveLength(3);
    fails(() => setInstincts(table(), ilse, ['one', 'two']), 'BAD_INPUT');
  });
  it('the hook is one of the character\'s own Threads', () => {
    let w = withChapters(table(), 'ilse', ['c1', 'c2', 'c3']);
    w = chooseOutput(w, ilse, { chapter: 1, output: { kind: 'thread', text: 'The captain wants me silenced' } });
    const id = sheet(w, 'ilse').threads[0]!.id;
    expect(st(chooseHook(w, ilse, { threadId: id }), 'ilse').hookThreadId).toBe(id);
    fails(() => chooseHook(w, ilse, { threadId: 'nope' }), 'NO_SUCH_THREAD');
  });
  it('a bad chapter that tested a Belief lets the writer start with a Burden, once, after Beliefs exist', () => {
    let w = postOrigin(table(), ilse, { paragraphId: 'o' });
    w = postChapter(w, ilse, { paragraphId: 'c1', summary: 's', endsBadly: false });
    w = postChapter(w, ilse, { paragraphId: 'c2', summary: 'I let the smuggler go', endsBadly: true, testedBelief: true });
    fails(() => startingBurden(w, ilse, { beliefId: 'ilse-pc-b-worldview', name: 'Doubts the Oath' }), 'NO_SUCH_BELIEF');
    w = setBeliefs(w, ilse, [{ kind: 'objective', text: 'a' }, { kind: 'relationship', text: 'b' }, { kind: 'worldview', text: 'c' }]);
    const beliefId = sheet(w, 'ilse').beliefs[2]!.id;
    w = startingBurden(w, ilse, { beliefId, name: 'Doubts the Oath' });
    expect(sheet(w, 'ilse').burdens).toEqual([expect.objectContaining({ name: 'Doubts the Oath', beliefId, status: 'active' })]);
    fails(() => startingBurden(w, ilse, { beliefId, name: 'Again' }), 'BURDEN_CHOSEN');
    fails(() => startingBurden(withChapters(table(), 'sella', ['a', 'b', 'c']), sella, { beliefId: 'x', name: 'y' }), 'NO_TESTED_BELIEF');
  });
});

/** Run one character all the way through. Returns the world. */
function complete(w: CreationWorld, user: string, others: string[]): CreationWorld {
  const me = p(user);
  const c = cid(user);
  const paras = [`${user}-1`, `${user}-2`, `${user}-3`];
  w = withChapters(w, user, paras);
  w = pickOrigin(w, me, { skill: 'Persuade', connection: `${user}'s family` });
  const pick = (i: number): never => ({ 0: { kind: 'connection', text: `${user} met someone`, withCharacterId: cid(others[0]!) }, 1: { kind: 'thread', text: `${user} has an enemy` }, 2: { kind: 'resource', raise: 'wealth', text: `${user} saved coin` } } as never)[i] as never;
  [0, 1, 2].forEach((i) => { w = chooseOutput(w, me, { chapter: i, output: pick(i) }); });
  // The first other player proposes; with two others a second accepts. Skills: one raise to Capable (index 0), the rest new.
  const grantors = others.map(p);
  [0, 1, 2].forEach((i) => {
    const skill = i === 0 ? { skill: 'Persuade', mode: 'raise' as const } : { skill: ['', 'Lore', 'Ride'][i]!, mode: 'new' as const };
    w = proposeSkill(w, grantors[0]!, { characterId: c, chapter: i, ...skill });
    for (const g of grantors.slice(1)) if (w.creation[c]!.chapters[i]!.skill.applied === null) w = acceptProposal(w, g, { characterId: c, chapter: i, part: 'skill', proposalId: w.creation[c]!.chapters[i]!.skill.proposals[0]!.id });
    w = proposeTrait(w, grantors[0]!, { characterId: c, chapter: i, trait: `Trait ${i} of ${user}` });
    for (const g of grantors.slice(1)) if (w.creation[c]!.chapters[i]!.trait.applied === null) w = acceptProposal(w, g, { characterId: c, chapter: i, part: 'trait', proposalId: w.creation[c]!.chapters[i]!.trait.proposals[0]!.id });
    w = addWorldFact(w, me, { chapter: i, text: `A fact about ${user} ${i}.` });
  });
  w = setCapital(w, me, { standing: {}, possessions: [{ name: 'A knife', story: 'Always with me.' }] });
  w = setBeliefs(w, me, [{ kind: 'objective', text: `${user} wants a thing` }, { kind: 'relationship', text: `${user} loves someone` }, { kind: 'worldview', text: `${user} believes` }]);
  w = setInstincts(w, me, ['a', 'b', 'c']);
  return chooseHook(w, me, { threadId: w.characters[c]!.threads[0]!.id });
}
function cross(w: CreationWorld, a: string, b: string, n: number, touches: boolean): CreationWorld {
  w = proposeCrossing(w, p(a), { toCharacterId: cid(b), fromChapter: 0, toChapter: 1, paragraphId: `x-${a}-${b}-${n}`, touchesBelief: touches, fromConnection: `${b} from the road`, toConnection: `${a} from the road` });
  return confirmCrossing(w, p(b), { proposalId: w.proposals.at(-1)!.id });
}

const everyone = () => complete(complete(complete(table(), 'ilse', ['sella', 'rook']), 'sella', ['ilse', 'rook']), 'rook', ['ilse', 'sella']);

describe('the end-of-creation check and Begin play', () => {
  it('lists exactly what is missing for a new character', () => {
    const codes = endCheck(table(), 'ilse-pc').problems.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['ORIGIN_UNPOSTED', 'ORIGIN_PICKS', 'CHAPTER_COUNT', 'NO_CAPABLE_SKILL', 'CONNECTIONS', 'NO_THREAD', 'CROSSINGS', 'BELIEFS', 'INSTINCTS', 'HOOK']));
    expect(endCheck(table(), 'ilse-pc').passed).toBe(false);
  });
  it('a character who has done everything passes; one pending grant or output does not', () => {
    let w = everyone();
    w = cross(w, 'ilse', 'sella', 1, true); w = cross(w, 'ilse', 'rook', 2, false);
    expect(endCheck(w, 'ilse-pc')).toMatchObject({ passed: true, problems: [] });
    const missing = { ...w, creation: { ...w.creation, 'ilse-pc': { ...st(w, 'ilse'), chapters: st(w, 'ilse').chapters.map((c, i) => (i === 0 ? { ...c, output: null } : c)) } } };
    expect(endCheck(missing, 'ilse-pc').problems.map((x) => x.code)).toContain('OUTPUT_PENDING');
  });
  it('finishing creation needs a passed check and makes the character ready to roll', () => {
    let w = everyone();
    fails(() => finishCreation(w, ilse), 'CHECK_FAILED');
    w = cross(w, 'ilse', 'sella', 1, true); w = cross(w, 'ilse', 'rook', 2, false);
    w = finishCreation(w, ilse);
    expect(st(w, 'ilse').status).toBe('ready');
    expect(canRoll(w, 'ilse-pc')).toBe(true);
    fails(() => finishCreation(w, ilse), 'ALREADY_READY');
  });
  it('the GM can override a failed check; it is recorded with the problems and the reason', () => {
    let w = overrideCheck(table(), gm, { characterId: 'rook-pc', reason: 'A deliberately odd character', at: '2026-10-07T12:00:00Z' });
    expect(st(w, 'rook').status).toBe('ready');
    expect(w.overrides).toEqual([expect.objectContaining({ gmId: 'gm1', characterId: 'rook-pc', reason: 'A deliberately odd character', at: '2026-10-07T12:00:00Z', problems: expect.any(Array) })]);
    expect(w.overrides[0]!.problems.length).toBeGreaterThan(0);
    fails(() => overrideCheck(table(), ilse, { characterId: 'ilse-pc', reason: 'x', at: 'now' }), 'NOT_ALLOWED');
    fails(() => overrideCheck(table(), gm, { characterId: 'ilse-pc', reason: ' ', at: 'now' }), 'BAD_INPUT');
  });
  it('Begin play needs the GM, and every present character ready; then the campaign is playing', () => {
    let w = table(['ilse', 'sella']);
    fails(() => beginPlay(w, ilse), 'NOT_ALLOWED');
    fails(() => beginPlay(w, gm), 'NOT_READY');
    w = overrideCheck(w, gm, { characterId: 'ilse-pc', reason: 'ok', at: 't' });
    fails(() => beginPlay(w, gm), 'NOT_READY');
    w = overrideCheck(w, gm, { characterId: 'sella-pc', reason: 'ok', at: 't' });
    w = beginPlay(w, gm);
    expect(w.phase).toBe('playing');
    fails(() => beginPlay(w, gm), 'ALREADY_PLAYING');
  });
  it('a character who left does not hold up Begin play; an empty table cannot begin', () => {
    fails(() => beginPlay(emptyWorld(), gm), 'NOT_READY');
    let w = table(['ilse', 'sella']);
    w = overrideCheck(w, gm, { characterId: 'ilse-pc', reason: 'ok', at: 't' });
    w = { ...w, characters: { ...w.characters, 'sella-pc': { ...w.characters['sella-pc']!, left: true } } };
    expect(beginPlay(w, gm).phase).toBe('playing');
  });
  it('after play begins, a new player starts creating and is the only one who cannot roll', () => {
    let w = overrideCheck(table(['ilse']), gm, { characterId: 'ilse-pc', reason: 'ok', at: 't' });
    w = beginPlay(w, gm);
    w = addCreatingCharacter(w, { userId: 'wren', name: 'Wren' });
    expect(canRoll(w, 'ilse-pc')).toBe(true);
    expect(canRoll(w, 'wren-pc')).toBe(false);
    expect(w.phase).toBe('playing');
  });
});

describe('a table of three completes creation (the acceptance walk-through)', () => {
  it('everyone passes the check, the GM begins play, and all three can roll', () => {
    let w = setWorldFact(table(), gm, 'The Border War ended in a treaty nobody trusts.');
    w = complete(w, 'ilse', ['sella', 'rook']);
    w = complete(w, 'sella', ['ilse', 'rook']);
    w = complete(w, 'rook', ['ilse', 'sella']);
    // a swap along the way: Sella has second thoughts about a Trait Ilse's friends gave her
    w = swapGrant(w, sella, { chapter: 2, part: 'trait' });
    w = gmResolveGrant(w, gm, { characterId: 'sella-pc', chapter: 2, part: 'trait', value: 'Cannot Back Down' });
    // crossings: two each (ilse-sella, ilse-rook, sella-rook)
    w = cross(w, 'ilse', 'sella', 1, true);
    w = cross(w, 'ilse', 'rook', 2, false);
    w = cross(w, 'sella', 'rook', 3, true);
    for (const u of ['ilse', 'sella', 'rook']) { expect(endCheck(w, cid(u)).problems, u).toEqual([]); w = finishCreation(w, p(u)); }
    w = beginPlay(w, gm);
    expect(w.phase).toBe('playing');
    for (const u of ['ilse', 'sella', 'rook']) expect(canRoll(w, cid(u))).toBe(true);
    expect(w.canon).toHaveLength(1 + 9); // the table's fact and one per chapter
    expect(sheet(w, 'sella').traits.map((t) => t.text)).toContain('Cannot Back Down');
    expect(st(w, 'sella').swapUsed).toBe(true);
    expect(sheet(w, 'ilse').skills.find((s) => s.name === 'Persuade')?.rank).toBe('Capable'); // raised once by the first grant
  });
});

describe('solo drafts (7.1)', () => {
  const draft = () => ({ veteran: false, origin: { paragraphId: 'd0' }, chapters: [
    { paragraphId: 'd1', summary: 'The farm', endsBadly: false }, { paragraphId: 'd2', summary: 'The siege', endsBadly: true, testedBelief: true }, { paragraphId: 'd3', summary: 'The road', endsBadly: false },
  ] });
  it('says what a draft still needs', () => {
    expect(draftProblems(draft())).toEqual([]);
    expect(draftProblems({ ...draft(), origin: null })).toContain('Write the Origin and mark its paragraph');
    expect(draftProblems({ ...draft(), chapters: draft().chapters.slice(0, 2) })).toContain('Three Life Chapters are needed (four for a veteran)');
    expect(draftProblems({ ...draft(), chapters: draft().chapters.map((c) => ({ ...c, endsBadly: false })) })).toContain('Exactly one chapter must end badly');
    expect(draftProblems({ ...draft(), chapters: draft().chapters.map((c, i) => ({ ...c, endsBadly: i === 2 })) }).join()).toMatch(/second or third|not the first or the most recent/i);
    expect(draftProblems({ ...draft(), chapters: [{ paragraphId: 'd1', summary: '', endsBadly: false }, ...draft().chapters.slice(1)] })).toContain('Every chapter needs a one-line summary');
  });
  it('imports into the shared story: the origin and chapters are posted under the new paragraph ids, so the grant cards open', () => {
    const map = { d0: 'p-origin', d1: 'p-1', d2: 'p-2', d3: 'p-3' };
    const w = importDraft(table(), ilse, draft(), map);
    expect(st(w, 'ilse').origin.paragraphId).toBe('p-origin');
    expect(st(w, 'ilse').chapters.map((c) => [c.paragraphId, c.summary, c.endsBadly, c.testedBelief])).toEqual([
      ['p-1', 'The farm', false, false], ['p-2', 'The siege', true, true], ['p-3', 'The road', false, false],
    ]);
    expect(proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' }).creation['ilse-pc']!.chapters[0]!.skill.proposals).toHaveLength(1);
  });
  it('needs a complete, valid draft, session zero, and a character that has not started', () => {
    const map = { d0: 'a', d1: 'b', d2: 'c', d3: 'd' };
    fails(() => importDraft(table(), ilse, { ...draft(), origin: null }, map), 'DRAFT_INCOMPLETE');
    fails(() => importDraft(table(), ilse, draft(), { d0: 'a', d1: 'b', d2: 'c' }), 'BAD_INPUT'); // a paragraph with no mapping
    const started = postOrigin(table(), ilse, { paragraphId: 'o' });
    fails(() => importDraft(started, ilse, draft(), map), 'ALREADY_STARTED');
    const playing = { ...table(), phase: 'playing' as const };
    fails(() => importDraft(playing, ilse, draft(), map), 'SESSION_ZERO_ONLY');
  });
  it('a veteran draft needs four chapters', () => {
    const v = { ...draft(), veteran: true };
    expect(draftProblems(v)).toContain('Four Life Chapters are needed for a veteran');
    const four = { ...v, chapters: [...v.chapters, { paragraphId: 'd4', summary: 'More', endsBadly: false }] };
    expect(draftProblems(four)).toEqual([]);
    expect(st(importDraft(table(), ilse, four, { d0: 'a', d1: 'b', d2: 'c', d3: 'd', d4: 'e' }), 'ilse').veteran).toBe(true);
  });
});

describe('chapter offers and self-picked grants', () => {
  const posted = () => pickOrigin(withChapters(table(), 'ilse', ['c1', 'c2', 'c3']), ilse, { skill: 'Sneak', connection: 'Wren' });
  const gate = 'I stood the north gate for six winters, checking carts and toll papers at the border.';
  const offered = (w = posted(), chapter = 0, prose = gate) => offerChapter(w, ilse, { chapter, prose });
  const off = (w: CreationWorld, chapter = 0) => st(w, 'ilse').chapters[chapter]!.offer!;

  it('a close match offers the template lists; the bad chapter is offered the harmful Traits', () => {
    const w = offered();
    expect(off(w)).toMatchObject({ templateId: 'gate-warden', source: 'library', tier: 'close' });
    expect(off(w).skills).toContain('Gatekeeping');
    expect(off(offered(posted(), 1), 1).traits).toEqual(expect.arrayContaining(['Suspicious of Everyone']));
  });
  it('no match leaves nothing to pick from, so the old grant cards are the way', () => {
    const w = offered(posted(), 0, 'Zzz qqq xxx');
    expect(off(w)).toMatchObject({ templateId: null, tier: 'none', skills: [], traits: [] });
  });
  it('an AI-adapted list replaces the template lists and is validated', () => {
    const w = offerChapter(posted(), ilse, { chapter: 0, prose: gate, adapted: { skills: ['Border Law', 'Reading Papers'], traits: ['Unbribable'] } });
    expect(off(w)).toMatchObject({ source: 'ai', skills: ['Border Law', 'Reading Papers'], traits: ['Unbribable'], templateId: 'gate-warden' });
    fails(() => offerChapter(posted(), ilse, { chapter: 0, prose: gate, adapted: { skills: [''], traits: ['x'] } }), 'BAD_INPUT');
    fails(() => offerChapter(posted(), ilse, { chapter: 0, prose: gate, adapted: { skills: ['a', 'b', 'c', 'd', 'e'], traits: ['x'] } }), 'BAD_INPUT');
  });
  it('only the writer asks for an offer', () => {
    fails(() => offerChapter(posted(), sella, { chapter: 0, prose: gate }), 'NO_SUCH_CHAPTER');
  });
  it('picking a Skill and a Trait from the offer applies both at once, by the writer', () => {
    const w = pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'gatekeeping', trait: 'Watchful' });
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ by: 'self', name: 'Gatekeeping', toRank: 'Trained' });
    expect(st(w, 'ilse').chapters[0]!.trait.applied).toMatchObject({ by: 'self', text: 'Watchful' });
    expect(sheet(w, 'ilse').skills.map((s) => s.name)).toContain('Gatekeeping');
  });
  it('a value that is not in the offer is refused unless the writer says it is their own', () => {
    fails(() => pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'Dragon Slaying', trait: 'Watchful' }), 'NOT_OFFERED');
    const w = pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'Dragon Slaying', skillOwn: true, trait: 'Watchful' });
    expect(sheet(w, 'ilse').skills.map((s) => s.name)).toContain('Dragon Slaying');
  });
  it('one self-chosen raise to Capable is available, on the Origin Skill, once', () => {
    let w = offered();
    expect(off(w).raise).toBe('Sneak');
    w = pickChapterGrants(w, ilse, { chapter: 0, skill: 'Sneak', raise: true, trait: 'Watchful' });
    expect(sheet(w, 'ilse').skills).toContainEqual({ name: 'Sneak', rank: 'Capable' });
    expect(st(w, 'ilse').selfRaiseUsed).toBe(true);
    const second = offerChapter(w, ilse, { chapter: 1, prose: gate });
    expect(off(second, 1).raise).toBeUndefined();
    fails(() => pickChapterGrants(second, ilse, { chapter: 1, skill: 'Sneak', raise: true, trait: 'Hard to Fool' }), 'RAISE_NOT_AVAILABLE');
  });
  it('another player can object: the pick is undone, the slot reopens for proposals, and the writer keeps their swap', () => {
    let w = pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'Sneak', raise: true, trait: 'Watchful' });
    w = objectToPick(w, sella, { characterId: 'ilse-pc', chapter: 0, part: 'skill' });
    const ch = st(w, 'ilse').chapters[0]!;
    expect(ch.skill).toMatchObject({ applied: null, reopened: true, proposals: [] });
    expect(sheet(w, 'ilse').skills).toContainEqual({ name: 'Sneak', rank: 'Trained' });
    expect(st(w, 'ilse').selfRaiseUsed).toBe(false);
    expect(st(w, 'ilse').swapUsed).toBe(false);
    w = proposeSkill(w, sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    w = acceptProposal(w, rook, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: st(w, 'ilse').chapters[0]!.skill.proposals[0]!.id });
    expect(st(w, 'ilse').chapters[0]!.skill.applied).toMatchObject({ by: 'majority', name: 'Climb' });
  });
  it('only another player objects, and only to a pick the writer made themselves', () => {
    const w = pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'Gatekeeping', trait: 'Watchful' });
    fails(() => objectToPick(w, ilse, { characterId: 'ilse-pc', chapter: 0, part: 'skill' }), 'NOT_ALLOWED');
    fails(() => objectToPick(w, gm, { characterId: 'ilse-pc', chapter: 0, part: 'skill' }), 'NOT_ALLOWED');
    const agreed = proposeSkill(posted(), sella, { characterId: 'ilse-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    const done = acceptProposal(agreed, rook, { characterId: 'ilse-pc', chapter: 0, part: 'skill', proposalId: st(agreed, 'ilse').chapters[0]!.skill.proposals[0]!.id });
    fails(() => objectToPick(done, sella, { characterId: 'ilse-pc', chapter: 0, part: 'skill' }), 'NOT_SELF_PICKED');
  });
  it('a pick cannot overwrite a grant that is already settled', () => {
    const w = pickChapterGrants(offered(), ilse, { chapter: 0, skill: 'Gatekeeping', trait: 'Watchful' });
    fails(() => pickChapterGrants(w, ilse, { chapter: 0, skill: 'Hold the Line', trait: 'Stoic' }), 'GRANT_APPLIED');
  });
});
