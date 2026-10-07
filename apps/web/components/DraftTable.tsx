'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { Draft } from '@quillquest/rules';
import { ApiFailure, type GameApi } from '../lib/game-api';
import { myParagraphs, useAct } from './Ledger';
import { StoryEditor, type Me } from './StoryEditor';

const none = () => undefined;

/** Your private draft: the same editor, in a document only you can open, with a panel to mark which paragraphs are the Origin and chapters. */
export function DraftTable({ doc, provider, me, campaign, title, status, game, onNotice, notice }: {
  doc: Y.Doc; provider: HocuspocusProvider; me: Me; campaign: string; title: string; status: string; game: GameApi; onNotice: (m: string) => void; notice: string | null;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>({ veteran: false, origin: null, chapters: [] });
  const [problems, setProblems] = useState<string[]>([]);
  const [, bump] = useState(0);
  const { busy, run } = useAct(onNotice);
  useEffect(() => { game.draft().then((r) => { setDraft(r.draft); setProblems(r.problems); }, none); }, [game]);
  useEffect(() => { if (!editor) return; const f = () => bump((n) => n + 1); editor.on('update', f); return () => { editor.off('update', f); }; }, [editor]);

  const paras = editor ? myParagraphs(editor, me.id) : [];
  const options = [{ id: '', text: 'Choose a paragraph…' }, ...paras];
  const max = draft.veteran ? 4 : 3;
  const setChapter = (i: number, patch: Partial<Draft['chapters'][number]>) => setDraft({ ...draft, chapters: draft.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const save = () => run(async () => { const r = await game.saveDraft({ ...draft, chapters: draft.chapters.filter((c) => c.paragraphId) }); setDraft(r.draft); setProblems(r.problems); });
  const bring = () => run(async () => {
    try {
      await game.saveDraft({ ...draft, chapters: draft.chapters.filter((c) => c.paragraphId) }); await game.importDraft(); window.location.assign(`/story/${campaign}`); } catch (e) { onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'); }
  });

  return (
    <div className="app" data-testid="draft-workspace" data-status={status}>
      <header>
        <Link href={`/story/${campaign}`} aria-label="Back to the table">←</Link>
        <strong>{title || 'Quillquest'} · your private draft</strong>
        <span className="muted" data-testid="status">{status}</span>
      </header>
      {notice && <div role="status" className="notice" data-testid="notice">{notice}</div>}
      <main data-tab="story" style={{ ['--split' as string]: '62%' }}>
        <section className="story-pane" aria-label="Draft">
          <p className="muted">Only you can see this. Write your Origin and your Life Chapters, then mark them on the right and bring them to the table.</p>
          <StoryEditor doc={doc} provider={provider} me={me} onEditor={setEditor} onNotice={onNotice} mySkills={() => []} onOpenAuthor={none} onChipInfo={none} onChipRoll={none} lookupInk={() => undefined} inkVersion={0} />
        </section>
        <div className="divider" />
        <section className="notes-pane" aria-label="Mark your draft" data-testid="draft-panel">
          <h3>Mark your draft</h3>
          <label className="field"><span>Your Origin paragraph</span>
            <select data-testid="draft-origin" value={draft.origin?.paragraphId ?? ''} onChange={(e) => setDraft({ ...draft, origin: e.target.value ? { paragraphId: e.target.value } : null })}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" data-testid="draft-veteran" checked={draft.veteran} onChange={(e) => setDraft({ ...draft, veteran: e.target.checked })} /> A veteran: four chapters</label>
          {draft.chapters.map((c, i) => (
            <div key={i} className="card" data-testid="draft-chapter">
              <strong>Chapter {i + 1}</strong>
              <label className="field"><span>Paragraph</span>
                <select data-testid="draft-chapter-paragraph" value={c.paragraphId} onChange={(e) => setChapter(i, { paragraphId: e.target.value })}>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
                </select>
              </label>
              <label className="field"><span>One line: what happened</span><input data-testid="draft-chapter-summary" value={c.summary} onChange={(e) => setChapter(i, { summary: e.target.value })} /></label>
              <label className="check"><input type="checkbox" data-testid="draft-chapter-bad" checked={c.endsBadly} onChange={(e) => setChapter(i, { endsBadly: e.target.checked })} /> This chapter ended badly</label>
              <label className="check"><input type="checkbox" checked={!!c.testedBelief} onChange={(e) => setChapter(i, { testedBelief: e.target.checked })} /> It tested what I believe</label>
              <button type="button" className="linklike" onClick={() => setDraft({ ...draft, chapters: draft.chapters.filter((_, j) => j !== i) })}>remove</button>
            </div>
          ))}
          {draft.chapters.length < max && <button type="button" data-testid="draft-add-chapter" onClick={() => setDraft({ ...draft, chapters: [...draft.chapters, { paragraphId: '', summary: '', endsBadly: false }] })}>Add a chapter</button>}
          <div className="actions">
            <button type="button" data-testid="draft-save" disabled={busy} onClick={save}>Save marks</button>
            <button type="button" data-testid="draft-bring" disabled={busy} onClick={bring}>Bring my draft to the table</button>
          </div>
          {problems.length > 0 && <ul data-testid="draft-problems">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
          {problems.length === 0 && draft.origin && <p data-testid="draft-ok">Your draft is ready to bring to the table.</p>}
        </section>
      </main>
    </div>
  );
}
