import { expect, test, type Page } from '@playwright/test';
import { api, createTable, join } from './helpers';

const paragraphs = (p: Page) => p.locator('.story p');
const textOf = (p: Page, i: number) =>
  paragraphs(p).nth(i).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.collaboration-carets__caret, .author-tag, .skill-chip').forEach((n) => n.remove());
    return copy.textContent ?? '';
  });
const type = async (page: Page, text: string, first = true) => {
  if (first) await paragraphs(page).first().click();
  await page.keyboard.type(text);
};

test('a GM makes a campaign and three accounts join by invite link; each sees all the sheets', async ({ browser }) => {
  // The GM signs in, creates the campaign from the dashboard, and makes three invite links.
  const gmCtx = await browser.newContext();
  const gm = await gmCtx.newPage();
  await gm.goto('/?as=gm1');
  await expect(gm.getByTestId('dashboard')).toBeVisible();
  await gm.getByTestId('campaign-title').fill('The Border War');
  await gm.getByTestId('campaign-create').click();
  await expect(gm.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  await expect(gm.getByTestId('me')).toContainText('GM');
  await gm.getByTestId('tab-director').click();
  const links: string[] = [];
  for (let i = 0; i < 3; i++) {
    await gm.getByTestId('invite-create').click();
    await expect(gm.getByTestId('invite-link')).toHaveValue(/\/join\//);
    links.push(await gm.getByTestId('invite-link').inputValue());
  }
  expect(new Set(links).size).toBe(3);

  // Three different accounts open their links, are signed in, and land at the table.
  const players: Page[] = [];
  for (const [user, link] of [['ilse', links[0]!], ['sella', links[1]!], ['rook', links[2]!]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${link}?as=${user}`);
    await expect(page).toHaveURL(/\/story\//);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
    players.push(page);
  }

  // Each sees all three sheets, with the right names.
  for (const page of [...players, gm]) {
    await page.getByTestId('tab-roster').click();
    await expect(page.getByTestId('sheet')).toHaveCount(3);
    for (const name of ['Ilse', 'Sella', 'Rook']) await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  }
  // Starter characters differ, and the owner is who you would expect.
  await expect(players[0]!.locator('[data-character="ilse-pc"] [data-testid="skills"]')).toContainText('Sneak Expert');
  await expect(players[1]!.locator('[data-character="sella-pc"] [data-testid="skills"]')).toContainText('Swordplay Expert');

  // The GM sees four members, each with their own ink.
  await gm.getByTestId('tab-director').click();
  await expect(gm.getByTestId('member')).toHaveCount(4);
  const inks = await gm.getByTestId('member').locator('.dot').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(inks).size).toBe(4);
  await expect(gm.getByTestId('invite')).toHaveCount(3);
  await expect(gm.locator('[data-testid="invite"][data-status="used"]')).toHaveCount(3);
});

test('a Skill chip shows the right rank from the sheet, and info cards open from names and chips', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');

  // The chip: a Skill used in the sentence being written, with the rank from the sheet.
  await type(ilse, 'I sneak along the wall.');
  await expect(ilse.getByTestId('chip-info')).toHaveText('Sneak · Expert');
  await ilse.keyboard.type(' Then I climbed it.'); // the sentence moves on
  await expect(ilse.getByTestId('chip-info')).toHaveText('Climb · Capable');
  expect(await textOf(ilse, 0)).toBe('I sneak along the wall. Then I climbed it.'); // a chip never touches the text

  // A paraphrase is not a code match (that is Claude's job in a later milestone), so no chip.
  await ilse.keyboard.type(' I creep toward the door');
  await expect(ilse.getByTestId('skill-chip')).toHaveCount(0);
  // Back in the Sneak sentence, the chip returns; the cross hides it.
  await ilse.keyboard.press('Home');
  await expect(ilse.getByTestId('chip-info')).toHaveText('Sneak · Expert');
  await ilse.getByTestId('chip-dismiss').click();
  await expect(ilse.getByTestId('skill-chip')).toHaveCount(0);

  // Another player does not see chips in someone else's paragraph.
  await expect(sella.getByTestId('skill-chip')).toHaveCount(0);

  // Tap the chip name: the Skill's info card.
  await ilse.keyboard.press('End');
  await ilse.keyboard.type(' I sneak again.');
  await ilse.getByTestId('chip-info').click();
  await expect(ilse.getByTestId('infocard')).toHaveAttribute('data-kind', 'skill');
  await expect(ilse.getByTestId('infocard-title')).toHaveText('Sneak · Expert');
  await ilse.getByTestId('infocard-close').click();
  await expect(ilse.getByTestId('infocard')).toHaveCount(0);

  // Tap an author's name in the story: that character's card, visible to everyone (open table).
  await sella.getByTestId('author-tag').first().click();
  await expect(sella.getByTestId('infocard')).toHaveAttribute('data-kind', 'character');
  await expect(sella.getByTestId('infocard-title')).toContainText('Ilse');
  await expect(sella.getByTestId('infocard')).toContainText('Oaths outlast the people who swear them'); // her Core Belief
  // From the card, a Skill opens its own card, and "Open full sheet" goes to the Roster.
  await sella.getByTestId('skill-Climb').click();
  await expect(sella.getByTestId('infocard-title')).toHaveText('Climb · Capable');
  await expect(sella.getByTestId('skill-notes')).toContainText("Father's Sword"); // a possession that could shift it up
  await sella.getByTestId('infocard-close').click();
  await sella.getByTestId('author-tag').first().click();
  await sella.getByTestId('open-sheet').click();
  await expect(sella.getByTestId('roster')).toBeVisible();
  await expect(sella.locator('[data-character="ilse-pc"]')).toHaveClass(/focus/);

  // The chip's Roll button opens a card with that Skill (the writer's explicit tap, never automatic).
  await ilse.getByTestId('tab-ledger').click();
  await expect(ilse.getByTestId('card')).toHaveCount(0);
  await ilse.getByTestId('chip-roll').click();
  await expect(ilse.getByTestId('card')).toHaveCount(1);
  await expect(ilse.getByTestId('card').first()).toContainText('Sneak');
});

test('a stranger is turned away, and a member who leaves can read but not write', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  await type(ilse, 'Written before I left.');
  await expect(paragraphs(sella).first()).toContainText('Written before I left.');

  // Rook never joined: no table, no document.
  const ctx = await browser.newContext();
  const rook = await ctx.newPage();
  await rook.goto(`/story/${t}?as=rook`);
  await expect(rook.getByTestId('denied')).toBeVisible();
  await expect(rook.getByTestId('story')).toHaveCount(0);

  // Ilse leaves from the Roster.
  ilse.once('dialog', (d) => d.accept());
  await ilse.getByTestId('tab-roster').click();
  await ilse.getByTestId('leave').click();
  await expect(ilse.getByTestId('dashboard')).toBeVisible();
  await expect(ilse.locator(`[data-testid=campaign]:has(a[href="/story/${t}"])`)).toContainText('left');
  await sella.getByTestId('tab-roster').click();
  await expect(sella.locator('[data-character="ilse-pc"] h3')).toContainText('(left)');

  // She can still open it and read, but the story is not editable and she cannot post.
  await ilse.goto(`/story/${t}`);
  await expect(ilse.getByTestId('left-banner')).toBeVisible();
  await expect(paragraphs(ilse).first()).toContainText('Written before I left.');
  await expect(ilse.getByTestId('new-post')).toBeDisabled();
  await paragraphs(ilse).first().click();
  await ilse.keyboard.press('End');
  await ilse.keyboard.type(' Sneaky.');
  await expect(paragraphs(sella).first()).not.toContainText('Sneaky');
  await expect(ilse.getByTestId('new-roll')).toHaveCount(0);
});

test('an invite works once; a revoked invite does not work at all', async ({ browser }) => {
  const t = await createTable([]);
  const gm = await join(browser, t, 'gm1');
  await gm.getByTestId('tab-director').click();
  await gm.getByTestId('invite-create').click();
  const link = await gm.getByTestId('invite-link').inputValue();
  await gm.getByTestId('invite-create').click();
  await expect(gm.getByTestId('invite-link')).not.toHaveValue(link); // wait for the new link to replace the old one
  const second = await gm.getByTestId('invite-link').inputValue();

  const open = async (url: string, user: string) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${url}?as=${user}`);
    return page;
  };
  const a = await open(link, 'ilse');
  await expect(a).toHaveURL(/\/story\//);
  const b = await open(link, 'sella');
  await expect(b.getByTestId('join-error')).toContainText('already been used');

  // Revoke the second link before anyone uses it.
  await gm.locator('[data-testid="invite"][data-status="open"]').first().getByTestId('invite-revoke').click();
  await expect(gm.locator('[data-testid="invite"][data-status="revoked"]')).toHaveCount(1);
  const c = await open(second, 'rook');
  await expect(c.getByTestId('join-error')).toContainText('cancelled');
});

test('on a phone, a card waiting on you puts a dot on the Notes tab, and info cards open as a bottom sheet', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const desk = await join(browser, t, 'ilse');
  const phone = await join(browser, t, 'ilse', { width: 390, height: 780 });
  await expect(phone.getByTestId('phone-notes-tab')).toHaveText('Notes');
  await type(desk, 'I climb the wall.');
  await desk.getByTestId('new-roll-open').click();
  // A fresh quick draft is not waiting on anyone; once it is rolled, the writer owes the outcome.
  await expect(phone.getByTestId('phone-notes-tab')).toHaveText('Notes');
  const card = desk.getByTestId('card').first();
  await card.getByTestId('want').fill('Climb'); await card.getByTestId('want').blur();
  await card.getByTestId('risk').fill('Fall'); await card.getByTestId('risk').blur();
  await card.getByTestId('danger-kind').selectOption('other');
  await card.getByTestId('difficulty').selectOption('Ordinary');
  await card.getByTestId('danger').selectOption('Real');
  await expect(card.getByTestId('odds')).toBeVisible();
  await card.getByTestId('roll').click();
  await expect(phone.getByTestId('phone-notes-tab')).toHaveText('Notes •');

  // An info card on the phone is a fixed bottom sheet.
  await phone.getByRole('button', { name: /^Story/ }).click();
  await phone.getByTestId('author-tag').first().click();
  await phone.getByRole('button', { name: /^Notes/ }).click();
  await expect(phone.getByTestId('infocard')).toBeVisible();
  const box = (await phone.getByTestId('infocard').boundingBox())!;
  expect(await phone.getByTestId('infocard').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  expect(box.y + box.height).toBeGreaterThan(780 - 4); // sits on the bottom edge
});

test('membership, not the token, decides the role', async () => {
  const t = await createTable(['ilse']);
  // Ilse's real token is a player's. Asking for the GM's invite list is refused, whatever the client claims.
  expect((await api('ilse', 'GET', `/api/campaigns/${t}/invites`)).status).toBe(403);
  expect((await api('gm1', 'GET', `/api/campaigns/${t}/invites`)).status).toBe(200);
  expect((await api('rook', 'GET', `/api/campaigns/${t}/members`)).status).toBe(403);
});
