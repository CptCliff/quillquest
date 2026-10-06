import type { Violation } from '@quillquest/story';

const WORDS: Partial<Record<Violation['code'], string>> = {
  LOCKED: 'That prose is locked above a resolved roll.',
  NOT_OWNER_EDIT: "That's someone else's paragraph. Suggest a change instead.",
  SUGGESTION_TAMPER: "Another writer's suggestion can't be changed.",
  LOCK_CHANGE: 'Only the GM can lock or unlock prose.',
  LOCK_PREFIX: "Nothing can be added above locked prose.",
  FORGED_AUTHOR: 'A paragraph must be written by whoever creates it.',
};

export const explain = (violations: Pick<Violation, 'code' | 'message'>[]): string =>
  violations.map((v) => WORDS[v.code as Violation['code']] ?? v.message).filter((m, i, all) => all.indexOf(m) === i).join(' ');
