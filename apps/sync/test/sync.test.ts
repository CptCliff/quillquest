import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryStore } from '../src/store';
import { REJECTED_PREFIX } from '../src/server';
import { ILSE, SELLA, GM, addParagraph, attrs, connect, para, plain, startServer, textOf, waitFor, type Client } from './helpers';

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

async function table() {
  const s = await startServer();
  track({ destroy: () => s.server.destroy() });
  const ilse = track(await connect(s.url, ILSE));
  const sella = track(await connect(s.url, SELLA));
  const gm = track(await connect(s.url, GM));
  return { ...s, ilse, sella, gm };
}
const rejected = (c: Client) => waitFor(() => c.closes.some((x) => x.reason.startsWith(REJECTED_PREFIX)));

describe('co-writing', () => {
  it('writers converge on the same story', async () => {
    const t = await table();
    addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'I climb the wall.');
    await waitFor(() => t.sella.fragment.length === 1);
    expect(textOf(para(t.sella.fragment, 0))).toBe('I climb the wall.');
    addParagraph(t.sella.fragment, attrs('p2', 'sella'), 'Sella watches the road.');
    await waitFor(() => t.ilse.fragment.length === 2 && t.gm.fragment.length === 2);
  });

  it('an author edits their own paragraph; another writer\'s suggestion goes through', async () => {
    const t = await table();
    const p = addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'I climb.');
    await waitFor(() => t.sella.fragment.length === 1);
    (p.get(0) as Y.XmlText).insert(8, ' Slowly.');
    const theirs = para(t.sella.fragment, 0).get(0) as Y.XmlText;
    await waitFor(() => plain(theirs) === 'I climb. Slowly.');
    theirs.insert(theirs.length, ' Quietly.', { insertion: { id: 'sella.1' } });
    await waitFor(() => plain(p.get(0) as Y.XmlText) === 'I climb. Slowly. Quietly.');
    expect(t.sella.closes).toEqual([]);
  });
});

describe('server enforcement (a hostile client that skips every UI check)', () => {
  it('rejects a direct edit to someone else\'s text, closes the sender, and leaves the story untouched', async () => {
    const t = await table();
    addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'I climb.');
    await waitFor(() => t.sella.fragment.length === 1);
    (para(t.sella.fragment, 0).get(0) as Y.XmlText).insert(0, 'HACKED ');
    await rejected(t.sella);
    expect(textOf(para(t.ilse.fragment, 0))).toBe('I climb.');
    expect(t.sella.closes.at(-1)?.reason).toContain('NOT_OWNER_EDIT');
  });

  it('rejects forging a suggestion in another writer\'s name', async () => {
    const t = await table();
    addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'I climb.');
    await waitFor(() => t.sella.fragment.length === 1);
    const text = para(t.sella.fragment, 0).get(0) as Y.XmlText;
    text.insert(text.length, ' x', { insertion: { id: 'ilse.9' } });
    await rejected(t.sella);
    expect(t.sella.closes.at(-1)?.reason).toContain('SUGGESTION_TAMPER');
  });

  it('rejects a paragraph created in someone else\'s name', async () => {
    const t = await table();
    addParagraph(t.sella.fragment, attrs('p9', 'ilse'), 'Ilse says something she never said.');
    await rejected(t.sella);
    expect(t.ilse.fragment.length).toBe(0);
  });

  it('rejects a player locking or unlocking prose; the GM may, and it is logged', async () => {
    const t = await table();
    const p = addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'The outcome.');
    await waitFor(() => t.gm.fragment.length === 1 && t.sella.fragment.length === 1);

    para(t.sella.fragment, 0).setAttribute('locked', true as never);
    await rejected(t.sella);
    expect(p.getAttribute('locked') as unknown).toBe(false);

    para(t.gm.fragment, 0).setAttribute('locked', true as never);
    await waitFor(() => (p.getAttribute('locked') as unknown) === true);
    expect(t.store.overrides).toMatchObject([{ gmId: 'gm1', action: 'lock', paragraphId: 'p1' }]);
  });

  it('a locked paragraph refuses its own author, and the GM, but the GM can unlock first (a retcon)', async () => {
    const t = await table();
    const p = addParagraph(t.ilse.fragment, attrs('p1', 'ilse', { locked: true }), 'Settled.');
    // The paragraph was created locked by a player: that itself is rejected.
    await rejected(t.ilse);

    // Lock it properly through the GM instead.
    const t2 = await table();
    const q = addParagraph(t2.ilse.fragment, attrs('p1', 'ilse'), 'Settled.');
    await waitFor(() => t2.gm.fragment.length === 1);
    para(t2.gm.fragment, 0).setAttribute('locked', true as never);
    await waitFor(() => (q.getAttribute('locked') as unknown) === true);

    (q.get(0) as Y.XmlText).insert(0, 'Edited. ');
    await rejected(t2.ilse);
    expect(textOf(para(t2.gm.fragment, 0))).toBe('Settled.');

    // The GM, in a fresh connection, retcons: unlock, then the author edits.
    const gm2 = track(await connect(t2.url, GM));
    const author2 = track(await connect(t2.url, ILSE));
    para(gm2.fragment, 0).setAttribute('locked', false as never);
    await waitFor(() => (para(author2.fragment, 0).getAttribute('locked') as unknown) === false);
    (para(author2.fragment, 0).get(0) as Y.XmlText).insert(0, 'Retconned. ');
    await waitFor(() => textOf(para(gm2.fragment, 0)) === 'Retconned. Settled.');
    expect(t2.store.overrides.map((o) => o.action)).toEqual(['lock', 'unlock']);
    void p;
  });

  it('rejects an unsigned or tampered token', async () => {
    const t = await table();
    await expect(connect(t.url, ILSE, 'campaign-1', 'nonsense')).rejects.toThrow();
    const forged = Buffer.from(JSON.stringify({ ...ILSE, role: 'gm' })).toString('base64url') + '.bogus';
    await expect(connect(t.url, ILSE, 'campaign-1', forged)).rejects.toThrow();
  });
});

describe('persistence', () => {
  it('a restarted server restores the story from its store', async () => {
    const store = new MemoryStore();
    const a = await startServer(store);
    const c = await connect(a.url, ILSE);
    addParagraph(c.fragment, attrs('p1', 'ilse'), 'Still here after a restart.');
    await waitFor(() => a.server.hocuspocus.getDocumentsCount() === 1);
    await new Promise((r) => setTimeout(r, 50));
    c.destroy();
    await a.server.destroy(); // flushes pending stores
    expect(store.docs.has('campaign-1')).toBe(true);

    const b = await startServer(store);
    track({ destroy: () => b.server.destroy() });
    const c2 = track(await connect(b.url, SELLA));
    await waitFor(() => c2.fragment.length === 1);
    expect(textOf(para(c2.fragment, 0))).toBe('Still here after a restart.');
  });
});
