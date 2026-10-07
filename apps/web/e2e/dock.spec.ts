import { expect, test, type Page } from '@playwright/test';
import { createTable, join } from './helpers';

const group = (p: Page, panel: string) => p.locator('.dock-group', { has: p.locator(`[data-testid="tab-${panel}"]`) });
const box = async (p: Page, panel: string) => (await group(p, panel).boundingBox())!;
const saved = (p: Page) => p.waitForTimeout(900); // layouts are saved half a second after the last change

/** Drag a tab with real mouse moves onto a point of a group (fractions of its box). */
async function dragTab(p: Page, panel: string, onPanel: string, fx: number, fy: number) {
  const from = (await p.getByTestId(`tab-${panel}`).boundingBox())!;
  const to = await box(p, onPanel);
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p.mouse.down();
  await p.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 });
  await p.mouse.move(to.x + to.width * fx, to.y + to.height * fy, { steps: 8 });
  await p.mouse.up();
}

test('dragging a divider resizes the panes, and the width is remembered on the server across a reload', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  const splitter = page.getByTestId('splitter').first();
  const before = (await page.locator('.story-pane').boundingBox())!.width;
  const b = (await splitter.boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x - 250, b.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = (await page.locator('.story-pane').boundingBox())!.width;
  expect(after).toBeLessThan(before - 150);
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('story')).toBeVisible();
  expect(Math.abs((await page.locator('.story-pane').boundingBox())!.width - after)).toBeLessThan(6);
  // A different browser for the same person gets the same layout (it lives on the server, not in the browser).
  const other = await join(browser, t, 'ilse');
  expect(Math.abs((await other.locator('.story-pane').boundingBox())!.width - after)).toBeLessThan(6);
});

test('a divider works from the keyboard: arrows, Shift for bigger steps, Home and End', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  const s = page.getByTestId('splitter').first();
  await s.focus();
  const start = Number(await s.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  expect(Number(await s.getAttribute('aria-valuenow'))).toBe(start + 2);
  await page.keyboard.press('Shift+ArrowLeft');
  expect(Number(await s.getAttribute('aria-valuenow'))).toBe(start - 8);
  await page.keyboard.press('Home');
  expect(Number(await s.getAttribute('aria-valuenow'))).toBe(Number(await s.getAttribute('aria-valuemin')));
  await page.keyboard.press('End');
  expect(Number(await s.getAttribute('aria-valuenow'))).toBe(Number(await s.getAttribute('aria-valuemax')));
  await expect(s).toHaveAttribute('role', 'separator');
  await expect(s).toHaveAttribute('aria-label', /Resize Story and Ledger/);
});

test('dragging a tab to the bottom or left of a pane moves the panel there, and the arrangement is kept', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  // The Roster tab onto the bottom edge of the Story pane.
  await dragTab(page, 'roster', 'story', 0.5, 0.92);
  const story = await box(page, 'story');
  const roster = await box(page, 'roster');
  expect(roster.y).toBeGreaterThanOrEqual(story.y + story.height - 3);
  await expect(page.getByTestId('tab-roster')).toBeVisible();
  // The Codex tab onto the left edge of the Story pane.
  await dragTab(page, 'codex', 'story', 0.05, 0.4);
  expect((await box(page, 'codex')).x).toBeLessThan((await box(page, 'story')).x);
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('story')).toBeVisible();
  expect((await box(page, 'codex')).x).toBeLessThan((await box(page, 'story')).x);
  expect((await box(page, 'roster')).y).toBeGreaterThanOrEqual((await box(page, 'story')).y + (await box(page, 'story')).height - 3);
  // Dropping on the centre of another pane stacks the tabs.
  await dragTab(page, 'codex', 'ledger', 0.5, 0.5);
  expect((await box(page, 'codex')).x).toBeCloseTo((await box(page, 'ledger')).x, 0);
  await expect(group(page, 'ledger').locator('[role="tab"]')).toContainText(['Ledger', 'Creation', 'Codex']);
});

test('the story editor keeps its text and keeps working while panels, or the Story itself, are moved', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  await page.locator('.story-pane .story p').first().click();
  await page.keyboard.type('Before the move. ');
  await dragTab(page, 'roster', 'story', 0.5, 0.92);
  await page.locator('.story-pane .story p').first().click();
  await page.keyboard.type('After a panel moved. ');
  // Move the Story panel itself, with the keyboard-friendly menu.
  await page.getByRole('button', { name: /Move or hide Story/ }).click();
  await page.getByTestId(/group-menu-g\d+-bottom/).click();
  await expect(page.getByTestId('announcer')).toContainText('Story moved to the bottom');
  await expect(page.locator('.story-pane .story')).toContainText('Before the move. After a panel moved.');
  await page.locator('.story-pane .story p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('And after the Story itself moved.');
  await expect(page.locator('.story-pane .story')).toContainText('And after the Story itself moved.');
  expect((await box(page, 'story')).y).toBeGreaterThan((await box(page, 'ledger')).y); // Story is now below the notes
});

