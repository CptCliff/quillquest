import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newCard } from '@quillquest/rules';
import { FileGameStore, MemoryGameStore, emptyState } from '../src/game/store';

const withCard = () => {
  const s = emptyState();
  s.cards.c1 = newCard({ id: 'c1', actorId: 'ilse', characterId: 'ilse-pc', anchorParagraphId: 'p1', skill: { name: 'Climb', rank: 'Capable' }, want: 'Climb' });
  s.order.push('c1');
  s.seq = 1;
  return s;
};

describe('game stores', () => {
  it('the file store survives a restart: what was saved is what loads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qq-game-'));
    await new FileGameStore(dir).save('table-1', withCard());
    const loaded = await new FileGameStore(dir).load('table-1');
    expect(loaded.cards.c1).toMatchObject({ id: 'c1', want: 'Climb', status: 'draft' });
    expect(loaded.order).toEqual(['c1']);
    expect(await readdir(dir)).toEqual(['table-1.game.json']); // no temp file left behind
  });
  it('an unknown campaign loads empty, and a bad campaign id is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qq-game-'));
    expect(await new FileGameStore(dir).load('nothing-yet')).toEqual(emptyState());
    await expect(new FileGameStore(dir).load('../escape')).rejects.toThrow(/bad campaign id/);
  });
  it('the memory store hands out copies, so a failed mutation cannot leak into saved state', async () => {
    const store = new MemoryGameStore();
    await store.save('t', withCard());
    const a = await store.load('t');
    a.cards.c1!.want = 'changed in memory only';
    expect((await store.load('t')).cards.c1!.want).toBe('Climb');
  });
});
