import { expect, test, type Page } from '@playwright/test';
import { api, createTable, join } from './helpers';

const WEB = 'http://localhost:3100';
const queueDice = (campaign: string, values: number[]) =>
  fetch(`${WEB}/api/dev/campaigns/${campaign}/dice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
const dev = (path: string, body?: unknown) => fetch(`${WEB}/api/dev/mail${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
const ledger = async (p: Page) => { await p.getByTestId('tab-ledger').click(); };
const battle = (p: Page) => p.getByTestId('battle').first();

test('a four-player battle: declare, set, roll, a push with a withdrawal, beats, and one stitched post in each writer\'s ink', async ({ browser }) => {
  test.setTimeout(180_000);
  const t = await createTable(['ilse', 'sella', 'rook', 'mira']);
  const gm = await join(browser, t, 'gm1');
  const ilse = await join(browser, t, 'ilse');
  const sella = await join(browser, t, 'sella');
  const rook = await join(browser, t, 'rook');
  const mira = await join(browser, t, 'mira');

  // The GM opens the battle from the Director tab: the goal, the battle's Danger, the opposition's Difficulty, and who leads.
  await gm.getByTestId('tab-director').click();
  await gm.getByTestId('battle-open-goal').fill('Take the barricade');
  await gm.getByTestId('battle-open-battleDanger').fill('I am cut down at the gap');
  await gm.getByTestId('battle-open-difficulty').selectOption('Hard');
  await gm.getByTestId('battle-open-dangerRank').selectOption('Severe');
  await gm.getByTestId('battle-open-leadCharacterId').selectOption({ label: 'Ilse' });
  await gm.getByTestId('battle-open-go').click();
  for (const p of [gm, ilse, sella, rook, mira]) await ledger(p);
  await expect(battle(sella)).toBeVisible();
  const id = (await battle(sella).getAttribute('data-battle'))!;
  const b = (p: Page) => p.locator(`[data-battle="${id}"]`);

  // The lead fills the main card; each other player declares a contribution with their own Danger. The card shows who is still declaring.
  for (const n of ['Sella', 'Rook', 'Mira']) await expect(b(sella).getByTestId('battle-waiting')).toContainText(n);
  await ilse.getByTestId(`battle-${id}-lead-want`).fill('Break the line');
  await ilse.getByTestId(`battle-${id}-lead-risk`).fill('I fall at the gap');
  await ilse.getByTestId(`battle-${id}-lead-skillName`).selectOption('Climb');
  await ilse.getByTestId(`battle-${id}-lead-go`).click();
  const declare = async (p: Page, line: string, type: string, danger: string, text: string, target?: string) => {
    await p.getByTestId(`battle-${id}-declare-line`).fill(line);
    await p.getByTestId(`battle-${id}-declare-type`).selectOption(type);
    if (target) await p.getByTestId(`battle-${id}-declare-target`).selectOption({ label: target });
    await p.getByTestId(`battle-${id}-declare-dangerRank`).selectOption(danger);
    await p.getByTestId(`battle-${id}-declare-dangerText`).fill(text);
    await p.getByTestId(`battle-${id}-declare-go`).click();
  };
  await declare(sella, 'Sella opens the flank', 'open', 'Serious', 'Wounded by return fire');
  await declare(mira, 'Mira charges the gap', 'press', 'Serious', 'Cut in the melee');
  await expect(b(gm).getByTestId('battle-waiting')).toContainText('Rook');
  await expect(b(gm).getByTestId('battle-set')).toHaveCount(0); // not until everyone has declared
  await declare(rook, 'Rook fires the wagon', 'cover', 'Real', 'The fire spreads', 'Ilse');
  await expect(b(gm).getByTestId('battle-contribution')).toHaveCount(3);

  // The GM Sets everything at once: the odds appear in words for the battle and for each Danger. Then Roll.
  await b(gm).getByTestId('battle-set').click();
  await expect(b(sella).getByTestId('battle-odds')).toContainText('Dangers: Ilse');
  await queueDice(t, [1, 8, 1, 1, 1, 1]);
  await b(gm).getByTestId('battle-roll').click();
  await expect(b(ilse).getByTestId('battle-result')).toContainText('The battle is lost');

  // The lead pushes. Each contributor can withdraw or stay; Sella withdraws, the others stay, and the push resolves.
  await b(ilse).getByTestId('battle-push-standard').click();
  await expect(b(sella).getByTestId('battle-push-window')).toBeVisible();
  await queueDice(t, [8, 1, 1, 1, 1]);
  await b(sella).getByTestId('battle-withdraw').click();
  await b(mira).getByTestId('battle-stay').click();
  await b(rook).getByTestId('battle-stay').click();
  await expect(b(ilse).getByTestId('battle-result')).toContainText('The battle is won');
  await expect(b(ilse).locator('[data-character="sella-pc"]')).toContainText('withdrew');

  // Beats: each writes one to three sentences in their own card.
  const beat = async (p: Page, text: string) => { await p.getByTestId(`battle-${id}-beat-text`).fill(text); await p.getByTestId(`battle-${id}-beat-go`).click(); };
  await beat(ilse, 'Ilse breaks the line. The barricade falls.');
  await beat(sella, 'Sella\'s archers pin the flank.');
  await beat(mira, 'Mira charges the gap.');
  await beat(rook, 'Rook fires the wagon; smoke fills the street.');
  await expect(b(gm).getByTestId('battle-beats')).toContainText('4 of 4');

  // The GM stitches one post: each beat is a paragraph in its writer's ink, and the prose above is locked.
  await b(gm).getByTestId('battle-stitch').click();
  await expect(b(sella).getByTestId('battle-post')).toContainText('Ilse breaks the line');
  const story = sella.locator('.story-pane .story p');
  await expect(story).toHaveCount(4);
  await expect(story.nth(0)).toContainText('Ilse breaks the line');
  const texts = await story.evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/^.*?locked/, '')));
  for (const s of ['Sella\'s archers pin the flank', 'Mira charges the gap', 'Rook fires the wagon']) expect(texts.join('|')).toContain(s); // the lead is first, then the contributions
  const inks = await story.evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--ink').trim() || getComputedStyle(e).borderLeftColor));
  expect(new Set(inks).size).toBe(4); // four writers, four colors
  await expect(story.first()).toHaveClass(/is-locked/);
});

