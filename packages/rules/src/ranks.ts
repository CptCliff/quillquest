// Rank ladders and the die behind each row (Rules v4, Appendix A).
// Players see rank words only; dice appear in the reveal view and in tests.

export const SKILL_RANKS = ['Hampered', 'Untrained', 'Trained', 'Capable', 'Expert', 'Master', 'Heroic', 'Peerless'] as const;
export const DIFFICULTY_RANKS = ['Trivial', 'Simple', 'Ordinary', 'Demanding', 'Hard', 'Extraordinary', 'Legendary', 'Mythic'] as const;
// Danger has no d2 / d16 / d20 rows: Minor sits on the d4 row, Grave on the d12 row.
export const DANGER_RANKS = ['Minor', 'Real', 'Serious', 'Severe', 'Grave'] as const;

export type SkillRank = (typeof SKILL_RANKS)[number];
export type DifficultyRank = (typeof DIFFICULTY_RANKS)[number];
export type DangerRank = (typeof DANGER_RANKS)[number];

/** Die sides by ladder row, row 0 = Hampered / Trivial. */
export const ROW_DICE = [2, 4, 6, 8, 10, 12, 16, 20] as const;

export const skillDie = (r: SkillRank): number => ROW_DICE[SKILL_RANKS.indexOf(r)]!;
export const difficultyDie = (r: DifficultyRank): number => ROW_DICE[DIFFICULTY_RANKS.indexOf(r)]!;
// Danger rows start at the d4 row (Minor), so offset by one.
export const dangerDie = (r: DangerRank): number => ROW_DICE[DANGER_RANKS.indexOf(r) + 1]!;
