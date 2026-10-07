import { expect, test, type Page } from '@playwright/test';
import { createTable, join } from './helpers';

const paragraphs = (p: Page) => p.locator('.story p');
/** A paragraph's text without remote carets, whose name labels are rendered inside the text. */
const textOf = (p: Page, i: number) =>
  paragraphs(p).nth(i).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.collaboration-carets__caret, .author-tag, .skill-chip').forEach((n) => n.remove());
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
  const t = await createTable(['ilse', 'sella']);
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
  const t = await createTable(['ilse', 'sella']);
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
  expect(await textOf(ilse, 0)).toBe('I climb the wall. Quietly.');
});

test('suggesting a deletion marks the text without removing it', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
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

test('only the GM sees the Director tab, and the GM opens no cards', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const ilse = await join(browser, t, 'ilse');
  const gm = await join(browser, t, 'gm1');
  await expect(ilse.getByTestId('tab-director')).toHaveCount(0);
  await expect(gm.getByTestId('tab-director')).toBeVisible();
  await expect(ilse.getByTestId('new-roll')).toBeVisible();
  await expect(gm.getByTestId('new-roll')).toHaveCount(0);
});

test('on a phone the panes stack as two tabs', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const phone = await join(browser, t, 'sella', { width: 390, height: 780 });
  await expect(phone.getByRole('navigation', { name: 'Panes' })).toBeVisible();
  await expect(phone.locator('.notes-pane')).toBeHidden();
  await phone.getByRole('button', { name: 'Notes' }).click();
  await expect(phone.locator('.notes-pane')).toBeVisible();
  await expect(phone.locator('.story-pane')).toBeHidden();
});
