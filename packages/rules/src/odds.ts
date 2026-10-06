// Exact probabilities for a pair of dice, computed by counting (no floats until the end).

/** P(Skill die strictly beats Difficulty die). A tie fails: the opposition wins. */
export function chanceToBeat(skillSides: number, difficultySides: number): number {
  let wins = 0;
  for (let s = 1; s <= skillSides; s++) wins += Math.min(s - 1, difficultySides);
  return wins / (skillSides * difficultySides);
}

/** P(Skill die ties or beats Danger die). A tie avoids: the player wins. */
export function chanceToAvoid(skillSides: number, dangerSides: number): number {
  let wins = 0;
  for (let s = 1; s <= skillSides; s++) wins += Math.min(s, dangerSides);
  return wins / (skillSides * dangerSides);
}
