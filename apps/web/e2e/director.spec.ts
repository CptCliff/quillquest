import { expect, test, type Page } from '@playwright/test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { api, createTable, join, token } from './helpers';

const paragraphs = (p: Page) => p.locator('.story-pane .story p');
async function write(page: Page, text: string, first = false) {
  if (first) await paragraphs(page).first().click();
  else await page.getByTestId('new-post').click();
  await page.keyboard.type(text);
}
const commit = async (field: ReturnType<Page['getByTestId']>, text: string) => { await field.fill(text); await field.blur(); };
const director = (p: Page) => p.getByTestId('director');

test('the GM runs the table: Beliefs board, a pending card, Conviction, NPC reveals, notes, and Claude drafts that are logged', async ({ browser }) => {
  test.setTimeout(150_000);
  const t = await createTable(['ilse', 'sella']);
  const gm = await join(browser, t, 'gm1');
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  await gm.getByTestId('tab-director').click();

  // The Beliefs board shows every character's three Beliefs, Core marked, and Conviction.
  await expect(director(gm).getByTestId('board-character')).toHaveCount(2);
  await expect(director(gm).getByTestId('board-belief')).toHaveCount(6);
  await expect(director(gm).locator('[data-character="ilse-pc"]')).toContainText('Core: Oaths outlast the people who swear them');
  await expect(director(gm).locator('[data-character="ilse-pc"] [data-testid="board-conviction"]')).toHaveAttribute('aria-label', '1 Conviction');

  // A pending card appears for the GM, who adjusts its ranks and Sets it.
  await write(ilse, 'I reach the wall and start to climb.', true);
  await ilse.getByTestId('new-roll-open').click();
  const card = ilse.getByTestId('card').first();
  await commit(card.getByTestId('want'), 'Climb the wall');
  await commit(card.getByTestId('risk'), 'I twist an ankle');
  await commit(card.getByTestId('danger-text'), 'I twist an ankle');
  await card.getByTestId('danger-kind').selectOption('wound');
  await card.getByTestId('difficulty').selectOption('Demanding');
  await expect(director(gm).getByTestId('pending-card')).toHaveCount(1);
  await director(gm).getByTestId('pending-danger').selectOption('Serious');
  await director(gm).getByTestId('pending-difficulty').selectOption('Hard');
  await director(gm).getByTestId('pending-set').click();
  await expect(director(gm).getByTestId('pending-card').locator('.badge')).toContainText('set');
  await expect(card.getByTestId('odds')).toBeVisible();

  // Sella nominates Ilse's moment; the GM awards it; the log is in the Codex for everyone; the board shows the token.
  await sella.getByTestId('tab-roster').click();
  await sella.locator('[data-character="ilse-pc"]').getByTestId('nominate-open').click();
  await sella.getByTestId('nominate-ilse-pc-kind').selectOption('other');
  await sella.getByTestId('nominate-ilse-pc-note').fill('She gave up the lead to save Sella');
  await sella.getByTestId('nominate-ilse-pc-go').click();
  await expect(director(gm).getByTestId('nomination')).toContainText('She gave up the lead to save Sella');
  await director(gm).getByTestId('nomination-award').click();
  await expect(director(gm).locator('[data-character="ilse-pc"] [data-testid="board-conviction"]')).toHaveAttribute('aria-label', '2 Conviction');
  await sella.getByTestId('tab-codex').click();
  await expect(sella.getByTestId('codex-conviction-entry')).toHaveText('Ilse: She gave up the lead to save Sella');

  // NPC: nothing shows to players until the GM reveals a field, and then only that field.
  await director(gm).getByTestId('npc-new-name').fill('Captain Aldous');
  await director(gm).getByTestId('npc-new-go').click();
  const npc = director(gm).getByTestId('npc');
  await expect(npc).toHaveCount(1);
  const id = (await npc.getAttribute('data-npc'))!;
  await director(gm).getByTestId(`npc-${id}-skills`).fill('Swordplay Expert');
  await director(gm).getByTestId(`npc-${id}-beliefs`).fill('The crown is owed obedience');
  await director(gm).getByTestId(`npc-${id}-notes`).fill('Secretly takes the duke\'s coin');
  await director(gm).getByTestId(`npc-${id}-go`).click();
  await expect(npc.getByTestId('npc-reveal-beliefs')).toBeVisible();
  await sella.getByTestId('tab-roster').click();
  await expect(sella.getByTestId('npc-public')).toHaveCount(0);
  await npc.getByTestId('npc-reveal-beliefs').click();
  await expect(sella.getByTestId('npc-public-beliefs')).toContainText('The crown is owed obedience');
  await expect(sella.getByTestId('npc-public')).toContainText('Someone');
  await expect(sella.getByTestId('npc-public')).not.toContainText('Aldous');
  await expect(sella.getByTestId('npc-public')).not.toContainText('duke');
  await expect(sella.getByTestId('npc-public')).not.toContainText('Swordplay');
  await npc.getByTestId('npc-reveal-name').click();
  await expect(sella.getByTestId('npc-public')).toContainText('Captain Aldous');

  // GM notes: a private editor.
  const notes = director(gm).getByTestId('gm-notes');
  await expect(notes.locator('.story')).toBeVisible();
  await notes.locator('.story p').first().click();
  await gm.keyboard.type('Aldous is the duke\'s man; reveal at the bridge.');
  await expect(notes.locator('.story')).toContainText('reveal at the bridge');
  await expect(sella.locator('.story').first()).not.toContainText('reveal at the bridge');

  // Claude: each request returns a draft the GM can use, edit or dismiss, and each is logged. The oracle waits for its six faces.
  await director(gm).locator('[data-character="ilse-pc"]').getByTestId('board-challenge').first().click();
  await expect(director(gm).locator('[data-kind="beliefChallenge"]').getByTestId('ai-draft-text')).toHaveValue(/captain offers a deal/);
  await director(gm).getByTestId('ai-use').click();
  await expect(director(gm).getByTestId('ai-draft')).toHaveCount(0);
  await director(gm).getByTestId('pending-sharpen').click();
  await expect(director(gm).locator('[data-kind="danger"]').getByTestId('ai-draft-text')).toHaveValue(/ledger is stolen/);
  await director(gm).getByTestId('ai-dismiss').click();
  await director(gm).getByTestId('npc-line').click();
  const line = director(gm).locator('[data-kind="npcLine"]').getByTestId('ai-draft-text');
  await expect(line).toHaveValue(/should not be here/);
  await line.fill('You should not be here, friend.');
  await director(gm).getByTestId('ai-use').click();
  await director(gm).getByTestId('ask-oracle').click();
  await expect(gm.getByTestId('notice')).toContainText('six Burden faces');
  await director(gm).getByTestId('settings-themes').fill('cruelty to animals');
  for (const [i, f] of ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'].entries()) await director(gm).getByTestId(`settings-f${i}`).fill(f);
  await director(gm).getByTestId('settings-go').click();
  await director(gm).getByTestId('ask-oracle').click();
  await expect(director(gm).locator('[data-kind="oracle"]').getByTestId('ai-draft-text')).toHaveValue(/A rival: The rival is waiting/);
  await expect(director(gm).getByTestId('claude-log').locator('[data-status="used"]')).toHaveCount(1);
  await expect(director(gm).getByTestId('claude-log').locator('[data-status="edited"]')).toHaveCount(1);
  await expect(director(gm).getByTestId('claude-log').locator('[data-status="dismissed"]')).toHaveCount(1);
  await expect(director(gm).getByTestId('claude-log').locator('[data-status="shown"]')).toHaveCount(1); // the oracle draft, not yet settled

  // A new session lets Beliefs earn again.
  gm.once('dialog', (d) => d.accept());
  await director(gm).getByTestId('start-session').click();
  await expect(director(gm).getByTestId('session-no')).toHaveText('session 2');
});

test('a player cannot reach any GM data: no Director tab, GM routes refuse, the GM notes document refuses', async ({ browser }) => {
  const t = await createTable(['ilse']);
  await join(browser, t, 'gm1');
  const ilse = await join(browser, t, 'ilse');
  await expect(ilse.getByTestId('tab-director')).toHaveCount(0);
  await api('gm1', 'POST', `/api/campaigns/${t}/npcs`, { name: 'Hidden' });
  for (const [method, path, body] of [['GET', '/director', undefined], ['PUT', '/settings', { cap: 1 }], ['POST', '/npcs', { name: 'x' }], ['POST', '/llm/npcLine', { npcId: 'npc-1' }]] as const) {
    const r = await api('ilse', method, `/api/campaigns/${t}${path}`, body);
    expect(r.status, path).toBe(403);
  }
  // The notes document: the server turns a player's connection away, and lets the GM in.
  const open = (user: string) => new Promise<string>(async (resolve) => {
    const tok = await token(user);
    const provider = new HocuspocusProvider({
      url: 'ws://localhost:1234', name: `${t}~gm`, document: new Y.Doc(), token: tok,
      onAuthenticationFailed: () => { resolve('denied'); provider.destroy(); }, onSynced: () => { resolve('synced'); provider.destroy(); },
    });
    setTimeout(() => { resolve('timeout'); provider.destroy(); }, 8000);
  });
  expect(await open('ilse')).toBe('denied');
  expect(await open('gm1')).toBe('synced');
});

test('Claude for players: a paraphrase gets a dashed Skill chip until tapped; Belief checks and grant ideas are drafts', async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await createTable(['ilse', 'mira', 'tobin']);
  const ilse = await join(browser, t, 'ilse');
  const mira = await join(browser, t, 'mira');
  const tobin = await join(browser, t, 'tobin');

  // "I creep past the guards." names no Skill the code can match, so after a pause Claude is asked: a dashed chip, then solid when tapped.
  await write(ilse, 'I creep past the guards.', true);
  await expect(ilse.getByTestId('skill-chip-suggested')).toBeVisible({ timeout: 8000 });
  await expect(ilse.getByTestId('skill-chip')).toHaveCount(0); // never solid until she taps it
  await ilse.getByTestId('chip-accept').click();
  await expect(ilse.getByTestId('skill-chip')).toHaveAttribute('data-skill', 'Climb'); // the fake model picks the first Skill on her sheet
  await expect(ilse.getByTestId('skill-chip-suggested')).toHaveCount(0);

  // Mira, still creating, asks Claude whether her Beliefs hold a conviction and an action.
  await mira.getByTestId('tab-create').click();
  await mira.getByTestId('beliefs-objective').fill('Expose the duke');
  await mira.getByTestId('beliefs-check').click();
  await expect(mira.getByTestId('belief-check-result')).toContainText('Add what you will do about it.');

  // Grant ideas for Mira's chapter, offered to Tobin, who can send one straight to the grant card.
  await write(mira, 'My origin.');
  await write(mira, 'I held the barricade for three nights.');
  const idOf = (i: number) => mira.locator('.story p[data-author="mira"]').nth(i).getAttribute('data-paragraph-id');
  const origin = await idOf(0);
  const chapter = await idOf(1);
  await expect.poll(() => api('mira', 'POST', `/api/campaigns/${t}/creation/origin-post`, { paragraphId: origin }).then((r) => r.status)).toBe(200);
  expect((await api('mira', 'POST', `/api/campaigns/${t}/creation/chapter`, { paragraphId: chapter, summary: 'The siege', endsBadly: false })).status).toBe(200);
  await tobin.getByTestId('tab-create').click();
  const grant = tobin.locator('[data-testid="grant-card"][data-character="mira-pc"][data-chapter="0"]');
  await grant.getByTestId('grant-suggest').click();
  await expect(grant.getByTestId('idea-skill')).toHaveCount(2);
  await expect(grant.getByTestId('idea-trait')).toHaveCount(2);
  await grant.getByTestId('idea-skill').first().click();
  await expect(grant.locator('[data-testid="grant-skill"] [data-testid="proposal"]')).toContainText('Siegecraft');
});
