import * as Y from 'yjs';
import { SUGGESTION_DELETE, SUGGESTION_INSERT, authorOfSuggestion, type Cell, type Paragraph, type StoryDoc, type SuggestionRef } from './types';

const OBJECT_CHAR = '￼'; // inline non-text nodes (hard breaks) count as one character

function ref(attrs: unknown): SuggestionRef | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const { id } = attrs as Record<string, unknown>;
  // A mark whose id carries no author cannot be attributed, so it is read as authorless: nobody can own or forge it.
  return typeof id === 'string' || typeof id === 'number' ? { id: String(id), authorId: authorOfSuggestion(String(id)) } : null;
}

/** Canonical form of the non-suggestion marks, so formatting changes are detectable. */
function fmt(marks: [string, unknown][]): string {
  const rest = marks.filter(([n]) => n !== SUGGESTION_INSERT && n !== SUGGESTION_DELETE).sort(([a], [b]) => (a < b ? -1 : 1));
  return rest.length ? JSON.stringify(rest) : '';
}

function cellsFor(text: string, marks: [string, unknown][]): Cell[] {
  const ins = ref(marks.find(([n]) => n === SUGGESTION_INSERT)?.[1]);
  const del = ref(marks.find(([n]) => n === SUGGESTION_DELETE)?.[1]);
  const f = fmt(marks);
  return [...text].map((ch) => ({ ch, ins, del, fmt: f }));
}

const truthy = (v: unknown) => v === true || v === 'true';
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

// ---- ProseMirror JSON (editor.getJSON() / doc.toJSON()) ------------------------------------------------------------

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PmNode[];
}

/** Used by the browser for instant feedback before an edit is sent. */
export function fromPmJson(doc: PmNode): StoryDoc {
  return (doc.content ?? []).map((node): Paragraph => {
    if (node.type !== 'paragraph') throw new Error(`Story documents hold paragraphs only, found ${node.type}`);
    const cells: Cell[] = [];
    for (const child of node.content ?? []) {
      if (child.type === 'text') {
        cells.push(...cellsFor(child.text ?? '', (child.marks ?? []).map((m): [string, unknown] => [m.type, m.attrs ?? {}])));
      } else {
        cells.push({ ch: OBJECT_CHAR, ins: null, del: null, fmt: JSON.stringify([[child.type, child.attrs ?? {}]]) });
      }
    }
    const a = node.attrs ?? {};
    return { paragraphId: str(a.paragraphId), authorId: str(a.authorId), pov: str(a.pov, 'own'), locked: truthy(a.locked), cells };
  });
}

// ---- Yjs (what y-prosemirror writes, what the sync server sees) -----------------------------------------------------

/** y-prosemirror keys a mark that may repeat as `name--hash`; strip the hash. */
const markName = (key: string) => key.split('--')[0]!;

/** Used by the sync server on every inbound update. */
export function fromYFragment(fragment: Y.XmlFragment): StoryDoc {
  return fragment.toArray().map((node): Paragraph => {
    if (!(node instanceof Y.XmlElement) || node.nodeName !== 'paragraph') throw new Error('Story documents hold paragraphs only');
    const cells: Cell[] = [];
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
          if (typeof op.insert !== 'string') continue;
          const marks = Object.entries(op.attributes ?? {}).map(([k, v]): [string, unknown] => [markName(k), v]);
          cells.push(...cellsFor(op.insert, marks));
        }
      } else if (child instanceof Y.XmlElement) {
        cells.push({ ch: OBJECT_CHAR, ins: null, del: null, fmt: JSON.stringify([[child.nodeName, child.getAttributes()]]) });
      }
    }
    const a = node.getAttributes();
    return { paragraphId: str(a.paragraphId), authorId: str(a.authorId), pov: str(a.pov, 'own'), locked: truthy(a.locked), cells };
  });
}
