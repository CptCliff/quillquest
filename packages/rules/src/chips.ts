import type { RatedSkillRank, SkillRank } from './ranks';
import { applyShifts } from './shifts';
import { resolveSkill, suggestShifts } from './flow';
import type { Character, Skill } from './character';

/**
 * Skill chips, the code half (design plan 5.3): find a Skill the writer is using in the sentence they are in. The rank always
 * comes from the sheet, never from the sentence. Paraphrases ("I creep past the guards") are Claude's job in M6, so a sentence
 * with no Skill name or inflection of one matches nothing here.
 */

const IRREGULAR: Record<string, string[]> = {
  sneak: ['snuck'], ride: ['rode', 'ridden'], swim: ['swam', 'swum'], run: ['ran'], fight: ['fought'], steal: ['stole', 'stolen'],
  hide: ['hid', 'hidden'], speak: ['spoke', 'spoken'], sing: ['sang', 'sung'], throw: ['threw', 'thrown'], shoot: ['shot'],
  swing: ['swung'], dive: ['dove'], leap: ['leapt'], creep: ['crept'], seek: ['sought'], lead: ['led'], strike: ['struck'],
};
const VOWELS = /[aeiou]/;

function ing(w: string): string {
  if (/ie$/.test(w)) return `${w.slice(0, -2)}ying`;
  if (/[^aeoy]e$/.test(w) || /[^e]e$/.test(w)) return `${w.slice(0, -1)}ing`;
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) return `${w}${w.at(-1)}ing`;
  return `${w}ing`;
}
function past(w: string): string {
  if (/e$/.test(w)) return `${w}d`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ied`;
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) return `${w}${w.at(-1)}ed`;
  return `${w}ed`;
}
function plural(w: string): string {
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  return `${w}s`;
}

/** Common inflections of one word: base, -s, -ing, -ed, and the irregular forms of a few common verbs. */
export function wordForms(word: string): string[] {
  const w = word.toLowerCase();
  const bases = new Set([w]);
  // A Skill named with -ing (Lockpicking, Handling) is also matched by its verb: lockpick, lockpicked; handle, handled.
  if (w.length > 5 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    bases.add(stem);
    bases.add(`${stem}e`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) bases.add(stem.slice(0, -1));
  }
  const forms = new Set<string>();
  for (const b of bases) {
    if (b.length < 3 || !VOWELS.test(b)) continue;
    forms.add(b); forms.add(plural(b)); forms.add(ing(b)); forms.add(past(b));
    for (const x of IRREGULAR[b] ?? []) forms.add(x);
  }
  return [...forms];
}

export interface ChipMatch { skill: string; rank: RatedSkillRank; matched: string; start: number; end: number }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Skill (from `skills`) the sentence uses, preferring the one used last. Whole words only, case-insensitive. */
export function matchSkillChip(sentence: string, skills: Skill[]): ChipMatch | null {
  let best: ChipMatch | null = null;
  for (const s of skills) {
    const words = s.name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const head = words.slice(0, -1).map(escape);
    const forms = wordForms(words.at(-1)!).map(escape).sort((a, b) => b.length - a.length);
    const pattern = `\\b${head.length ? `${head.join('\\s+')}\\s+` : ''}(?:${forms.join('|')})\\b`;
    for (const m of sentence.matchAll(new RegExp(pattern, 'gi'))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!best || start > best.start || (start === best.start && end > best.end))
        best = { skill: s.name, rank: s.rank, matched: m[0], start, end };
    }
  }
  return best;
}

/** The sentence the cursor is in, trimmed, with its offsets. A trailing unfinished sentence counts. */
export function sentenceAt(text: string, offset: number): { text: string; start: number; end: number } | null {
  const chunks = [...text.matchAll(/[^.!?\n…]+[.!?…]*["')\]]*|\n+/g)];
  for (const c of chunks) {
    const raw = c[0];
    const rawStart = c.index ?? 0;
    const rawEnd = rawStart + raw.length;
    if (offset > rawEnd) continue;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const start = rawStart + (raw.length - raw.trimStart().length);
    return { text: trimmed, start, end: start + trimmed.length };
  }
  return null;
}

// ---- the info card for a Skill chip ------------------------------------------------------------------------------------

export interface SkillShiftNote { label: string; reason: string; direction: 'up' | 'down'; result: SkillRank }
export interface SkillCardInfo { name: string; rank: RatedSkillRank; onSheet: boolean; notes: SkillShiftNote[] }

/**
 * The rated rank and each shift this sheet could bring to the Skill, with its reason and the rank it would give on its own
 * (design plan 5.4: "Expert, shifted down by Hurt: twisted ankle"). Whether a shift applies is decided at Set, not here.
 */
export function skillCardInfo(c: Character, skillName: string): SkillCardInfo {
  const { name, rank } = resolveSkill(c, skillName);
  const notes: SkillShiftNote[] = [];
  for (const cand of suggestShifts(c, {})) {
    for (const s of cand.shifts) {
      if (s.ladder !== 'skill') continue;
      const direction = s.delta > 0 ? 'up' : 'down';
      if (notes.some((n) => n.reason === s.reason && n.direction === direction)) continue;
      const result = applyShifts({ skill: rank, difficulty: 'Simple', danger: 'Minor', shifts: [s] }).skill;
      notes.push({ label: cand.label, reason: s.reason, direction, result });
    }
  }
  return { name, rank, onSheet: c.skills.some((x) => x.name.toLowerCase() === name.toLowerCase()), notes };
}
