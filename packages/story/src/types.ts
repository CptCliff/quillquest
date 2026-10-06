/** A suggestion mark: who proposed it, grouped by id so accept/reject can act on one proposal. */
export interface SuggestionRef {
  id: string;
  authorId: string;
}

/** One character of a paragraph with everything the policy cares about. */
export interface Cell {
  ch: string;
  /** Set when this character is a proposed insertion. */
  ins: SuggestionRef | null;
  /** Set when this base character is proposed for deletion. */
  del: SuggestionRef | null;
  /** Canonical JSON of the non-suggestion marks (bold etc.), so formatting counts as text. */
  fmt: string;
}

export interface Paragraph {
  paragraphId: string;
  authorId: string;
  /** 'own' | 'gm' | `borrowed:${ownerUserId}` */
  pov: string;
  locked: boolean;
  cells: Cell[];
}

export type StoryDoc = Paragraph[];

export interface Actor {
  id: string;
  role: 'player' | 'gm';
}

export type ViolationCode =
  | 'LOCKED' | 'LOCK_CHANGE' | 'LOCK_NEW' | 'LOCK_PREFIX'
  | 'NOT_OWNER_EDIT' | 'SUGGESTION_TAMPER' | 'FORGED_AUTHOR' | 'AUTHOR_CHANGED' | 'POV_CHANGED'
  | 'REORDER' | 'DUPLICATE_ID' | 'MISSING_ID' | 'SCHEMA';

export interface Violation {
  code: ViolationCode;
  paragraphId?: string;
  message: string;
}

/** A GM lock change, reported so the server can write it to the override log. */
export interface GmAction {
  type: 'lock' | 'unlock';
  paragraphId: string;
}

/** Mark names used by @handlewithcare/prosemirror-suggest-changes. */
export const SUGGESTION_INSERT = 'insertion';
export const SUGGESTION_DELETE = 'deletion';

/**
 * The library's marks carry only an id, so the author rides inside it: `${authorId}.${counter}`.
 * Author ids must not contain a '.'; ids come from the sign-in provider (M4) and are sanitized there.
 */
export const suggestionId = (authorId: string, n: number | string): string => `${authorId}.${n}`;
export function authorOfSuggestion(id: string): string {
  const at = id.lastIndexOf('.');
  return at < 0 ? '' : id.slice(0, at);
}
