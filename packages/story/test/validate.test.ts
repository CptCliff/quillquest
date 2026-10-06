import { describe, expect, it } from 'vitest';
import { lockThrough, validateChange, type Actor, type StoryDoc } from '../src';
import { gm, ilse, para, ref, sella } from './helpers';

const codes = (b: StoryDoc, a: StoryDoc, actor: Actor = ilse) => validateChange(b, a, actor).violations.map((v) => v.code);

describe('own text', () => {
  it('the author edits their own unlocked paragraph freely', () => {
    expect(codes([para('p1', 'ilse', 'I climb.')], [para('p1', 'ilse', 'I climb the wall slowly.')])).toEqual([]);
  });
  it('another writer cannot change base text', () => {
    expect(codes([para('p1', 'ilse', 'I climb.')], [para('p1', 'ilse', 'I fall.')], sella)).toContain('NOT_OWNER_EDIT');
  });
  it('another writer cannot reformat base text either', () => {
    const before = para('p1', 'ilse', 'I climb.');
    const after = { ...before, cells: before.cells.map((c) => ({ ...c, fmt: '[["bold",{}]]' })) };
    expect(codes([before], [after], sella)).toContain('NOT_OWNER_EDIT');
  });
});

describe('suggestions', () => {
  it('another writer may add their own insertion', () => {
    const before = para('p1', 'ilse', 'I climb.');
    const after = para('p1', 'ilse', 'I climb.', { ins: [[' Quietly.', ref('s1', 'sella')]] });
    expect(codes([before], [after], sella)).toEqual([]);
  });
  it('another writer may mark their own deletion of base text', () => {
    const before = para('p1', 'ilse', 'I climb slowly.');
    const after = para('p1', 'ilse', 'I climb slowly.', { del: [[' slowly', ref('s1', 'sella')]] });
    expect(codes([before], [after], sella)).toEqual([]);
  });
  it('a suggestion cannot be forged in someone else\'s name', () => {
    const before = para('p1', 'ilse', 'I climb.');
    const after = para('p1', 'ilse', 'I climb.', { ins: [[' Quietly.', ref('s1', 'ilse')]] });
    expect(codes([before], [after], sella)).toContain('SUGGESTION_TAMPER');
  });
  it('a writer cannot remove or alter another writer\'s suggestion', () => {
    const withSug = para('p1', 'ilse', 'I climb.', { ins: [[' Quietly.', ref('s1', 'sella')]] });
    const stripped = para('p1', 'ilse', 'I climb.');
    expect(codes([withSug], [stripped], { id: 'rook', role: 'player' })).toContain('SUGGESTION_TAMPER');
  });
  it('a writer may withdraw their own suggestion', () => {
    const withSug = para('p1', 'ilse', 'I climb.', { ins: [[' Quietly.', ref('s1', 'sella')]] });
    expect(codes([withSug], [para('p1', 'ilse', 'I climb.')], sella)).toEqual([]);
  });
  it('the author accepts a suggestion by editing their own paragraph', () => {
    const withSug = para('p1', 'ilse', 'I climb.', { ins: [[' Quietly.', ref('s1', 'sella')]] });
    expect(codes([withSug], [para('p1', 'ilse', 'I climb. Quietly.')])).toEqual([]);
  });
});

