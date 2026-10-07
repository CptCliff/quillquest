import { expect, test } from '@playwright/test';
import { createTable, join } from './helpers';

test('the glossary lists the words, filters, closes with Escape, and tapping a word explains it in place; rolls stay closed until play begins', async ({ browser }) => {
  const t = await createTable(['mira']);
  const mira = await join(browser, t, 'mira');

  // Session zero: the Ledger says why a roll card cannot be opened yet.
  await mira.getByTestId('tab-ledger').click();
  await expect(mira.getByTestId('new-roll-open')).toBeDisabled();
  await expect(mira.getByTestId('new-roll-hint')).toContainText('Rolls open when the GM begins play');

  // A word in the Creation tab explains itself in place.
  await mira.getByTestId('tab-create').click();
  await mira.getByTestId('term-thread').click();
  await expect(mira.getByTestId('term-def-thread')).toContainText('Unfinished business from your past');
  await mira.getByTestId('term-thread').click();
  await expect(mira.getByTestId('term-def-thread')).toHaveCount(0);

  // The dialog lists every word, filters, and Escape returns focus to the button.
  await mira.getByTestId('glossary-open').click();
  const dialog = mira.getByTestId('glossary');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('glossary-conviction')).toContainText('A token earned when acting on a Belief');
  await dialog.getByTestId('glossary-filter').fill('crossing');
  await expect(dialog.getByTestId('glossary-crossing')).toBeVisible();
  await expect(dialog.getByTestId('glossary-conviction')).toHaveCount(0);
  await mira.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(mira.getByTestId('glossary-open')).toBeFocused();
});
