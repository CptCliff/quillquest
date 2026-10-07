import { expect, test, type Page } from '@playwright/test';
import { createTable, join } from './helpers';

/** Queue the next dice for a campaign (dev route, mounted only when the sync server runs with QUILLQUEST_DEV_DICE=1). */
const queueDice = (campaign: string, values: number[]) =>
  fetch(`http://localhost:3100/api/dev/campaigns/${campaign}/dice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });

const paragraphs = (p: Page) => p.locator('.story p');
async function write(page: Page, text: string, first = false) {
  if (first) await paragraphs(page).first().click();
  else await page.getByTestId('new-post').click();
  await page.keyboard.type(text);
}
const card = (p: Page) => p.getByTestId('card').first();
const commit = async (field: ReturnType<Page['getByTestId']>, text: string) => { await field.fill(text); await field.blur(); };
/** Fill a quick card's ranks and wait until the server says it can be Set (the odds appear). */
async function fillQuick(page: Page, over: { difficulty?: string; danger?: string } = {}) {
  const c = card(page);
  await commit(c.getByTestId('want'), 'Climb the wall');
  await commit(c.getByTestId('risk'), 'I twist an ankle');
  await commit(c.getByTestId('danger-text'), 'I twist an ankle');
  await c.getByTestId('danger-kind').selectOption('wound');
  await c.getByTestId('difficulty').selectOption(over.difficulty ?? 'Demanding');
  await c.getByTestId('danger').selectOption(over.danger ?? 'Serious');
  await expect(c.getByTestId('odds')).toBeVisible();
}
const locked = (p: Page, n: number) => expect(paragraphs(p).nth(n)).toHaveClass(/is-locked/);

test('a quick roll runs end to end: roll, outcome prompt, hidden dice, reveal, write, lock', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');

  await write(ilse, 'I reach the wall and start to climb.', true);
  await expect(paragraphs(sella).first()).toContainText('I reach the wall');
  await ilse.getByTestId('new-roll-open').click();
  await expect(card(sella)).toBeVisible(); // the whole table sees the card
  await expect(card(ilse).getByTestId('card-speed')).toHaveText('Quick roll');
  await fillQuick(ilse);
  await expect(card(ilse).getByTestId('odds')).toContainText('Goal: Even'); // Capable vs Demanding

  await queueDice(t, [5, 3, 6]); // Skill d8 5 beats Difficulty d8 3; Danger d8 6 beats the 5: success with the cost
  await card(ilse).getByTestId('roll').click();
  await expect(card(ilse).getByTestId('outcome')).toHaveText('Success, with the cost');
  await expect(card(ilse).getByTestId('prompt-headline')).toHaveText('Success, with the cost. Write how you get it; then the cost lands: I twist an ankle.');
  await expect(card(sella).getByTestId('outcome')).toHaveText('Success, with the cost');

  // Dice stay hidden from everyone until someone taps Reveal.
  await expect(ilse.getByTestId('dice')).toHaveCount(0);
  await expect(sella.getByTestId('dice')).toHaveCount(0);
  expect(await sella.content()).not.toContain('d8: 5');
  await card(sella).getByTestId('reveal').click();
  await expect(card(ilse).getByTestId('dice')).toContainText('d8: 5');
  await expect(card(ilse).getByTestId('dice')).toContainText('Danger (Serious) d8: 6');

  // Write the outcome, name the wound, mark it written: the prose above locks and the card moves to Past rolls.
  await write(ilse, 'I haul myself over the top, but my ankle turns on the stone.');
  await card(ilse).getByTestId('wound-name').fill('Twisted ankle');
  await card(ilse).getByTestId('wound-level').selectOption('Hurt');
  await card(ilse).getByTestId('written').click();
  await expect(ilse.getByTestId('past-roll')).toHaveCount(1);
  await locked(ilse, 0);
  await locked(sella, 1);

  // Locked prose refuses edits, with a reason; a new post after it is fine.
  await paragraphs(ilse).first().click();
  await ilse.keyboard.press('End');
  await ilse.keyboard.type(' Tampered.');
  await expect(ilse.getByTestId('notice')).toContainText('locked');
  await write(sella, 'Sella catches Ilse as she drops.');
  await expect(paragraphs(ilse)).toHaveCount(3);

  // The wound is on the sheet, and everyone can see it.
  await sella.getByTestId('tab-roster').click();
  await expect(sella.locator('[data-character="ilse-pc"] [data-testid="wounds"]')).toContainText('Twisted ankle (Hurt)');
});

test('a big roll: a Belief on the line, the GM sets it, a failed goal is pushed, and a Burden is named', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const ilse = await join(browser, t, 'ilse');
  const gm = await join(browser, t, 'gm1');
  await write(ilse, 'Ilse slips toward the duke\'s door, torn between the oath and the letters.', true);
  await expect(paragraphs(gm).first()).toContainText('torn between');

  await ilse.getByTestId('new-roll-skill').selectOption('Sneak');
  await ilse.getByTestId('new-roll-open').click();
  const c = card(ilse);
  await commit(c.getByTestId('want'), 'Reach the letters unseen');
  await commit(c.getByTestId('risk'), 'I doubt the oath');
  await c.getByTestId('on-the-line').selectOption({ label: 'Core: Oaths outlast the people who swear them' });
  await c.getByTestId('backing').selectOption({ label: 'Core: Oaths outlast the people who swear them' });
  await expect(c.getByTestId('card-speed')).toHaveText('Big roll');
  await expect(c.getByTestId('difficulty')).toBeDisabled(); // only the GM sets ranks on a big roll
  await expect(c.getByTestId('roll')).toHaveCount(0);

  // The GM sets it.
  const g = card(gm);
  await commit(g.getByTestId('danger-text'), 'I doubt the oath');
  await g.getByTestId('difficulty').selectOption('Hard');
  await g.getByTestId('danger').selectOption('Serious');
  await expect(g.getByTestId('odds')).toBeVisible();
  await g.getByTestId('set').click();
  await expect(card(ilse)).toHaveAttribute('data-status', 'set');
  await expect(card(ilse).getByTestId('odds')).toContainText('Goal:');

  // Expert Sneak d10 with Core backing d8 vs Hard d10 and a Serious d8 Danger. Dice: Skill, backing, Difficulty, Danger.
  await queueDice(t, [2, 1, 9, 1]); // fails the goal; the Danger is avoided
  await card(ilse).getByTestId('roll').click();
  await expect(card(ilse).getByTestId('outcome')).toHaveText('Failure, no cost');
  await expect(card(ilse).getByTestId('push-standard')).toBeVisible();

  // A standard push rechecks the avoided Danger one rank worse (Severe). Retry: Skill, backing, Difficulty, then the recheck.
  await queueDice(t, [9, 2, 1, 10]);
  await card(ilse).getByTestId('push-standard').click();
  await expect(card(ilse).getByTestId('outcome')).toHaveText('Success, with the cost');
  await expect(card(ilse).getByText('You pushed: the Danger was checked again at Severe.')).toBeVisible();
  await expect(card(ilse).getByTestId('push-standard')).toHaveCount(0); // once only

  // GM sees dice at once; Ilse does not.
  await expect(ilse.getByTestId('dice')).toHaveCount(0);
  await card(gm).getByTestId('gm-dice').click();
  await expect(card(gm).getByTestId('dice')).toContainText('Danger checked again (Severe)');

  // The Danger is a Burden: it must be named after the roll.
  await write(ilse, 'I reach the letters, and the oath no longer feels like mine.');
  await expect(card(ilse).getByTestId('burden-name')).toBeVisible();
  await card(ilse).getByTestId('burden-name').fill('Doubts the Oath');
  await card(ilse).getByTestId('written').click();
  await expect(ilse.getByTestId('past-roll')).toHaveCount(1);
  await ilse.getByTestId('tab-roster').click();
  await expect(ilse.getByTestId('burden')).toContainText('Doubts the Oath');

  // Laying it down leaves a Trait and earns Conviction.
  await ilse.getByLabel('Text').fill('Keeps the Oath She Chose');
  await ilse.getByTestId('lay-down').click();
  await expect(ilse.getByTestId('burden')).toHaveCount(0);
  await expect(ilse.locator('[data-character="ilse-pc"] [data-testid="conviction"]')).toHaveAttribute('aria-label', '2 Conviction');
});

test('conceding ends the card, and the defeat is written and locked', async ({ browser }) => {
  const t = await createTable(['ilse']);
  const ilse = await join(browser, t, 'ilse');
  await write(ilse, 'I stare up at the wall.', true);
  await ilse.getByTestId('new-roll-open').click();
  await fillQuick(ilse, { difficulty: 'Extraordinary', danger: 'Severe' });
  await card(ilse).getByTestId('concede-kind').selectOption('escape');
  await card(ilse).getByTestId('concede').click();
  await expect(card(ilse).getByTestId('conceded')).toContainText('Conceded: escape');
  await write(ilse, 'I back away from the wall and slip into the crowd.');
  await card(ilse).getByTestId('written').click();
  await expect(ilse.getByTestId('past-roll')).toContainText('Conceded: escape');
  await locked(ilse, 1);
});

test('the GM can retcon a quick roll until a later post builds on it', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  const gm = await join(browser, t, 'gm1');
  await write(ilse, 'I climb the wall.', true);
  await ilse.getByTestId('new-roll-open').click();
  await fillQuick(ilse);
  await queueDice(t, [8, 1, 1]); // a clean success with Flourish and room to spare
  await card(ilse).getByTestId('roll').click();
  await expect(card(ilse).getByTestId('outcome')).toHaveText('Clean success');
  await expect(card(ilse).locator('.prompt')).toContainText('Flourish');
  await expect(card(ilse).locator('.prompt')).toContainText('What do you do with the room?');
  await card(ilse).getByTestId('written').click(); // her only paragraph is the outcome
  await locked(sella, 0);

  // Retcon: the card reopens as a draft, the prose unlocks.
  await gm.getByTestId('past-roll').locator('summary').click();
  await gm.getByTestId('retcon').click();
  await expect(card(ilse)).toHaveAttribute('data-status', 'draft');
  await expect(paragraphs(sella).first()).not.toHaveClass(/is-locked/);

  // The GM raises the Difficulty; the writer rolls again and writes it up again.
  await card(gm).getByTestId('difficulty').selectOption('Hard');
  await expect(card(ilse).getByTestId('odds')).toBeVisible();
  await queueDice(t, [2, 6, 1]);
  await card(ilse).getByTestId('roll').click();
  await expect(card(ilse).getByTestId('outcome')).toHaveText('Failure, no cost');
  await card(ilse).getByTestId('concede').click(); // concede instead of pushing
  await card(ilse).getByTestId('written').click();
  await locked(gm, 0);

  // Once Sella posts after it, the outcome can no longer be retconned.
  await write(sella, 'Sella follows her up.');
  await expect(paragraphs(gm)).toHaveCount(2);
  await gm.getByTestId('past-roll').locator('summary').click();
  await gm.getByTestId('retcon').click();
  await expect(gm.getByTestId('notice')).toContainText('builds on this outcome');
  await locked(ilse, 0);
});
