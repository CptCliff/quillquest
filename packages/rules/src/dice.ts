/** Randomness is injected so every test is repeatable. d(sides) returns an integer in 1..sides. */
export interface DiceSource {
  d(sides: number): number;
}

/** mulberry32: small, fast, seedable. Good enough for fair-dice property tests. */
export function seededDice(seed: number): DiceSource {
  let a = seed >>> 0;
  return {
    d(sides) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * sides) + 1;
    },
  };
}

/** Plays back fixed values in call order. Used by tests; throws if a value is out of range or the script runs dry. */
export function scriptedDice(values: number[]): DiceSource & { remaining(): number } {
  const queue = [...values];
  return {
    d(sides) {
      const v = queue.shift();
      if (v === undefined) throw new Error('scriptedDice: ran out of values');
      if (!Number.isInteger(v) || v < 1 || v > sides) throw new Error(`scriptedDice: ${v} is not on a d${sides}`);
      return v;
    },
    remaining: () => queue.length,
  };
}
