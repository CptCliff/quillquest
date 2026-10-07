import { describe, expect, it } from 'vitest';
import { matchSkillChip, sentenceAt, skillCardInfo, needsAttention, newCard, type PromptCard, type Skill } from '../src';
import { validCharacter } from './helpers';

const skills: Skill[] = [
  { name: 'Sneak', rank: 'Expert' }, { name: 'Climb', rank: 'Capable' }, { name: 'Ride', rank: 'Trained' },
  { name: 'Lockpicking', rank: 'Capable' }, { name: 'Swordplay', rank: 'Master' }, { name: 'Animal Handling', rank: 'Trained' },
];
const chip = (s: string) => matchSkillChip(s, skills);

describe('matchSkillChip', () => {
  it('matches a Skill name and its common forms, with the rank from the sheet', () => {
    for (const s of ['I sneak past the guards.', 'Sneaking along the wall,', 'She snuck in.', 'He sneaks off.'])
      expect(chip(s), s).toMatchObject({ skill: 'Sneak', rank: 'Expert' });
    expect(chip('I climbed the wall.')).toMatchObject({ skill: 'Climb', rank: 'Capable' });
    expect(chip('We are climbing.')).toMatchObject({ skill: 'Climb' });
    expect(chip('I rode hard, riding all night.')).toMatchObject({ skill: 'Ride' });
    expect(chip('She is swordplay incarnate.')).toMatchObject({ skill: 'Swordplay', rank: 'Master' });
  });
  it('matches a Skill named with -ing by its verb too', () => {
    expect(chip('I lockpicked the door.')).toMatchObject({ skill: 'Lockpicking' });
    expect(chip('I lockpick the lock.')).toMatchObject({ skill: 'Lockpicking' });
  });
  it('matches whole words only, case-insensitively', () => {
    expect(chip('The bride arrives.')).toBeNull(); // not "ride"
    expect(chip('A climber waits.')).toBeNull();
    expect(chip('SNEAK!')).toMatchObject({ skill: 'Sneak' });
    expect(chip('The sneaker was red.')).toBeNull();
  });
  it('matches a multi-word Skill as a phrase, inflecting the last word', () => {
    expect(chip('Animal handling is my trade.')).toMatchObject({ skill: 'Animal Handling' });
    expect(chip('I handle the animals.')).toBeNull(); // paraphrases are Claude\'s job (M6), not the code matcher\'s
  });
  it('says nothing when no Skill is used, and never guesses a rank for a Skill the sheet lacks', () => {
    expect(chip('I walk to the market and buy bread.')).toBeNull();
    expect(matchSkillChip('I sneak.', [])).toBeNull();
  });
  it('picks the Skill used last when several match', () => {
    expect(chip('I sneak up and climb the wall.')).toMatchObject({ skill: 'Climb' });
  });
  it('reports where the match is', () => {
    const m = chip('First I sneak away.')!;
    expect('First I sneak away.'.slice(m.start, m.end)).toBe('sneak');
  });
});

describe('sentenceAt', () => {
  const text = 'I reach the wall. I climb it slowly! Then I rest.';
  it('returns the sentence the cursor is in', () => {
    expect(sentenceAt(text, 22)).toMatchObject({ text: 'I climb it slowly!', start: 18 });
    expect(sentenceAt(text, 0)?.text).toBe('I reach the wall.');
    expect(sentenceAt(text, text.length)?.text).toBe('Then I rest.');
  });
  it('treats a trailing unfinished sentence as a sentence, and empty text as none', () => {
    expect(sentenceAt('I sneak', 7)?.text).toBe('I sneak');
    expect(sentenceAt('', 0)).toBeNull();
    expect(sentenceAt('   ', 2)).toBeNull();
  });
});

describe('skillCardInfo (info card for a Skill chip)', () => {
  const sheet = () => ({
    ...validCharacter(),
    skills: [{ name: 'Sneak', rank: 'Expert' as const }, { name: 'Climb', rank: 'Capable' as const }],
    wounds: [{ id: 'w1', level: 'Hurt' as const, name: 'Twisted ankle', isExhaustion: false }],
    possessions: [{ id: 'pos1', name: 'Grappling hook', story: 'always packed' }],
  });
  it('shows the rated rank and each shift the sheet could bring, with its reason and resulting rank', () => {
    const info = skillCardInfo(sheet(), 'Sneak');
    expect(info).toMatchObject({ name: 'Sneak', rank: 'Expert' });
    expect(info.notes).toContainEqual(expect.objectContaining({ reason: 'Hurt: Twisted ankle', direction: 'down', result: 'Capable' }));
    expect(info.notes).toContainEqual(expect.objectContaining({ reason: "Grappling hook", direction: 'up', result: 'Master' }));
  });
  it('lists only shifts that move the Skill itself, not the Difficulty or Danger', () => {
    const notes = skillCardInfo(sheet(), 'Climb').notes;
    expect(notes.every((n) => ['up', 'down'].includes(n.direction))).toBe(true);
    expect(notes.some((n) => n.reason.includes('against the opposition'))).toBe(false);
  });
  it('a Skill the sheet lacks is Untrained, with no invented rank', () => {
    expect(skillCardInfo(sheet(), 'Lockpicking')).toMatchObject({ name: 'Lockpicking', rank: 'Untrained', onSheet: false });
    expect(skillCardInfo(sheet(), 'Sneak').onSheet).toBe(true);
  });
});

describe('needsAttention', () => {
  const base = (over: Partial<PromptCard>): PromptCard => ({ ...newCard({ id: 'c1', actorId: 'ilse', characterId: 'ilse-pc', anchorParagraphId: null, skill: { name: 'Climb', rank: 'Capable' } }), ...over });
  const ilse = { id: 'ilse', role: 'player' as const };
  const sella = { id: 'sella', role: 'player' as const };
  const gm = { id: 'gm1', role: 'gm' as const };
  it('the GM is waited on to Set a big card', () => {
    expect(needsAttention(base({ status: 'draft', speed: 'big' }), gm)).toBe(true);
    expect(needsAttention(base({ status: 'draft', speed: 'quick' }), gm)).toBe(false);
    expect(needsAttention(base({ status: 'set', speed: 'big' }), gm)).toBe(false);
  });
  it('the acting player is waited on to roll a Set card, and to write a rolled or conceded one', () => {
    expect(needsAttention(base({ status: 'set' }), ilse)).toBe(true);
    expect(needsAttention(base({ status: 'rolled' }), ilse)).toBe(true);
    expect(needsAttention(base({ status: 'conceded' }), ilse)).toBe(true);
    expect(needsAttention(base({ status: 'draft' }), ilse)).toBe(false);
    expect(needsAttention(base({ status: 'written' }), ilse)).toBe(false);
  });
  it('nobody else is waited on', () => {
    for (const status of ['draft', 'set', 'rolled', 'conceded', 'written'] as const) expect(needsAttention(base({ status }), sella)).toBe(false);
  });
});
