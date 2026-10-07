import { expect, type Browser, type Page } from '@playwright/test';

const WEB = 'http://localhost:3100';
const SYNC = 'http://localhost:1234';

export async function token(user: string): Promise<string> {
  const res = await fetch(`${WEB}/api/dev-token?user=${user}`);
  if (!res.ok) throw new Error(`no dev token for ${user}`);
  return (await res.json()).token;
}
export async function api(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${SYNC}${path}`, { method, headers: { Authorization: `Bearer ${await token(user)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

let n = 0;
/** A real campaign: gm1 creates it and each player joins by invite. Returns its id. */
export async function createTable(players: string[], title = 'The Border War', beginPlay = true): Promise<string> {
  const made = await api('gm1', 'POST', '/api/campaigns', { title: `${title} ${Date.now()}-${++n}` });
  expect(made.status).toBe(200);
  const id: string = made.json.campaign.id;
  for (const p of players) {
    const inv = await api('gm1', 'POST', `/api/campaigns/${id}/invites`);
    const acc = await api(p, 'POST', '/api/invites/accept', { token: inv.json.invite.token });
    expect(acc.status, `${p} joins`).toBe(200);
  }
  // A table of ready-made sheets (the preset dev users) starts in play; a table with blank characters stays in session zero.
  const presets = ['ilse', 'sella', 'rook'];
  if (beginPlay && players.length && players.every((p) => presets.includes(p))) {
    for (const p of players) await api(p, 'GET', `/api/campaigns/${id}/me`);
    expect((await api('gm1', 'POST', `/api/campaigns/${id}/creation/begin`, {})).status, 'begin play').toBe(200);
  }
  return id;
}

/** Open a table as a dev user (the `?as=` link signs the dev session in) and wait until the editor is live. */
export async function join(browser: Browser, campaign: string, user: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`/story/${campaign}?as=${user}`);
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('story')).toBeVisible();
  return page;
}