test('an offline player gets one batched email whose link lands on the right card', async ({ browser }) => {
  const t = await createTable(['ilse', 'mira']);
  const made = await api('gm1', 'POST', `/api/campaigns/${t}/battles`, { goal: 'Hold the bridge', battleDanger: 'The bridge falls', difficulty: 'Hard', dangerRank: 'Serious', leadCharacterId: 'ilse-pc' });
  expect(made.status).toBe(200);
  const id = made.json.battle.id as string;
  await dev('/tick', {});
  expect((await dev('')).sent.filter((m: { text: string }) => m.text.includes(t))).toEqual([]); // two minutes have not passed
  await dev('/advance', { ms: 2 * 60_000 });
  await dev('/tick', {});
  const mails = (await dev('')).sent.filter((m: { text: string }) => m.text.includes(t)) as { to: string; subject: string; text: string }[];
  const miraMail = mails.filter((m) => m.to === 'mira@dev.test');
  expect(miraMail).toHaveLength(1);
  expect(miraMail[0]!.subject).toContain('Declare your contribution');
  const url = /(http:\/\/localhost:3100\/story\/[^\s]+)/.exec(miraMail[0]!.text)![1]!;
  expect(url).toContain(`battle=${id}`);

  // The link lands her on the battle card, in the Ledger, highlighted.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${url}&as=mira`);
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  await expect(page.locator(`[data-battle="${id}"]`)).toHaveAttribute('data-focus', 'true');
  await expect(page.locator(`[data-battle="${id}"]`).getByTestId(`battle-${id}-declare-go`)).toBeVisible();
  // Once she has the campaign open, nothing more is emailed to her.
  await api('gm1', 'POST', `/api/campaigns/${t}/spotlight/take`);
  await dev('/advance', { ms: 2 * 60_000 });
  await dev('/tick', {});
  expect(((await dev('')).sent as { to: string; text: string }[]).filter((m) => m.to === 'mira@dev.test' && m.text.includes(t))).toHaveLength(1);
});

test('on a phone: the spotlight bar, a battle card from a link, and nothing spills sideways', async ({ browser }) => {
  const t = await createTable(['ilse', 'sella']);
  const phone = { width: 375, height: 667 };
  const ilse = await join(browser, t, 'ilse', phone);
  const sella = await join(browser, t, 'sella');
  const noSideways = async (p: Page, where: string) => expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${where} fits the screen`).toBe(true);

  // Write a post and see whose turn it is.
  await ilse.locator('.story-pane .story p').first().click();
  await ilse.keyboard.type('I reach the barricade and wait for the signal.');
  await noSideways(ilse, 'the story');
  await expect(ilse.getByTestId('spotlight')).toBeVisible();
  const holder = await ilse.getByTestId('spotlight-holder').innerText();
  const mine = holder === 'You';
  const passer = mine ? ilse : sella;
  await passer.getByTestId('spotlight-pass').click();
  await expect(ilse.getByTestId('spotlight-holder')).toHaveText(mine ? 'Sella' : 'You');
  await noSideways(ilse, 'the spotlight bar');

  // A battle opens; the link goes straight to it on a phone, in the Notes tab.
  const made = await api('gm1', 'POST', `/api/campaigns/${t}/battles`, { goal: 'Hold the bridge', battleDanger: 'The bridge falls', difficulty: 'Hard', dangerRank: 'Serious', leadCharacterId: 'sella-pc' });
  const id = made.json.battle.id as string;
  await ilse.goto(`/story/${t}?battle=${id}&as=ilse`);
  await expect(ilse.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  const card = ilse.locator(`[data-battle="${id}"]`);
  await expect(card).toHaveAttribute('data-focus', 'true');
  await noSideways(ilse, 'the battle card');
  await card.getByTestId(`battle-${id}-declare-line`).fill('Ilse holds the near end');
  await card.getByTestId(`battle-${id}-declare-type`).selectOption('press');
  await card.getByTestId(`battle-${id}-declare-dangerText`).fill('Cut down by the charge');
  // Every tap target is thumb-sized, and the card stays within the screen.
  for (const el of await card.locator('button').all()) {
    const box = await el.boundingBox();
    if (!box) continue;
    expect(box.height, await el.innerText()).toBeGreaterThanOrEqual(43);
    expect(box.x + box.width).toBeLessThanOrEqual(phone.width + 1);
  }
  await card.getByTestId(`battle-${id}-declare-go`).click();
  await expect(card.getByTestId('battle-contribution').first()).toContainText('press');
  await noSideways(ilse, 'the notes after declaring');
});
