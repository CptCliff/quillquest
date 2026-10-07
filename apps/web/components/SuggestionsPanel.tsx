'use client';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { applySuggestion, revertSuggestion } from '@handlewithcare/prosemirror-suggest-changes';
import { authorOfSuggestion } from '@quillquest/story';
import { DIRECT } from '../extensions/story-guard';
import { nameFor } from '../lib/dev-users';

interface Suggestion { id: string; inserted: string; deleted: string; paragraphAuthor: string; paragraphId: string }

function collect(editor: Editor): Suggestion[] {
  const found = new Map<string, Suggestion>();
  editor.state.doc.forEach((para) => {
    para.descendants((node) => {
      if (!node.isText) return;
      for (const m of node.marks) {
        if (m.type.name !== 'insertion' && m.type.name !== 'deletion') continue;
        const id = String(m.attrs.id);
        const s = found.get(id) ?? { id, inserted: '', deleted: '', paragraphAuthor: para.attrs.authorId ?? '', paragraphId: para.attrs.paragraphId ?? '' };
        if (m.type.name === 'insertion') s.inserted += node.text;
        else s.deleted += node.text;
        found.set(id, s);
      }
    });
  });
  return [...found.values()];
}

export function SuggestionsPanel({ editor, userId }: { editor: Editor; userId: string }) {
  const list = useEditorState({ editor, selector: ({ editor }) => collect(editor), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const run = (cmd: ReturnType<typeof applySuggestion>) => {
    const view = editor.view;
    cmd(view.state, (tr) => view.dispatch(tr.setMeta(DIRECT, true)), view);
  };
  return (
    <section aria-label="Suggestions" data-testid="suggestions">
      <h3>Suggestions</h3>
      {list.length === 0 && <p className="muted">None yet. Type in someone else's paragraph to suggest a change.</p>}
      <ul className="suggestions">
        {list.map((s) => {
          const owner = s.paragraphAuthor === userId;
          const mine = authorOfSuggestion(s.id) === userId;
          return (
            <li key={s.id} data-testid="suggestion">
              <div>
                <strong>{nameFor(authorOfSuggestion(s.id))}</strong> suggests in {nameFor(s.paragraphAuthor)}'s paragraph
              </div>
              {s.inserted && <div><ins>{s.inserted}</ins></div>}
              {s.deleted && <div><del>{s.deleted}</del></div>}
              <div className="actions">
                {owner && <button data-testid="suggestion-accept" onClick={() => run(applySuggestion(s.id))}>Accept</button>}
                {(owner || mine) && <button data-testid="suggestion-reject" onClick={() => run(revertSuggestion(s.id))}>{owner ? 'Reject' : 'Withdraw'}</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
