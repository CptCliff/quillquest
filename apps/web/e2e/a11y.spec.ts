import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, createTable, join } from './helpers';

/** Every automated WCAG 2 A/AA rule axe knows, on the page as it is now. A failure lists each violation with its target and why. */
async function audit(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('nextjs-portal').analyze();
  const lines = r.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join('\n   ')}`);
  expect(lines, `${where}\n${lines.join('\n')}`).toEqual([]);
}

test('the dashboard and the table have no accessibility violations, in light and dark', async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await createTable(['ilse', 'sella']);
  const gm = await join(browser, t, 'gm1');
  const ilse = await join(browser, t, 'ilse');
  await join(browser, t, 'sella');
  await ilse.locator('.story-pane .story p').first().click();
  await ilse.keyboard.type('I climb the wall and the captain watches.');
  await ilse.getByTestId('new-roll-open').click();
  await expect(ilse.getByTestId('card')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await ilse.emulateMedia({ colorScheme: scheme });
    await audit(ilse, `the table (${scheme}, Ledger with a card)`);
    for (const panel of ['create', 'codex', 'roster']) { await ilse.getByTestId(`tab-${panel}`).click(); await audit(ilse, `the ${panel} panel (${scheme})`); }
    await ilse.getByTestId('tab-ledger').click();
  }
  await ilse.emulateMedia({ colorScheme: 'light' });
  await ilse.getByRole('button', { name: 'Layout' }).click();
  await audit(ilse, 'the open Layout menu');
  await ilse.keyboard.press('Escape');
  await ilse.getByRole('button', { name: /Move or hide Ledger/ }).click();
  await audit(ilse, 'the open group menu');
  await ilse.keyboard.press('Escape');
  for (const scheme of ['light', 'dark'] as const) {
    await gm.emulateMedia({ colorScheme: scheme });
    await gm.getByTestId('tab-director').click();
    await audit(gm, `the Director (${scheme})`);
  }
  await ilse.goto('/?as=ilse');
  await expect(ilse.getByTestId('dashboard')).toBeVisible();
  await audit(ilse, 'the dashboard');
});

test('a battle card, the creation forms and the draft page pass the audit; so does a phone screen', async ({ browser }) => {
  test.setTimeout(120_000);
  const t = await createTable(['ilse', 'mira']);
  const made = await api('gm1', 'POST', `/api/campaigns/${t}/battles`, { goal: 'Hold the bridge', battleDanger: 'The bridge falls', difficulty: 'Hard', dangerRank: 'Serious', leadCharacterId: 'ilse-pc' });
  const id = made.json.battle.id as string;
  const mira = await join(browser, t, 'mira');
  await mira.getByTestId('tab-ledger').click();
  await expect(mira.locator(`[data-battle="${id}"]`)).toBeVisible();
  await audit(mira, 'a battle card');
  await mira.getByTestId('tab-create').click();
  await audit(mira, 'the creation panel');
  const draft = await browser.newContext();
  const dp = await draft.newPage();
  await dp.goto(`/draft/${t}?as=mira`);
  await expect(dp.getByTestId('draft-workspace')).toHaveAttribute('data-status', 'connected');
  await audit(dp, 'the draft page');
  const phone = await join(browser, t, 'mira', { width: 390, height: 780 });
  await audit(phone, 'the phone: Story');
  await phone.getByTestId('phone-notes-tab').click();
  await audit(phone, 'the phone: Notes');
});
