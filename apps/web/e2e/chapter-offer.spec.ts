import { expect, test, type Page } from '@playwright/test';
import { createTable, join } from './helpers';

const paragraphs = (p: Page) => p.locator('.story-pane .story p');
async function write(page: Page, text: string, first = false) {
  if (first) await paragraphs(page).first().click();
  else await page.getByTestId('new-post').click();
  await page.keyboard.type(text);
}
const creation = (p: Page) => p.getByTestId('creation');
const open = async (p: Page) => { await p.getByTestId('tab-create').click(); await expect(creation(p)).toBeVisible(); };

test('a player picks a Skill and a Trait from the chapter library; another player objects and the slot reopens', async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await createTable(['mira', 'tobin']);
  const mira = await join(browser, t, 'mira');
  const tobin = await join(browser, t, 'tobin');

  const prose = ['Born in a gatehouse.', 'I stood the north gate for six winters, checking carts and toll papers at the border.', 'Then the war came to the hills.', 'Then I walked home along the river.'];
  for (const [i, text] of prose.entries()) await write(mira, text, i === 0);
  await open(mira);
  await creation(mira).getByTestId('origin-post-paragraphId').selectOption({ index: 1 });
  await creation(mira).getByTestId('origin-post-go').click();
  await creation(mira).getByTestId('origin-picks-skill').fill('Sneak');
  await creation(mira).getByTestId('origin-picks-connection').fill('My family');
  await creation(mira).getByTestId('origin-picks-go').click();
  for (const [i, summary] of ['Gate guard at the border', 'The war', 'Home again'].entries()) {
    await expect(creation(mira).getByTestId('chapter-block')).toHaveCount(i);
    await creation(mira).getByTestId('chapter-paragraphId').selectOption({ index: 1 });
    await creation(mira).getByTestId('chapter-summary').fill(summary);
    if (i === 1) await creation(mira).getByTestId('chapter-endsBadly').check();
    await creation(mira).getByTestId('chapter-go').click();
  }

  // The library recognises the gate chapter and offers its lists.
  await creation(mira).getByTestId('offer-get-0').click();
  const offer = creation(mira).getByTestId('offer-0');
  await expect(offer).toContainText('Close to “The Gate Warden”');
  await offer.getByTestId('pick-0-skill').selectOption({ label: 'Gatekeeping (new, Trained)' });
  await offer.getByTestId('pick-0-trait').selectOption({ label: 'Watchful' });
  await offer.getByTestId('pick-0-go').click();
  await expect(mira.locator('[data-index="0"] [data-testid="chapter-skill"]')).toContainText('Gatekeeping (Trained) · picked by the writer');
  await expect(mira.locator('[data-index="0"] [data-testid="chapter-trait"]')).toContainText('Watchful');

  // Nothing to pick when a form is submitted empty: the reason is shown beside the button.
  await creation(mira).getByTestId('offer-get-1').click();
  await creation(mira).getByTestId('pick-1-go').click();
  await expect(creation(mira).getByTestId('pick-1-result')).toContainText('Choose a Skill or a Trait');

  // Tobin sees the pick and objects; the slot reopens for proposals.
  await open(tobin);
  const done = tobin.locator('[data-testid="grant-card"][data-character="mira-pc"][data-chapter="0"] [data-testid="grant-skill-done"]');
  await expect(done).toContainText('Gatekeeping');
  await done.getByTestId('object').click();
  await expect(mira.locator('[data-index="0"] [data-testid="chapter-skill"]')).toContainText('waiting');
});