describe('locks', () => {
  const locked = () => para('p1', 'ilse', 'The roll is written.', { locked: true });
  it('nobody edits a locked paragraph, not even the GM', () => {
    const edited = para('p1', 'ilse', 'Rewritten.', { locked: true });
    expect(codes([locked()], [edited])).toContain('LOCKED');
    expect(codes([locked()], [edited], gm)).toContain('LOCKED');
    expect(codes([locked()], [edited], sella)).toContain('LOCKED');
  });
  it('nobody may even suggest on a locked paragraph', () => {
    const after = para('p1', 'ilse', 'The roll is written.', { locked: true, ins: [[' x', ref('s1', 'sella')]] });
    expect(codes([locked()], [after], sella)).toContain('LOCKED');
  });
  it('a player cannot unlock or lock', () => {
    expect(codes([locked()], [{ ...locked(), locked: false }])).toContain('LOCK_CHANGE');
    const open = para('p1', 'ilse', 'Open.');
    expect(codes([open], [{ ...open, locked: true }], sella)).toContain('LOCK_CHANGE');
  });
  it('the GM may unlock (a retcon) and it is reported for the log', () => {
    const r = validateChange([locked()], [{ ...locked(), locked: false }], gm);
    expect(r.violations).toEqual([]);
    expect(r.gmActions).toEqual([{ type: 'unlock', paragraphId: 'p1' }]);
  });
  it('unlocking and editing in one update is still an edit to a locked paragraph', () => {
    expect(codes([locked()], [para('p1', 'ilse', 'Rewritten.')], gm)).toContain('LOCKED');
  });
  it('a locked paragraph cannot be deleted', () => {
    expect(codes([locked()], [])).toContain('LOCKED');
  });
  it('locked paragraphs stay a prefix: no new paragraph above one, no unlocking the middle', () => {
    const doc = [para('p1', 'ilse', 'a', { locked: true }), para('p2', 'ilse', 'b', { locked: true })];
    expect(codes(doc, [para('n', 'sella', 'x'), ...doc], sella)).toContain('LOCK_PREFIX');
    expect(codes(doc, [{ ...doc[0]!, locked: false }, doc[1]!], gm)).toContain('LOCK_PREFIX');
    expect(codes(doc, [doc[0]!, { ...doc[1]!, locked: false }], gm)).toEqual([]);
  });
  it('new paragraphs after the locked prefix are fine', () => {
    const doc = [para('p1', 'ilse', 'a', { locked: true })];
    expect(codes(doc, [...doc, para('n', 'sella', 'x')], sella)).toEqual([]);
  });
  it('lockThrough lists every paragraph up to and including the outcome', () => {
    const doc = [para('a', 'x', ''), para('b', 'x', ''), para('c', 'x', '')];
    expect(lockThrough(doc, 'b')).toEqual(['a', 'b']);
    expect(() => lockThrough(doc, 'zzz')).toThrow(/No paragraph/);
  });
});

describe('structure and authorship', () => {
  it('a new paragraph must carry its creator as author and start unlocked', () => {
    expect(codes([], [para('n', 'sella', 'x')], ilse)).toContain('FORGED_AUTHOR');
    expect(codes([], [para('n', 'ilse', 'x', { locked: true })])).toContain('LOCK_NEW');
    expect(codes([], [para('n', 'ilse', 'x')])).toEqual([]);
  });
  it('only the author may delete a paragraph', () => {
    expect(codes([para('p1', 'ilse', 'x')], [], sella)).toContain('NOT_OWNER_EDIT');
    expect(codes([para('p1', 'ilse', 'x')], [])).toEqual([]);
  });
  it('authorship and ids cannot change; paragraphs cannot reorder or duplicate', () => {
    const a = para('p1', 'ilse', 'a');
    const b = para('p2', 'sella', 'b');
    expect(codes([a], [{ ...a, authorId: 'sella' }], sella)).toContain('AUTHOR_CHANGED');
    expect(codes([a, b], [b, a])).toContain('REORDER');
    expect(codes([a], [a, { ...a }])).toContain('DUPLICATE_ID');
    expect(codes([a], [{ ...a, paragraphId: '' }])).toContain('MISSING_ID');
  });
  it('only the author changes the point of view', () => {
    const a = para('p1', 'ilse', 'a');
    expect(codes([a], [{ ...a, pov: 'borrowed:sella' }], sella)).toContain('POV_CHANGED');
    expect(codes([a], [{ ...a, pov: 'borrowed:sella' }])).toEqual([]);
  });
});
