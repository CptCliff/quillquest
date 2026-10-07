import type { PublicCard } from '@quillquest/rules';

/** Plain-language labels for the ranks and outcomes (Rules v4 3.3, 3.5). Players only ever see words. */
export const DANGER_LABELS: Record<string, string> = {
  Minor: 'Minor: a scare, lost time',
  Real: 'Real: a Hurt, embarrassment',
  Serious: 'Serious: Wounded, a lost ally',
  Severe: 'Severe: Critical, disgrace',
  Grave: 'Grave: Mortal, or a Burden',
};
export const OUTCOME_LABELS: Record<NonNullable<PublicCard['outcome']>, string> = {
  cleanSuccess: 'Clean success',
  successWithCost: 'Success, with the cost',
  failureNoCost: 'Failure, no cost',
  failureWithCost: 'Failure, and the cost lands',
};
export const STATUS_LABELS: Record<PublicCard['status'], string> = {
  draft: 'Drafting', set: 'Set', rolled: 'Rolled', written: 'Written', conceded: 'Conceded',
};
export const THREATS = ['blade', 'blow', 'arrow', 'fire', 'fall', 'drowning', 'poison', 'magic', 'other'] as const;