test('moving a panel without a mouse: the group menu, announced, and the Layout menu with presets, hide and show, and reset', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  await page.getByRole('button', { name: /Move or hide Ledger/ }).click();
  await expect(page.getByRole('menu', { name: /Move or hide Ledger/ })).toBeVisible();
  await page.keyboard.press('ArrowDown'); // down to the second item
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Move or hide Ledger/ })).toBeFocused(); // focus comes back
  await page.getByRole('button', { name: /Move or hide Ledger/ }).click();
  await page.getByRole('menuitem', { name: 'Dock to the bottom' }).click();
  await expect(page.getByTestId('announcer')).toContainText('Ledger moved to the bottom');
  expect((await box(page, 'ledger')).y).toBeGreaterThan((await box(page, 'story')).y);

  // Hide a panel from its menu, bring it back from the Layout menu.
  await page.getByTestId('tab-codex').click();
  await page.getByRole('button', { name: /Move or hide Codex/ }).click();
  await page.getByRole('menuitem', { name: 'Hide Codex' }).click();
  await expect(page.getByTestId('tab-codex')).toHaveCount(0);
  await page.getByRole('button', { name: 'Layout' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Codex' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('menuitemcheckbox', { name: 'Codex' }).click();
  await expect(page.getByTestId('tab-codex')).toBeVisible();

  // Presets.
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: /Writer's focus/ }).click();
  await expect(page.getByTestId('tab-ledger')).toHaveCount(0);
  await expect(page.getByTestId('splitter')).toHaveCount(0);
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: /Swap sides/ }).click();
  expect((await box(page, 'ledger')).x).toBeLessThan((await box(page, 'story')).x);
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('story')).toBeVisible();
  expect((await box(page, 'ledger')).x).toBeLessThan((await box(page, 'story')).x); // kept
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: 'Reset to the default layout' }).click();
  await expect(page.getByTestId('announcer')).toContainText('reset');
  await expect.poll(async () => (await box(page, 'ledger')).x > (await box(page, 'story')).x).toBe(true);
  await page.reload();
  await expect(page.getByTestId('story')).toBeVisible();
  expect((await box(page, 'ledger')).x).toBeGreaterThan((await box(page, 'story')).x);
});

test('the info card is a panel that appears beside the Ledger and goes when closed; the GM\'s Director is only in the GM\'s workspace', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  await expect(page.getByTestId('tab-info')).toHaveCount(0);
  await page.locator('.story-pane .story p').first().click();
  await page.keyboard.type('I climb the wall.');
  await page.getByTestId('chip-info').click();
  await expect(page.getByTestId('tab-info')).toBeVisible();
  await expect(page.getByTestId('infocard')).toBeVisible();
  await page.getByTestId('infocard-close').click();
  await expect(page.getByTestId('tab-info')).toHaveCount(0);
  const gm = await join(browser, t, 'gm1');
  await expect(gm.getByTestId('tab-director')).toBeVisible();
  await expect(page.getByTestId('tab-director')).toHaveCount(0);
  await gm.getByRole('button', { name: 'Layout' }).click();
  await expect(gm.getByRole('menuitemcheckbox', { name: 'Director' })).toBeVisible();
  await expect(gm.getByRole('menuitemcheckbox', { name: 'Creation' })).toHaveCount(0); // the GM writes no character
});

test('the theme can be light, dark, or follow the device, is remembered, and the dock still works in each', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const html = page.locator('html');
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await bg();
  await page.getByTestId('theme-toggle').click(); // follow device -> light
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click(); // -> dark
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark'); // remembered, and applied before paint
  await expect(page.getByTestId('story')).toBeVisible();
  await page.getByTestId('theme-toggle').click(); // -> follow device
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});

test('on a phone the two-tab layout is unchanged, and a wide-screen arrangement does not leak onto it', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const wide = await join(browser, t, 'ilse');
  await wide.getByRole('button', { name: 'Layout' }).click();
  await wide.getByRole('menuitem', { name: /Writer's focus/ }).click();
  await saved(wide);
  const phone = await join(browser, t, 'ilse', { width: 390, height: 780 });
  await expect(phone.getByRole('navigation', { name: 'Panes' })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Layout' })).toHaveCount(0);
  await phone.getByTestId('phone-notes-tab').click();
  await expect(phone.getByTestId('tab-ledger')).toBeVisible(); // the phone keeps its own, default, notes tabs
});

test('tabs move with the arrow keys, focus follows a panel that is moved, and Escape cancels a drag', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const page = await join(browser, t, 'ilse');
  await page.getByTestId('tab-ledger').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-create')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-create')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByTestId('tab-roster')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Move or hide Roster/ }).click();
  await page.getByRole('menuitem', { name: 'Dock to the bottom' }).click();
  await expect(page.getByTestId('tab-roster')).toBeFocused(); // focus follows the panel to its new home
  // Pressing Escape part-way through a drag puts everything back.
  const from = (await page.getByTestId('tab-codex').boundingBox())!;
  const story = await box(page, 'story');
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(story.x + 40, story.y + story.height / 2, { steps: 6 });
  await expect(page.locator('.dock-drop')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.dock-drop')).toHaveCount(0);
  expect((await box(page, 'codex')).x).toBeGreaterThan((await box(page, 'story')).x);
});
