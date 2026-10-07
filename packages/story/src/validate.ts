import type { Actor, Cell, Paragraph, StoryDoc, Violation, ViolationCode } from './types';

const sameBase = (a: Cell[], b: Cell[]): boolean => {
  const x = a.filter((c) => !c.ins);
  const y = b.filter((c) => !c.ins);
  return x.length === y.length && x.every((c, i) => c.ch === y[i]!.ch && c.fmt === y[i]!.fmt);
};

const sameCells = (a: Cell[], b: Cell[]): boolean =>
  a.length === b.length &&
  a.every((c, i) => {
    const d = b[i]!;
    return c.ch === d.ch && c.fmt === d.fmt && c.ins?.id === d.ins?.id && c.ins?.authorId === d.ins?.authorId && c.del?.id === d.del?.id && c.del?.authorId === d.del?.authorId;
  });

/** For each suggestion by someone other than `actorId`: the text it inserts and the text it deletes. */
function othersSuggestions(cells: Cell[], actorId: string): Map<string, { by: string; ins: string; del: string }> {
  const out = new Map<string, { by: string; ins: string; del: string }>();
  const touch = (ref: { id: string; authorId: string }, key: 'ins' | 'del', ch: string) => {
    if (ref.authorId === actorId) return;
    const e = out.get(ref.id) ?? { by: ref.authorId, ins: '', del: '' };
    e[key] += ch;
    out.set(ref.id, e);
  };
  for (const c of cells) {
    if (c.ins) touch(c.ins, 'ins', c.ch);
    if (c.del) touch(c.del, 'del', c.ch);
  }
  return out;
}

function sameSuggestionMaps(a: ReturnType<typeof othersSuggestions>, b: ReturnType<typeof othersSuggestions>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y || x.by !== y.by || x.ins !== y.ins || x.del !== y.del) return false;
  }
  return true;
}

export interface ValidationResult {
  violations: Violation[];
}

/**
 * The edit policy (design plan 3.3, 5.1, 9.2). Compares a document before and after one update by one actor.
 *
 * - Own text is edited freely; another writer's text only through their own suggestion marks.
 * - A locked paragraph refuses every content change, from everyone including the GM. Locks are never changed by a client
 *   update: the server locks prose when a roll's outcome is written, and unlocks it for a GM retcon (M3).
 * - Locked paragraphs always form a prefix of the story, so nothing can be inserted above a locked paragraph.
 * - Authorship, ids and order never change. A new paragraph must be created by its author and start unlocked.
 *
 * Pure: no Yjs, no network. The server runs it on every inbound update; the browser runs it for instant feedback.
 */
export function validateChange(before: StoryDoc, after: StoryDoc, actor: Actor): ValidationResult {
  const violations: Violation[] = [];
  const bad = (code: ViolationCode, message: string, paragraphId?: string) => violations.push({ code, message, paragraphId });

  const beforeById = new Map(before.map((p) => [p.paragraphId, p]));
  const afterIds = new Set<string>();
  for (const p of after) {
    if (!p.paragraphId) bad('MISSING_ID', 'Every paragraph needs an id');
    else if (afterIds.has(p.paragraphId)) bad('DUPLICATE_ID', `Duplicate paragraph id ${p.paragraphId}`, p.paragraphId);
    afterIds.add(p.paragraphId);
  }

  const keptBefore = before.filter((p) => afterIds.has(p.paragraphId)).map((p) => p.paragraphId);
  const keptAfter = after.filter((p) => beforeById.has(p.paragraphId)).map((p) => p.paragraphId);
  if (keptBefore.join('\0') !== keptAfter.join('\0')) bad('REORDER', 'Paragraphs cannot be reordered');

  for (const b of before) {
    if (afterIds.has(b.paragraphId)) continue;
    if (b.locked) bad('LOCKED', 'A locked paragraph cannot be deleted', b.paragraphId);
    else if (b.authorId !== actor.id) bad('NOT_OWNER_EDIT', "Only the author can delete a paragraph", b.paragraphId);
  }

  for (const a of after) {
    const b = beforeById.get(a.paragraphId);
    if (!b) {
      if (a.authorId !== actor.id) bad('FORGED_AUTHOR', 'A new paragraph must be authored by whoever creates it', a.paragraphId);
      if (a.locked) bad('LOCK_NEW', 'A new paragraph starts unlocked', a.paragraphId);
      continue;
    }
    checkParagraph(b, a, actor, bad);
  }

  let sawUnlocked = false;
  for (const p of after) {
    if (!p.locked) sawUnlocked = true;
    else if (sawUnlocked) {
      bad('LOCK_PREFIX', 'Locked paragraphs must form an unbroken run from the start of the story', p.paragraphId);
      break;
    }
  }
  return { violations };
}

function checkParagraph(
  b: Paragraph,
  a: Paragraph,
  actor: Actor,
  bad: (code: ViolationCode, message: string, paragraphId?: string) => void,
) {
  const id = a.paragraphId;
  if (a.authorId !== b.authorId) bad('AUTHOR_CHANGED', 'Authorship never changes', id);
  if (a.locked !== b.locked) bad('LOCK_CHANGE', 'Prose is locked and unlocked by the game, not by editing', id);
  if (a.pov !== b.pov && actor.id !== b.authorId) bad('POV_CHANGED', "Only the author sets a paragraph's point of view", id);

  if (sameCells(b.cells, a.cells)) return;
  if (b.locked) return bad('LOCKED', 'This prose is locked above a resolved roll', id);
  if (actor.id === b.authorId) return; // own text: free
  if (!sameBase(b.cells, a.cells)) return bad('NOT_OWNER_EDIT', "Changes to someone else's text must be suggestions", id);
  if (!sameSuggestionMaps(othersSuggestions(b.cells, actor.id), othersSuggestions(a.cells, actor.id)))
    bad('SUGGESTION_TAMPER', "Another writer's suggestion was altered, or a suggestion was made in someone else's name", id);
}

/** Every paragraph from the start through the outcome paragraph, to lock when a roll is written. */
export function lockThrough(doc: StoryDoc, paragraphId: string): string[] {
  const at = doc.findIndex((p) => p.paragraphId === paragraphId);
  if (at < 0) throw new Error(`No paragraph ${paragraphId}`);
  return doc.slice(0, at + 1).map((p) => p.paragraphId);
}
