import { expect, test, type Browser, type Page } from '@playwright/test';

let table = 0;
const newTable = () => `e2e-${Date.now()}-${++table}`;

async function join(browser: Browser, campaign: string, user: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`/story/${campaign}?as=${user}`);
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('story')).toBeVisible();
  return page;
}
const paragraphs = (p: Page) => p.locator('.story p');
/** A paragraph's text without remote carets, whose name labels are rendered inside the text. */
const textOf = (p: Page, i: number) =>
  paragraphs(p).nth(i).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.collaboration-carets__caret').forEach((n) => n.remove());
    return copy.textContent ?? '';
  });
const ink = (p: Page, i: number) => paragraphs(p).nth(i).evaluate((el) => getComputedStyle(el).getPropertyValue('--ink').trim());

async function typeIn(page: Page, paragraph: number, text: string) {
  const p = paragraphs(page).nth(paragraph);
  await p.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test('two writers co-write with distinct colors and live cursors', async ({ browser }) => {
  const t = newTable();
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');

  await paragraphs(ilse).first().click();
  await ilse.keyboard.type('I climb the wall.');
  await expect(paragraphs(sella).first()).toContainText('I climb the wall.');

  await sella.getByTestId('new-post').click();
  await sella.keyboard.type('Sella watches the road.');
  await expect(paragraphs(ilse)).toHaveCount(2);
  await expect(paragraphs(ilse).nth(1)).toContainText('Sella watches the road.');

  // Each paragraph carries its author's ink, and the two inks differ.
  const [a, b] = [await ink(ilse, 0), await ink(ilse, 1)];
  expect(a).toBe('#c2410c');
  expect(b).toBe('#1d4ed8');
  await expect(paragraphs(ilse).first()).toHaveAttribute('data-author-name', 'Ilse');
  await expect(paragraphs(ilse).nth(1)).toHaveAttribute('data-author-name', 'Sella');

  // Live cursor: Sella is typing, so Ilse sees Sella's labelled caret.
  await expect(ilse.locator('.collaboration-carets__label', { hasText: 'Sella' })).toBeVisible();
  await expect(sella.locator('.collaboration-carets__label', { hasText: 'Ilse' })).toBeVisible();
  await expect(ilse.getByTestId('peers').locator('.dot')).toHaveCount(2);
});

test('another writer\'s edit becomes a suggestion that the author can accept or reject', async ({ browser }) => {
  const t = newTable();
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  await paragraphs(ilse).first().click();
  await ilse.keyboard.type('I climb the wall.');
  await expect(paragraphs(sella).first()).toContainText('I climb the wall.');

  // Sella types in Ilse's paragraph: it is a suggestion, not an edit.
  await typeIn(sella, 0, ' Quietly.');
  await expect(sella.locator('.story ins')).toContainText(' Quietly.');
  await expect(ilse.locator('.story ins')).toContainText(' Quietly.');
  await expect(ilse.getByTestId('suggestion')).toHaveCount(1);
  await expect(sella.getByTestId('suggestion-accept')).toHaveCount(0); // only the author accepts
  await expect(sella.getByTestId('suggestion-reject')).toHaveText('Withdraw');

  // Accept: the text becomes Ilse's own, in both windows.
  await ilse.getByTestId('suggestion-accept').click();
  await expect(ilse.locator('.story ins')).toHaveCount(0);
  await expect(paragraphs(sella).first()).toContainText('I climb the wall. Quietly.');
  await expect(sella.locator('.story ins')).toHaveCount(0);

  // Reject: a second suggestion disappears and leaves the text as it was.
  await typeIn(sella, 0, ' Loudly.');
  await expect(ilse.locator('.story ins')).toContainText(' Loudly.');
  await ilse.getByTestId('suggestion-reject').click();
  await expect(ilse.locator('.story ins')).toHaveCount(0);
  await expect(paragraphs(sella).first()).not.toContainText('Loudly');
  await expect(paragraphs(ilse).first()).toHaveText(/I climb the wall\. Quietly\./);
});

test('suggesting a deletion marks the text without removing it', async ({ browser }) => {
  const t = newTable();
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  await paragraphs(ilse).first().click();
  await ilse.keyboard.type('I climb slowly.');
  await expect(paragraphs(sella).first()).toContainText('I climb slowly.');
  await typeIn(sella, 0, '');
  await sella.keyboard.press('Backspace');
  await expect(sella.locator('.story del')).toContainText('.');
  await expect(ilse.locator('.story del')).toContainText('.');
  expect(await textOf(ilse, 0)).toBe('I climb slowly.');
});

test('locked prose refuses edits from everyone, and the GM can retcon it', async ({ browser }) => {
  const t = newTable();
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  const gm = await join(browser, t, 'gm1');
  await paragraphs(ilse).first().click();
  await ilse.keyboard.type('The roll is written.');
  await expect(paragraphs(gm).first()).toContainText('The roll is written.');

  await paragraphs(gm).first().click();
  await gm.getByTestId('lock-through').click();
  for (const page of [ilse, sella, gm]) await expect(paragraphs(page).first()).toHaveClass(/is-locked/);

  // The author is refused, with a reason, and the text does not change.
  await typeIn(ilse, 0, ' Tampered.');
  await expect(ilse.getByTestId('notice')).toContainText('locked');
  expect(await textOf(ilse, 0)).toBe('The roll is written.');
  await expect(paragraphs(gm).first()).not.toContainText('Tampered');

  // Someone else cannot even suggest on it.
  await typeIn(sella, 0, ' Sneaky.');
  await expect(sella.getByTestId('notice')).toContainText('locked');
  await expect(sella.locator('.story ins')).toHaveCount(0);

  // A new paragraph after the locked run is fine.
  await sella.getByTestId('new-post').click();
  await sella.keyboard.type('The story goes on.');
  await expect(paragraphs(ilse)).toHaveCount(2);

  // Retcon: GM unlocks the last locked paragraph, then the author may edit again.
  await gm.getByTestId('unlock-last').click();
  await expect(paragraphs(ilse).first()).not.toHaveClass(/is-locked/);
  await typeIn(ilse, 0, ' Revised.');
  await expect(paragraphs(gm).first()).toContainText('Revised.');
});

test('a player cannot see GM tools, and cannot lock', async ({ browser }) => {
  const ilse = await join(browser, newTable(), 'ilse');
  await expect(ilse.getByTestId('gm-tools')).toHaveCount(0);
});

test('the panes resize, remember their width, and stack as tabs on a phone', async ({ browser }) => {
  const t = newTable();
  const page = await join(browser, t, 'ilse');
  const divider = page.getByTestId('divider');
  const box = (await divider.boundingBox())!;
  const before = (await page.locator('.story-pane').boundingBox())!.width;
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 250, box.y + 100, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator('.story-pane').boundingBox())!.width;
  expect(after).toBeLessThan(before - 150);
  await page.reload();
  await expect(page.getByTestId('story')).toBeVisible();
  expect(Math.abs((await page.locator('.story-pane').boundingBox())!.width - after)).toBeLessThan(5);

  const phone = await join(browser, t, 'sella', { width: 390, height: 780 });
  await expect(phone.getByRole('navigation', { name: 'Panes' })).toBeVisible();
  await expect(phone.locator('.notes-pane')).toBeHidden();
  await phone.getByRole('button', { name: 'Notes' }).click();
  await expect(phone.locator('.notes-pane')).toBeVisible();
  await expect(phone.locator('.story-pane')).toBeHidden();
});
