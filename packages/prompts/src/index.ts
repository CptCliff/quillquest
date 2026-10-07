// Prompts are code (design plan 8.3): templates, the role gate, and the parsers that make a model's answer safe to show.
// Pure functions only; no I/O. The server supplies the facts and the model, this package decides what may be asked and what may be believed.
import { DANGER_RANKS, type DangerRank } from '@quillquest/rules';

export type SuggestionKind = 'beliefChallenge' | 'danger' | 'npcLine' | 'oracle' | 'skillMatch' | 'grant' | 'beliefCheck';
export const PLAYER_KINDS = ['skillMatch', 'grant', 'beliefCheck'] as const satisfies readonly SuggestionKind[];
export const GM_KINDS = ['beliefChallenge', 'danger', 'npcLine', 'oracle'] as const satisfies readonly SuggestionKind[];
export const kindsFor = (role: 'gm' | 'player'): readonly SuggestionKind[] => (role === 'gm' ? [...PLAYER_KINDS, ...GM_KINDS] : PLAYER_KINDS);

interface Base { themes: string }
export interface BeliefChallengeInput extends Base { kind: 'beliefChallenge'; scene: string; canon: string[]; character: { name: string; beliefs: { text: string; isCore: boolean }[]; burdens: string[] } }
export interface DangerInput extends Base { kind: 'danger'; scene: string; card: { want: string; risk: string; onTheLine: string | null } }
export interface NpcLineInput extends Base { kind: 'npcLine'; scene: string; npc: { name: string; skills: string[]; beliefs: string[]; notes: string } }
export interface OracleInput extends Base { kind: 'oracle'; scene: string; faces: string[] }
export interface SkillMatchInput extends Base { kind: 'skillMatch'; sentence: string; skills: string[] }
/** `template` is set when the chapter's own writer asks the assistant to adapt the nearest library template to what they wrote. */
export interface GrantInput extends Base { kind: 'grant'; chapterProse: string; endsBadly: boolean; template?: { name: string; skills: string[]; traits: string[] } }
export interface BeliefCheckInput extends Base { kind: 'beliefCheck'; belief: { kind: string; text: string } }
export type Input = BeliefChallengeInput | DangerInput | NpcLineInput | OracleInput | SkillMatchInput | GrantInput | BeliefCheckInput;

export interface Request { system: string; user: string; maxTokens: number }

const isGmKind = (k: SuggestionKind) => (GM_KINDS as readonly string[]).includes(k);
const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');

/**
 * The prompt for one request. A player may only ask for a player kind, and each builder reads only the fields its own input type
 * declares, so GM notes and hidden NPC fields cannot ride along by accident (tests pass them on purpose and check).
 */
export function buildRequest(input: Input, role: 'gm' | 'player'): Request {
  if (!kindsFor(role).includes(input.kind)) throw new Error(`Players are not allowed to ask for ${input.kind}`);
  const who = isGmKind(input.kind) ? 'the game master' : 'players';
  const system = [
    `You help ${who} of a narrative tabletop RPG. Everything you write is a draft that a person accepts or discards; you never decide anything.`,
    input.themes.trim() ? `Handle lightly or leave out: ${input.themes.trim()}` : 'No themes are marked.',
    'Answer with one JSON object and nothing else.',
  ].join('\n');
  switch (input.kind) {
    case 'skillMatch':
      return { system, maxTokens: 60, user: [
        'Which one of this character\'s Skills does the sentence use? Choose only from the list, or say none.',
        `Skills: ${list(input.skills)}`,
        `Sentence: ${input.sentence}`,
        'Answer as {"skill": "<a Skill from the list>"} or {"skill": null}.',
      ].join('\n') };
    case 'beliefChallenge':
      return { system, maxTokens: 500, user: [
        `Give up to three ways the current scene could test one of ${input.character.name}'s Beliefs. Each is one or two sentences and names a cost, not a solution.`,
        ...input.character.beliefs.map((b) => `Belief${b.isCore ? ' (Core)' : ''}: ${b.text}`),
        `Burdens: ${list(input.character.burdens)}`,
        `Canon: ${list(input.canon)}`,
        `Scene (recent story): ${input.scene}`,
        'Answer as {"prompts": ["...", "..."]}.',
      ].join('\n') };
    case 'danger':
      return { system, maxTokens: 500, user: [
        'Offer two or three sharper Dangers for this prompt card. A Danger passes if it could happen even when the character succeeds. Give each a Danger rank.',
        `Want: ${input.card.want}`, `Risk: ${input.card.risk}`, `On the line: ${input.card.onTheLine ?? 'nothing named'}`,
        `Scene: ${input.scene}`,
        `Ranks: ${DANGER_RANKS.join(', ')}`,
        'Answer as {"options": [{"danger": "...", "rank": "Serious"}]}.',
      ].join('\n') };
    case 'npcLine':
      return { system, maxTokens: 300, user: [
        `Write one short line of dialogue in the voice of ${input.npc.name}.`,
        `Skills: ${list(input.npc.skills)}`, `Beliefs: ${list(input.npc.beliefs)}`, `Notes: ${input.npc.notes || 'none'}`,
        `Scene: ${input.scene}`,
        'Answer as {"line": "..."}.',
      ].join('\n') };
    case 'oracle':
      return { system, maxTokens: 200, user: [
        'Choose the one of the campaign\'s six faces that best fits the scene, and tie it to the scene in one sentence.',
        ...input.faces.map((f, i) => `${i + 1}. ${f}`),
        `Scene: ${input.scene}`,
        'Answer as {"face": <1-6>, "tie": "..."}.',
      ].join('\n') };
    case 'grant':
      return { system, maxTokens: 300, user: [
        `Read this Life Chapter and suggest up to three Skills and up to three Traits the character could gain from it.${input.endsBadly ? ' This chapter ended badly, so the Traits should be harmful.' : ''}`,
        `Chapter: ${input.chapterProse}`,
        ...(input.template ? [`The nearest library template is "${input.template.name}". Its Skills: ${list(input.template.skills)}. Its Traits: ${list(input.template.traits)}. Keep what fits this chapter and change what does not.`] : []),
        'Answer as {"skills": ["..."], "traits": ["..."]}.',
      ].join('\n') };
    case 'beliefCheck':
      return { system, maxTokens: 200, user: [
        'A Belief should hold a conviction (something the character holds true or wants) and an action (something they will do about it). Check this draft.',
        `Belief (${input.belief.kind}): ${input.belief.text}`,
        'Answer as {"conviction": true|false, "action": true|false, "fix": "<a one-line fix, or null if both hold>"}.',
      ].join('\n') };
  }
}

