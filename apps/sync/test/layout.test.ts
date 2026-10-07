import { afterEach, describe, expect, it } from 'vitest';
import { defaultLayout, findGroup, movePanel, presets } from '@quillquest/layout';
import { type Identity } from '../src/auth';
import { GM, ILSE, SELLA, api, startServer } from './helpers';

const open: { destroy(): void | Promise<void> }[] = [];
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });
const base = '/api/campaigns/campaign-1/layout';

async function table() {
  const s = await startServer();
  open.push({ destroy: () => s.server.destroy() });
  const call = (who: Identity | null, method: string, device: string, body?: unknown) => api(s.http, who, method, `${base}?device=${device}`, body);
  return { ...s, call };
}

describe('saved layouts', () => {
  it('a new member gets the default for their role; GMs get the Director, players get Creation, never the other', async () => {
    const t = await table();
    const p = await t.call(ILSE, 'GET', 'wide');
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ saved: false, layout: defaultLayout('player') });
    const g = await t.call(GM, 'GET', 'wide');
    expect(g.json.layout).toEqual(defaultLayout('gm'));
    expect(JSON.stringify(p.json)).not.toContain('director');
  });
  it('saves what a person arranges, per device, and gives it back', async () => {
    const t = await table();
    const mine = movePanel(defaultLayout('player'), 'roster', findGroup(defaultLayout('player'), 'story')!.id, 'bottom');
    const put = await t.call(ILSE, 'PUT', 'wide', { layout: mine });
    expect(put.status).toBe(200);
    expect((await t.call(ILSE, 'GET', 'wide')).json).toMatchObject({ saved: true, layout: mine });
    expect((await t.call(ILSE, 'GET', 'phone')).json.saved).toBe(false); // phone and wide are separate
    await t.call(ILSE, 'PUT', 'phone', { layout: presets.focus('player') });
    expect((await t.call(ILSE, 'GET', 'phone')).json.layout).toEqual(presets.focus('player'));
    expect((await t.call(ILSE, 'DELETE', 'wide')).json).toMatchObject({ saved: false, layout: defaultLayout('player') });
    expect((await t.call(ILSE, 'GET', 'wide')).json.saved).toBe(false);
  });
  it('is private: nobody else can read it, and what one person saves never reaches another', async () => {
    const t = await table();
    await t.call(ILSE, 'PUT', 'wide', { layout: presets.reading('player') });
    expect((await t.call(SELLA, 'GET', 'wide')).json).toMatchObject({ saved: false, layout: defaultLayout('player') });
    expect((await t.call(GM, 'GET', 'wide')).json.saved).toBe(false);
    expect((await t.call(null, 'GET', 'wide')).status).toBe(401);
    expect((await t.call(null, 'PUT', 'wide', { layout: presets.reading('player') })).status).toBe(401);
  });
  it('refuses a malformed layout, a panel the role may not have, a bad device, and an oversized body', async () => {
    const t = await table();
    const withDirector = movePanel(defaultLayout('gm'), 'director', findGroup(defaultLayout('gm'), 'story')!.id, 'center');
    expect((await t.call(ILSE, 'PUT', 'wide', { layout: withDirector })).json.error.code).toBe('BAD_LAYOUT'); // a player cannot have the Director
    expect((await t.call(GM, 'PUT', 'wide', { layout: withDirector })).status).toBe(200);
    for (const layout of [null, 'x', { v: 2 }, { v: 1, hidden: [], root: { kind: 'group', id: 'g1', tabs: ['ledger'], active: 'ledger' } }, { ...defaultLayout('player'), hidden: ['bogus'] }])
      expect((await t.call(ILSE, 'PUT', 'wide', { layout })).status, JSON.stringify(layout)).toBe(400);
    expect((await t.call(ILSE, 'PUT', 'tablet', { layout: defaultLayout('player') })).status).toBe(400);
    expect((await t.call(ILSE, 'GET', 'tablet')).status).toBe(400);
    expect((await t.call(ILSE, 'PUT', 'wide', { layout: { ...defaultLayout('player'), junk: 'x'.repeat(70_000) } })).status).toBe(413);
  });
  it('a GM's arrangement, Director included, comes back as saved', async () => {
    const t = await table();
    const gmLayout = movePanel(defaultLayout('gm'), 'director', findGroup(defaultLayout('gm'), 'story')!.id, 'center');
    await t.call(GM, 'PUT', 'wide', { layout: gmLayout });
    expect((await t.call(GM, 'GET', 'wide')).json.layout).toEqual(gmLayout);
  });
});
