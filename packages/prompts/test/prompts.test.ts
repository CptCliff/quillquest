import { describe, expect, it } from 'vitest';
import { GM_KINDS, PLAYER_KINDS, buildRequest, kindsFor, parseAnswer, type Input } from '../src';

const THEMES = 'graphic violence toward children';
const SECRET = 'SENTINEL-hidden-npc-field-4471';
const NOTES = 'SENTINEL-gm-notes-9930';

const inputs: Record<string, Input> = {
  beliefChallenge: { kind: 'beliefChallenge', themes: THEMES, scene: 'The gate is shut and the captain is watching.', canon: ['The treaty is a lie.'], character: { name: 'Ilse', beliefs: [{ text: 'Oaths outlast the people who swear them', isCore: true }], burdens: ['Doubts the Oath'] } },
  danger: { kind: 'danger', themes: THEMES, scene: 'A rooftop chase.', card: { want: 'Cross the roof', risk: 'I slip', onTheLine: null } },
  npcLine: { kind: 'npcLine', themes: THEMES, scene: 'The captain stops them.', npc: { name: 'Captain Aldous', skills: ['Swordplay Expert'], beliefs: [SECRET], notes: NOTES } },
  oracle: { kind: 'oracle', themes: THEMES, scene: 'A quiet night in the camp.', faces: ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'] },
  skillMatch: { kind: 'skillMatch', themes: '', sentence: 'I creep past the guards.', skills: ['Sneak', 'Climb', 'Persuade'] },
  grant: { kind: 'grant', themes: THEMES, chapterProse: 'I held the barricade for three nights.', endsBadly: false },
  beliefCheck: { kind: 'beliefCheck', themes: THEMES, belief: { kind: 'objective', text: 'Expose the duke before the council meets' } },
};

describe('who may ask for what', () => {
  it('players get Skill match, grant suggestions and the Belief check; the GM gets everything', () => {
    expect([...PLAYER_KINDS].sort()).toEqual(['beliefCheck', 'grant', 'skillMatch']);
    expect(kindsFor('player')).toEqual(PLAYER_KINDS);
    expect([...kindsFor('gm')].sort()).toEqual([...PLAYER_KINDS, ...GM_KINDS].sort());
    expect(GM_KINDS).toEqual(expect.arrayContaining(['beliefChallenge', 'danger', 'npcLine', 'oracle']));
  });
  it('a player request for a GM kind is refused before any prompt is built', () => {
    for (const k of GM_KINDS) expect(() => buildRequest(inputs[k]!, 'player')).toThrow(/not allowed/i);
    for (const k of PLAYER_KINDS) expect(() => buildRequest(inputs[k]!, 'player')).not.toThrow();
  });
});

describe('chapter template adaptation', () => {
  it('shows the nearest template to the model, and nothing else about the table', () => {
    const r = buildRequest({ ...(inputs.grant as Extract<Input, { kind: 'grant' }>), template: { name: 'The Gate Warden', skills: ['Gatekeeping'], traits: ['Watchful'] } }, 'player');
    expect(r.user).toContain('The Gate Warden');
    expect(r.user).toContain('Gatekeeping');
    expect(buildRequest(inputs.grant!, 'player').user).not.toContain('library template');
  });
});

describe('every prompt', () => {
  it('names the themes to handle lightly or leave out, says it is a draft, and asks for JSON only', () => {
    for (const [k, input] of Object.entries(inputs)) {
      const r = buildRequest(input, 'gm');
      if (input.themes) expect(r.system, k).toContain(`Handle lightly or leave out: ${THEMES}`);
      else expect(r.system, k).toContain('No themes are marked');
      expect(r.system, k).toMatch(/draft/i);
      expect(r.system, k).toMatch(/JSON/);
      expect(r.maxTokens, k).toBeGreaterThan(50);
    }
  });
  it('skill match: the golden prompt (a fixed test case: change it only on purpose)', () => {
    expect(buildRequest(inputs.skillMatch!, 'player')).toEqual({
      system: [
        'You help players of a narrative tabletop RPG. Everything you write is a draft that a person accepts or discards; you never decide anything.',
        'No themes are marked.',
        'Answer with one JSON object and nothing else.',
      ].join('\n'),
      user: [
        'Which one of this character\'s Skills does the sentence use? Choose only from the list, or say none.',
        'Skills: Sneak, Climb, Persuade',
        'Sentence: I creep past the guards.',
        'Answer as {"skill": "<a Skill from the list>"} or {"skill": null}.',
      ].join('\n'),
      maxTokens: 60,
    });
  });
  it('the GM scene prompts carry the scene and the character\'s Beliefs and Burdens', () => {
    const r = buildRequest(inputs.beliefChallenge!, 'gm');
    expect(r.user).toContain('The gate is shut');
    expect(r.user).toContain('Oaths outlast the people who swear them');
    expect(r.user).toContain('Core');
    expect(r.user).toContain('Doubts the Oath');
    expect(r.user).toContain('The treaty is a lie.');
  });
  it('the NPC line prompt is GM-only and carries the NPC sheet', () => {
    const r = buildRequest(inputs.npcLine!, 'gm');
    expect(r.user).toContain(SECRET);
  });
});

describe('what a player request can never contain', () => {
  it('no GM notes, no hidden NPC fields, even if a caller tries to pass them', () => {
    for (const k of PLAYER_KINDS) {
      const polluted = { ...inputs[k]!, gmNotes: NOTES, npc: { beliefs: [SECRET] }, npcs: [{ notes: SECRET }] } as unknown as Input;
      const r = buildRequest(polluted, 'player');
      const all = JSON.stringify(r);
      expect(all, k).not.toContain('SENTINEL');
    }
  });
});

const ctx = { skills: ['Sneak', 'Climb', 'Persuade'], faces: 6 };
const bad = (kind: Parameters<typeof parseAnswer>[0], text: string, c = ctx) => { const r = parseAnswer(kind, text, c); expect(r.ok, text).toBe(false); };
const good = (kind: Parameters<typeof parseAnswer>[0], text: string, c = ctx) => { const r = parseAnswer(kind, text, c); if (!r.ok) throw new Error(r.error); return r.draft; };

describe('answers are untrusted: only valid, bounded JSON becomes a draft', () => {
  it('finds the JSON in a fenced or chatty answer, and refuses text with none', () => {
    expect(good('skillMatch', '```json\n{"skill": "Sneak"}\n```')).toEqual({ skill: 'Sneak' });
    expect(good('skillMatch', 'Sure! Here you go: {"skill": "sneak"} hope that helps')).toEqual({ skill: 'Sneak' }); // canonical spelling from the sheet
    bad('skillMatch', 'I think Sneak');
    bad('skillMatch', '');
    bad('skillMatch', '{"skill": ');
  });
  it('skill match: only a Skill on the sheet, or none; anything else is rejected', () => {
    expect(good('skillMatch', '{"skill": null}')).toEqual({ skill: null });
    expect(good('skillMatch', '{"skill": "none"}')).toEqual({ skill: null });
    bad('skillMatch', '{"skill": "Lockpicking"}');
    bad('skillMatch', '{"skill": 7}');
    bad('skillMatch', '{"skills": ["Sneak"]}');
  });
  it('belief challenges: one to three short prompts', () => {
    expect(good('beliefChallenge', '{"prompts": ["The captain offers a deal.", "Sella is in trouble."]}')).toEqual({ prompts: ['The captain offers a deal.', 'Sella is in trouble.'] });
    bad('beliefChallenge', '{"prompts": []}');
    bad('beliefChallenge', '{"prompts": ["a","b","c","d"]}');
    bad('beliefChallenge', `{"prompts": ["${'x'.repeat(401)}"]}`);
    bad('beliefChallenge', '{"prompts": [1]}');
  });
  it('sharper Dangers: one to three, each with a real Danger rank', () => {
    expect(good('danger', '{"options": [{"danger": "The ledger is stolen even if you get in.", "rank": "Serious"}]}')).toEqual({ options: [{ danger: 'The ledger is stolen even if you get in.', rank: 'Serious' }] });
    bad('danger', '{"options": [{"danger": "x", "rank": "Catastrophic"}]}');
    bad('danger', '{"options": [{"danger": "", "rank": "Real"}]}');
    bad('danger', '{"options": []}');
  });
  it('NPC line: a short line of dialogue', () => {
    expect(good('npcLine', '{"line": "You should not be here."}')).toEqual({ line: 'You should not be here.' });
    bad('npcLine', '{"line": ""}');
    bad('npcLine', `{"line": "${'x'.repeat(601)}"}`);
  });
  it('Burden oracle: one of the six faces, and a sentence tying it to the scene', () => {
    expect(good('oracle', '{"face": 4, "tie": "The secret is in the cellar."}')).toEqual({ face: 4, tie: 'The secret is in the cellar.' });
    bad('oracle', '{"face": 7, "tie": "x"}');
    bad('oracle', '{"face": 0, "tie": "x"}');
    bad('oracle', '{"face": 2.5, "tie": "x"}');
    bad('oracle', '{"face": 2}');
  });
  it('grant suggestions: up to three Skills and up to three Traits, never empty', () => {
    expect(good('grant', '{"skills": ["Siegecraft", "Endure"], "traits": ["Sleeps Lightly"]}')).toEqual({ skills: ['Siegecraft', 'Endure'], traits: ['Sleeps Lightly'] });
    bad('grant', '{"skills": [], "traits": []}');
    bad('grant', '{"skills": ["a","b","c","d"], "traits": ["x"]}');
    bad('grant', '{"skills": ["a"], "traits": "x"}');
  });
  it('Belief check: says whether it holds a conviction and an action, with a fix when it does not', () => {
    expect(good('beliefCheck', '{"conviction": true, "action": true, "fix": null}')).toEqual({ conviction: true, action: true, fix: null });
    expect(good('beliefCheck', '{"conviction": true, "action": false, "fix": "Add what you will do about it."}')).toMatchObject({ action: false, fix: 'Add what you will do about it.' });
    bad('beliefCheck', '{"conviction": true, "action": false, "fix": null}'); // a failing check needs a fix
    bad('beliefCheck', '{"conviction": "yes", "action": true, "fix": null}');
  });
});