// ---------- answers ----------
export interface ParseContext { skills?: string[]; faces?: number }
export type Draft =
  | { prompts: string[] } | { options: { danger: string; rank: DangerRank }[] } | { line: string } | { face: number; tie: string }
  | { skill: string | null } | { skills: string[]; traits: string[] } | { conviction: boolean; action: boolean; fix: string | null };
export type Parsed = { ok: true; draft: Draft } | { ok: false; error: string };

/** The first JSON object in a model's text, tolerating code fences and chatter around it. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the answer');
  return JSON.parse(text.slice(start, end + 1));
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error('Expected a non-empty text');
  if (v.length > max) throw new Error(`Text longer than ${max} characters`);
  return v.trim();
};
const texts = (v: unknown, min: number, max: number, len: number): string[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`Expected ${min} to ${max} items`);
  return v.map((x) => text(x, len));
};

/** Turns a model's text into a draft, or says why it cannot. Nothing the model says is believed beyond what this accepts. */
export function parseAnswer(kind: SuggestionKind, raw: string, ctx: ParseContext = {}): Parsed {
  try {
    const j = extractJson(raw);
    if (!isObj(j)) throw new Error('Expected a JSON object');
    switch (kind) {
      case 'skillMatch': {
        if (!('skill' in j)) throw new Error('Missing "skill"');
        if (j.skill === null || (typeof j.skill === 'string' && j.skill.trim().toLowerCase() === 'none')) return { ok: true, draft: { skill: null } };
        if (typeof j.skill !== 'string') throw new Error('"skill" must be a name or null');
        const name = j.skill.trim().toLowerCase();
        const found = (ctx.skills ?? []).find((s) => s.toLowerCase() === name);
        if (!found) throw new Error('That Skill is not on the sheet');
        return { ok: true, draft: { skill: found } };
      }
      case 'beliefChallenge': return { ok: true, draft: { prompts: texts(j.prompts, 1, 3, 400) } };
      case 'danger': {
        if (!Array.isArray(j.options) || j.options.length < 1 || j.options.length > 3) throw new Error('Expected 1 to 3 options');
        return { ok: true, draft: { options: j.options.map((o: unknown) => {
          if (!isObj(o) || !DANGER_RANKS.includes(o.rank as DangerRank)) throw new Error('Each option needs a real Danger rank');
          return { danger: text(o.danger, 300), rank: o.rank as DangerRank };
        }) } };
      }
      case 'npcLine': return { ok: true, draft: { line: text(j.line, 600) } };
      case 'oracle': {
        const faces = ctx.faces ?? 6;
        if (!Number.isInteger(j.face) || (j.face as number) < 1 || (j.face as number) > faces) throw new Error(`"face" must be a whole number from 1 to ${faces}`);
        return { ok: true, draft: { face: j.face as number, tie: text(j.tie, 400) } };
      }
      case 'grant': {
        const skills = texts(j.skills ?? [], 0, 3, 60); const traits = texts(j.traits ?? [], 0, 3, 80);
        if (!skills.length && !traits.length) throw new Error('Nothing was suggested');
        return { ok: true, draft: { skills, traits } };
      }
      case 'beliefCheck': {
        if (typeof j.conviction !== 'boolean' || typeof j.action !== 'boolean') throw new Error('"conviction" and "action" must be true or false');
        const fix = j.fix === null || j.fix === undefined ? null : text(j.fix, 300);
        if ((!j.conviction || !j.action) && !fix) throw new Error('A Belief that fails the check needs a fix');
        return { ok: true, draft: { conviction: j.conviction, action: j.action, fix } };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unreadable answer' };
  }
}
