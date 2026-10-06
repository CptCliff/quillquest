import { Extension, type Editor } from '@tiptap/core';
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { transformToSuggestionTransaction } from '@handlewithcare/prosemirror-suggest-changes';
import { suggestionId, validateChange, type Violation } from '@quillquest/story';
import { snapshot } from '../lib/story-doc';

export interface StoryGuardOptions {
  userId: string;
  role: 'player' | 'gm';
  /** Name and ink for any author, connected or not. */
  ink: (userId: string) => { name: string; color: string };
  /** Called when an edit is refused, so the UI can say why. */
  onReject: (violations: Pick<Violation, 'code' | 'message'>[]) => void;
}

/** Meta flag for commands that must not become suggestions (a writer withdrawing their own suggestion, the GM's lock buttons). */
export const DIRECT = 'quillquest/direct';

const newId = () => `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** A transaction y-prosemirror applied from the network. Undo/redo are local intent, so they are not "remote". */
function isRemote(tr: Transaction): boolean {
  const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined;
  return !!meta?.isChangeOrigin && !meta.isUndoRedoOperation;
}

const hasContentStep = (tr: Transaction) => tr.steps.some((s) => s instanceof ReplaceStep || s instanceof ReplaceAroundStep);

/** Does this edit land inside a paragraph written by someone else? (Unstamped paragraphs count as the editor's own.) */
function touchesOthers(tr: Transaction, me: string): boolean {
  const others = (n: PmNode) => n.type.name === 'paragraph' && !!n.attrs.authorId && n.attrs.authorId !== me;
  return tr.steps.some((step, i) => {
    let hit = false;
    const before = tr.docs[i]!;
    step.getMap().forEach((from, to) => {
      for (const pos of [from, to]) {
        const $p = before.resolve(Math.min(pos, before.content.size));
        if ($p.depth >= 1 && others($p.node(1))) hit = true;
      }
      before.nodesBetween(from, Math.max(to, from), (n) => { if (others(n)) hit = true; });
    });
    return hit;
  });
}

/** Start a new paragraph of the writer's own after `afterPos`, past the locked run if that is where it lands. */
export function startPost(editor: Editor, userId: string, afterPos?: number): boolean {
  const { state } = editor;
  let lockedEnd = 0;
  state.doc.forEach((n, offset) => { if (n.attrs.locked) lockedEnd = offset + n.nodeSize; });
  const pos = Math.max(afterPos ?? state.doc.content.size, lockedEnd);
  const tr = state.tr.insert(pos, state.schema.nodes.paragraph!.create({ authorId: userId }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/**
 * Everything the browser does for the edit policy. The server enforces the same rules from `@quillquest/story`; this
 * exists so the writer gets instant, kind feedback and so honest edits become suggestions instead of being refused.
 */
export const StoryGuard = Extension.create<StoryGuardOptions>({
  name: 'storyGuard',

  addOptions() {
    return { userId: '', role: 'player', ink: () => ({ name: '', color: '#444' }), onReject: () => {} };
  },

  dispatchTransaction({ transaction, next }) {
    const { userId, role, onReject } = this.options;
    if (!transaction.docChanged || isRemote(transaction)) return next(transaction);
    const state = this.editor.state;
    let tx = transaction;
    try {
      // Text typed or deleted inside someone else's paragraph becomes a suggestion, never a direct edit.
      if (!transaction.getMeta(DIRECT) && hasContentStep(transaction) && touchesOthers(transaction, userId))
        tx = transformToSuggestionTransaction(transaction, state, () => suggestionId(userId, newId()));
      // Judge the real outcome, including what the stamper below will add.
      const after = state.applyTransaction(tx).state.doc;
      // The editor's initial empty paragraph has no id until its first edit: it isn't in the shared story yet, so it can't be "deleted".
      const before = snapshot(state.doc).filter((p) => p.paragraphId);
      const { violations } = validateChange(before, snapshot(after), { id: userId, role });
      if (violations.length) return onReject(violations);
    } catch (e) {
      return onReject([{ code: 'SCHEMA', message: e instanceof Error ? e.message : 'That edit could not be applied' }]);
    }
    next(tx);
  },

  addKeyboardShortcuts() {
    const { userId } = this.options;
    return {
      // Enter inside someone else's (or locked) prose starts the writer's own paragraph after it, instead of splitting theirs.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.depth < 1) return false;
        const para = $from.node(1);
        const mine = !para.attrs.authorId || para.attrs.authorId === userId;
        if (mine && !para.attrs.locked) return false;
        return startPost(editor, userId, $from.after(1));
      },
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      // Give every new paragraph an id and its author; a paragraph made by splitting another gets its own.
      new Plugin({
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged && !isRemote(t))) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          state.doc.forEach((node, offset) => {
            if (node.type.name !== 'paragraph') return;
            const { paragraphId, authorId } = node.attrs;
            const duplicate = !!paragraphId && seen.has(paragraphId);
            if (!paragraphId || duplicate) tr.setNodeAttribute(offset, 'paragraphId', newId());
            if (duplicate) {
              tr.setNodeAttribute(offset, 'authorId', opts.userId);
              tr.setNodeAttribute(offset, 'locked', false);
            } else if (!authorId) tr.setNodeAttribute(offset, 'authorId', opts.userId);
            if (paragraphId) seen.add(paragraphId);
          });
          return tr.docChanged ? tr : null;
        },
      }),
      // Show who wrote each paragraph, in their ink, and which prose is locked.
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              const who = opts.ink(node.attrs.authorId ?? opts.userId);
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  style: `--ink:${who.color}`,
                  'data-author-name': who.name,
                  class: node.attrs.locked ? 'is-locked' : '',
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
