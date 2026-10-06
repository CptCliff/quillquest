import { skillIndex } from './ranks';
import type { Character } from './character';

export interface CreationProblem { code: string; message: string }
export interface CreationOptions {
  /** How many other player characters share the table (default 2). Connections are needed to min(2, this) of them. */
  otherCharacters?: number;
}

/** Session-zero checks (Rules v4 7.1-7.4, 10). Returns every problem; an empty list means Begin play may unlock. The GM can override a failure in the app. */
export function validateCreation(c: Character, opts: CreationOptions = {}): CreationProblem[] {
  const out: CreationProblem[] = [];
  const bad = (code: string, message: string) => out.push({ code, message });

  // Life Chapters
  if (c.chapters.length < 3 || c.chapters.length > 4) bad('CHAPTER_COUNT', 'Three Life Chapters (four for veterans)');
  const badIdx = c.chapters.flatMap((ch, i) => (ch.endsBadly ? [i] : []));
  if (badIdx.length !== 1) bad('BAD_CHAPTER_COUNT', 'Exactly one chapter must end badly');
  // Rules v4 7.3: "second or third, not the most recent". With three chapters the third IS the most recent, so only the
  // second qualifies; with four, the second or third. (Flagged in the M1 notes as a rules ambiguity.)
  else if (badIdx[0]! < 1 || badIdx[0]! > c.chapters.length - 2) bad('BAD_CHAPTER_POSITION', 'The bad chapter is the second or third, never the first or the most recent');
  else {
    const i = badIdx[0]!;
    if (!c.threads.some((t) => t.source.type === 'chapter' && t.source.index === i)) bad('BAD_CHAPTER_THREAD', 'The bad chapter must leave a Thread');
    if (!c.traits.some((t) => t.harmful && t.source.type === 'chapter' && t.source.index === i)) bad('BAD_CHAPTER_TRAIT', 'The bad chapter grants a harmful Trait');
  }
  for (const pick of ['connection', 'resource', 'thread'] as const)
    if (!c.chapters.some((ch) => ch.pick === pick)) bad('MISSING_PICK', `Across all chapters, at least one ${pick} pick is needed`);

  // Skills
  if (!c.skills.some((s) => skillIndex(s.rank) >= skillIndex('Capable'))) bad('NO_CAPABLE_SKILL', 'Every character has a Skill at Capable or better');
  if (c.skills.some((s) => skillIndex(s.rank) > skillIndex('Expert'))) bad('SKILL_OVER_EXPERT', 'Starting Skills cap at Expert');

  // Connections, Threads, crossings
  const needed = Math.min(2, opts.otherCharacters ?? 2);
  const linked = new Set(c.connections.flatMap((x) => (x.withCharacterId ? [x.withCharacterId] : [])));
  if (linked.size < needed) bad('CONNECTIONS', `Connections to ${needed} other characters (has ${linked.size})`);
  if (c.threads.length < 1) bad('NO_THREAD', 'A Thread the GM can use');
  if (c.crossings.length < 2) bad('CROSSINGS', 'Two crossings per character');
  else if (!c.crossings.some((x) => x.touchesBelief)) bad('CROSSING_BELIEF', 'One crossing should touch a Belief');

  // Beliefs, Instincts, Traits, limits
  const beliefKinds = c.beliefs.map((b) => b.kind).sort().join(',');
  if (beliefKinds !== 'objective,relationship,worldview') bad('BELIEFS', 'Three Beliefs: objective, relationship, worldview');
  const core = c.beliefs.filter((b) => b.isCore);
  if (core.length !== 1 || core[0]!.kind !== 'worldview') bad('CORE_BELIEF', 'The worldview Belief is the Core Belief');
  if (c.instincts.length !== 3) bad('INSTINCTS', 'Three Instincts');
  const sheetTraits = c.traits.filter((t) => t.source.type !== 'possession').length;
  if (sheetTraits < 3 || sheetTraits > 5) bad('TRAIT_COUNT', `Three to five Traits (has ${sheetTraits})`);
  if (c.possessions.length > 3) bad('POSSESSIONS', 'At most three significant possessions');
  if (c.burdens.filter((b) => b.status === 'active').length > 2) bad('BURDENS', 'At most two active Burdens');
  if (c.wealthRung < 0 || c.wealthRung > 4 || c.networkRung < 0 || c.networkRung > 4) bad('RUNGS', 'Wealth and Network rungs run 0-4');
  return out;
}
