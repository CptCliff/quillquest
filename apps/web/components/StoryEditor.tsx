'use client';
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { StoryParagraph } from '../extensions/story-paragraph';
import { Deletion, Insertion, Modification } from '../extensions/suggestion-marks';
import { StoryGuard, startPost } from '../extensions/story-guard';
import { SkillChips } from '../extensions/skill-chips';
import type { Skill } from '@quillquest/rules';
import { inkFor, nameFor } from '../lib/dev-users';
import { explain } from '../lib/violations';

export interface Me { id: string; name: string; color: string; role: 'player' | 'gm'; left?: boolean }

export function StoryEditor({ doc, provider, me, onEditor, onNotice, mySkills, onOpenAuthor, onChipInfo, onChipRoll, lookupInk, inkVersion }: {
  doc: Y.Doc; provider: HocuspocusProvider; me: Me; onEditor: (e: Editor) => void; onNotice: (msg: string) => void;
  /** The writer's Skills, from their sheet. Read through a ref so chips always show the current rank. */
  /** Name and ink for any member, connected or not; `inkVersion` changes when that list does. */
  lookupInk: (userId: string) => { name: string; color: string } | undefined; inkVersion: number;
  mySkills: () => Skill[]; onOpenAuthor: (userId: string) => void; onChipInfo: (skill: string) => void; onChipRoll: (skill: string, paragraphId: string | null) => void;
}) {
  // Ink for anyone who has written, connected or not: live awareness first, preset colors as the fallback.
  const roster = useRef(new Map<string, { name: string; color: string }>());
  const ink = (id: string) => roster.current.get(id) ?? lookupInk(id) ?? { name: nameFor(id), color: inkFor(id) };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document, Text, StoryParagraph, Insertion, Deletion, Modification,
      Collaboration.configure({ document: doc, field: 'default' }),
      CollaborationCaret.configure({ provider, user: { name: me.name, color: me.color } }),
      StoryGuard.configure({ userId: me.id, role: me.role, ink, onReject: (v) => onNotice(explain(v)), onOpenAuthor }),
      SkillChips.configure({ userId: me.id, getSkills: mySkills, onInfo: onChipInfo, onRoll: onChipRoll }),
    ],
    editable: !me.left,
    editorProps: { attributes: { class: 'story', 'data-testid': 'story', 'aria-label': 'Story' } },
  });

  useEffect(() => {
    if (!editor) return;
    onEditor(editor);
    const sync = () => {
      roster.current.clear();
      provider.awareness?.getStates().forEach((s) => {
        const u = s.user as { id?: string; name?: string; color?: string } | undefined;
        if (u?.id && u.name && u.color) roster.current.set(u.id, { name: u.name, color: u.color });
      });
      // A no-op transaction makes the paragraph decorations re-read the roster.
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('roster', true));
    };
    provider.awareness?.on('change', sync);
    sync();
    return () => provider.awareness?.off('change', sync);
  }, [editor, provider, onEditor]);

  // When the member list changes, repaint the author tags and inks.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('roster', true));
  }, [editor, inkVersion]);

  return (
    <>
      <EditorContent editor={editor} />
      <button className="new-post" data-testid="new-post" disabled={!!me.left} onClick={() => editor && startPost(editor, me.id)}>
        + New post
      </button>
    </>
  );
}
