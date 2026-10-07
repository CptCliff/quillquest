import { expect, test, type Page } from '@playwright/test';
import { api, createTable, join } from './helpers';

const paragraphs = (p: Page) => p.locator('.story-pane .story p');
/** Add a paragraph of your own at the end of the story. */
async function write(page: Page, text: string, first = false) {
  if (first) await paragraphs(page).first().click();
  else await page.getByTestId('new-post').click();
  await page.keyboard.type(text);
}
const queueDice = (campaign: string, values: number[]) =>
  fetch(`http://localhost:3100/api/dev/campaigns/${campaign}/dice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });

const creation = (p: Page) => p.getByTestId('creation');
const open = async (p: Page) => { await p.getByTestId('tab-create').click(); await expect(creation(p)).toBeVisible(); };
/** Post the earliest paragraph of yours that is not used yet. */
const firstUnused = (p: Page, form: string, field = 'paragraphId') => creation(p).getByTestId(`${form}-${field}`).selectOption({ index: 1 });
const submit = (p: Page, form: string) => creation(p).getByTestId(`${form}-go`).click();

async function postOriginAndChapters(page: Page, skill: string, badTestsBelief: boolean) {
  await open(page);
  await firstUnused(page, 'origin-post');
  await submit(page, 'origin-post');
  await creation(page).getByTestId('origin-picks-skill').fill(skill);
  await creation(page).getByTestId('origin-picks-connection').fill('My family, still on the farm');
  await submit(page, 'origin-picks');
  for (const [i, bad] of [false, true, false].entries()) {
    await expect(creation(page).getByTestId('chapter-block')).toHaveCount(i);
    await firstUnused(page, 'chapter');
    await creation(page).getByTestId('chapter-summary').fill(`Chapter ${i + 1}`);
    if (bad) { await creation(page).getByTestId('chapter-endsBadly').check(); if (badTestsBelief) await creation(page).getByTestId('chapter-testedBelief').check(); }
    await submit(page, 'chapter');
  }
  await expect(creation(page).getByTestId('chapter-block')).toHaveCount(3);
}

async function finishSheet(page: Page, name: string, burden = false) {
  await open(page);
  await creation(page).getByTestId('capital-pn1').fill(`${name}'s knife`);
  await creation(page).getByTestId('capital-ps1').fill('Never out of reach.');
  await submit(page, 'capital');
  await creation(page).getByTestId('beliefs-objective').fill(`${name} wants the truth out`);
  await creation(page).getByTestId('beliefs-relationship').fill(`${name} stands by the others`);
  await creation(page).getByTestId('beliefs-worldview').fill(`${name} believes debts come due`);
  await submit(page, 'beliefs');
  for (const i of [0, 1, 2]) await creation(page).getByTestId(`instincts-i${i}`).fill(`Instinct ${i}`);
  await submit(page, 'instincts');
  await expect(creation(page).getByTestId('instincts-i0')).toHaveValue('Instinct 0'); // what was saved stays on screen
  if (burden) {
    await expect(creation(page).getByTestId('burden-beliefId')).toBeVisible();
    await creation(page).getByTestId('burden-name').fill('Doubts the oath');
    await submit(page, 'burden');
  }
  await submit(page, 'hook');
}

test('a GM and three players complete session zero, then play: grants, a swap, crossings, the end check, Begin play', async ({ browser }) => {
  test.setTimeout(240_000);
  const t = await createTable(['mira', 'tobin', 'wren']);
  const gm = await join(browser, t, 'gm1');
  const pages = { mira: await join(browser, t, 'mira'), tobin: await join(browser, t, 'tobin'), wren: await join(browser, t, 'wren') };
  const step = (user: string, name: string, body: Record<string, unknown>) => api(user, 'POST', `/api/campaigns/${t}/creation/${name}`, body);

  // Everyone starts blank and in creation.
  await pages.mira.getByTestId('tab-roster').click();
  await expect(pages.mira.getByTestId('creating-badge')).toHaveCount(3);
  await expect(pages.mira.locator('[data-character="mira-pc"] [data-testid="skills"]')).toContainText('none');

  // The GM writes the world fact; the Canon shows it to everyone.
  await gm.getByTestId('tab-director').click();
  await gm.getByTestId('world-fact-text').fill('The Border War ended in a treaty nobody trusts.');
  await gm.getByTestId('world-fact-go').click();
  await pages.tobin.getByTestId('tab-codex').click();
  await expect(pages.tobin.getByTestId('canon-entry')).toHaveText('The Border War ended in a treaty nobody trusts.');
  await expect(gm.getByTestId('begin-play')).toBeDisabled();

  // Each writer's prologue: an origin, three chapters, and two crossing scenes, all in their own ink.
  for (const [user, page] of Object.entries(pages)) {
    for (const [i, text] of ['Origin.', 'Chapter one.', 'Chapter two: it went wrong.', 'Chapter three.', 'A scene with a friend.', 'A scene with another.'].entries())
      await write(page, `${user}: ${text}`, user === 'mira' && i === 0);
  }
  await expect(paragraphs(gm)).toHaveCount(18);

  // Origins and chapters. Mira's bad chapter tested a Belief.
  await postOriginAndChapters(pages.mira, 'Persuade', true);
  await postOriginAndChapters(pages.tobin, 'Sneak', false);
  await postOriginAndChapters(pages.wren, 'Ride', false);

  // Grants. Most go in through the GM's own entry so the test is not three hundred clicks; the real agreement paths are Mira's.
  const bulk: [string, string][] = [['mira', 'tobin'], ['tobin', 'wren'], ['wren', 'mira']];
  for (const [owner] of bulk) {
    const skills = [owner === 'mira' ? null : { sneak: 'Sneak', ride: 'Ride' }[owner === 'tobin' ? 'sneak' : 'ride'], 'Lore', 'Streetwise'];
    for (const i of [0, 1, 2]) {
      if (!(owner === 'mira' && i === 0)) expect((await step('gm1', 'gm-resolve', { characterId: `${owner}-pc`, chapter: i, part: 'skill', value: skills[i] })).status).toBe(200);
      if (!(owner === 'mira' && i === 0)) expect((await step('gm1', 'gm-resolve', { characterId: `${owner}-pc`, chapter: i, part: 'trait', value: `${owner} trait ${i}` })).status).toBe(200);
    }
  }

  // Mira's first Skill: Tobin proposes a new Skill, Wren proposes raising Persuade: no majority, so it is tied and the GM breaks it.
  const grant = (p: Page, chapter: number, part: 'skill' | 'trait') => p.locator(`[data-testid="grant-card"][data-character="mira-pc"][data-chapter="${chapter}"] [data-testid="grant-${part}"]`);
  await open(pages.tobin); await open(pages.wren);
  await pages.tobin.getByTestId('propose-skill-mira-pc-0-skill').fill('Climb');
  await pages.tobin.getByTestId('propose-skill-mira-pc-0-go').click();
  await expect(pages.tobin.getByTestId('propose-skill-mira-pc-0-result')).toHaveText('Saved.'); // a result shown beside the button, not only a banner out of sight
  // A mistaken proposal can be taken back: it falls away, then Tobin proposes again.
  await grant(pages.tobin, 0, 'skill').getByTestId('withdraw').click();
  await expect(grant(pages.tobin, 0, 'skill').getByTestId('proposal')).toHaveCount(0);
  await pages.tobin.getByTestId('propose-skill-mira-pc-0-skill').fill('Climb');
  await pages.tobin.getByTestId('propose-skill-mira-pc-0-go').click();
  await expect(grant(pages.tobin, 0, 'skill').getByTestId('proposal')).toContainText('Climb');
  await pages.wren.getByTestId('propose-skill-mira-pc-0-skill').fill('Persuade');
  await pages.wren.getByTestId('propose-skill-mira-pc-0-mode').selectOption('raise');
  await pages.wren.getByTestId('propose-skill-mira-pc-0-go').click();
  await gm.getByTestId('tab-director').click();
  const tied = gm.getByTestId('gm-grant').filter({ hasText: 'tied' });
  await expect(tied).toBeVisible();
  await tied.getByTestId('gm-choose').filter({ hasText: 'Choose this' }).nth(1).click();
  await open(pages.mira);
  await expect(pages.mira.locator('[data-index="0"] [data-testid="chapter-skill"]')).toContainText('Persuade (Capable)');

  // Mira's first Trait: Tobin proposes, Wren agrees: a majority of the other two.
  await grant(pages.tobin, 0, 'trait').getByTestId('propose-trait-mira-pc-0-trait').fill('Quick Tempered');
  await grant(pages.tobin, 0, 'trait').getByTestId('propose-trait-mira-pc-0-go').click();
  await expect(grant(pages.wren, 0, 'trait').getByTestId('proposal')).toContainText('Quick Tempered');
  await grant(pages.wren, 0, 'trait').getByTestId('accept').click();
  await expect(pages.mira.locator('[data-index="0"] [data-testid="chapter-trait"]')).toContainText('Quick Tempered');

  // Mira's one swap: she reopens a Trait she was given, and the others grant a different one.
  await pages.mira.locator('[data-index="1"] [data-testid="swap-trait"]').click();
  await expect(pages.mira.getByTestId('swap-trait')).toHaveCount(0); // spent
  await grant(pages.tobin, 1, 'trait').getByTestId('propose-trait-mira-pc-1-trait').fill('Cannot Back Down');
  await grant(pages.tobin, 1, 'trait').getByTestId('propose-trait-mira-pc-1-go').click();
  await grant(pages.wren, 1, 'trait').getByTestId('accept').click();
  await expect(pages.mira.locator('[data-index="1"] [data-testid="chapter-trait"]')).toContainText('Cannot Back Down');

  // Mira's chapter outputs through the forms; the others' through the API.
  const out = (i: number, f: string) => creation(pages.mira).getByTestId(`output-${i}-${f}`);
  await out(0, 'kind').selectOption('connection'); await out(0, 'text').fill('Captain Aldous, who taught me the sword');
  await out(0, 'withCharacterId').selectOption({ label: 'Tobin' }); await submit(pages.mira, 'output-0');
  await out(1, 'text').fill('The captain wants me silenced'); await submit(pages.mira, 'output-1'); // the bad chapter can only leave a Thread
  await out(2, 'kind').selectOption('resource'); await out(2, 'text').fill('A guild friend'); await out(2, 'raise').selectOption('network'); await submit(pages.mira, 'output-2');
  for (const owner of ['tobin', 'wren']) {
    const other = owner === 'tobin' ? 'wren' : 'tobin';
    for (const [i, output] of [{ kind: 'connection', text: `${owner} met someone`, withCharacterId: `${other}-pc` }, { kind: 'thread', text: `${owner} has an enemy` }, { kind: 'resource', text: `${owner} saved coin`, raise: 'wealth' }].entries())
      expect((await step(owner, 'output', { chapter: i, output })).status).toBe(200);
  }
  // A world fact per chapter. Mira's second names a community, which prompts for its Standing.
  await creation(pages.mira).getByTestId('fact-0-text').fill('Cadets are drilled at the Keep.'); await submit(pages.mira, 'fact-0');
  await creation(pages.mira).getByTestId('fact-1-text').fill('The Cathedral keeps the ledgers.');
  await creation(pages.mira).getByTestId('fact-1-community').fill('Cathedral'); await submit(pages.mira, 'fact-1');
  await creation(pages.mira).getByTestId('fact-2-text').fill('The river road is guarded.'); await submit(pages.mira, 'fact-2');
  await expect(creation(pages.mira).getByTestId('capital-standing:Cathedral')).toBeVisible();
  for (const owner of ['tobin', 'wren']) for (const i of [0, 1, 2]) expect((await step(owner, 'fact', { chapter: i, text: `${owner} fact ${i}` })).status).toBe(200);
  await pages.tobin.getByTestId('tab-codex').click();
  await expect(pages.tobin.getByTestId('canon-entry')).toHaveCount(10);

  // Crossings: each proposed by one, confirmed by the other. Mira-Tobin touches a Belief, as does Tobin-Wren.
  async function cross(from: Page, to: Page, withName: string, touches: boolean) {
    await open(from); await open(to);
    await creation(from).getByTestId('crossing-with').selectOption({ label: withName });
    await firstUnused(from, 'crossing-form');
    if (touches) await creation(from).getByTestId('crossing-form-touchesBelief').check();
    await creation(from).getByTestId('crossing-form-fromConnection').fill(`${withName}, who stood by me`);
    await creation(from).getByTestId('crossing-form-toConnection').fill('Someone who owes me');
    await submit(from, 'crossing-form');
    await expect(creation(to).locator('[data-testid="crossing"][data-status="pending"]')).toBeVisible();
    await creation(to).getByTestId('crossing-confirm').click();
    await expect(creation(from).locator('[data-testid="crossing"][data-status="confirmed"]').last()).toBeVisible();
  }
  await cross(pages.mira, pages.tobin, 'Tobin', true);
  await cross(pages.mira, pages.wren, 'Wren', false);
  await cross(pages.tobin, pages.wren, 'Wren', true);

  // Everything else on the sheet. Wren checks the end check lists what is still missing before she is done.
  await finishSheet(pages.mira, 'Mira', true);
  await finishSheet(pages.tobin, 'Tobin');
  await open(pages.wren);
  await expect(creation(pages.wren).getByTestId('finish')).toBeDisabled();
  await expect(creation(pages.wren).locator('[data-testid="check-problem"][data-code="HOOK"]')).toBeVisible();
  await finishSheet(pages.wren, 'Wren');

  for (const p of [pages.mira, pages.tobin, pages.wren]) {
    await expect(creation(p).getByTestId('check-passed')).toBeVisible();
    await creation(p).getByTestId('finish').click();
    await expect(creation(p).getByTestId('creation-status')).toHaveText('ready');
  }

  // Begin play, from the GM only once all three are ready.
  await gm.getByTestId('tab-director').click();
  await expect(gm.getByTestId('begin-play')).toBeEnabled();
  await gm.getByTestId('begin-play').click();
  await expect(gm.getByTestId('phase')).toHaveText('play has begun');

  // And a character made this way plays: Mira opens a card with the Skill she was granted and rolls it.
  const mira = pages.mira;
  await mira.getByTestId('tab-ledger').click();
  await write(mira, 'I talk my way past the guard.');
  await mira.getByTestId('new-roll-open').click();
  const card = mira.getByTestId('card').first();
  const commit = async (f: ReturnType<Page['getByTestId']>, v: string) => { await f.fill(v); await f.blur(); };
  await commit(card.getByTestId('want'), 'Get through the gate');
  await commit(card.getByTestId('risk'), 'They remember my face');
  await commit(card.getByTestId('danger-text'), 'They remember my face');
  await card.getByTestId('danger-kind').selectOption('other');
  await card.getByTestId('difficulty').selectOption('Demanding');
  await card.getByTestId('danger').selectOption('Serious');
  await expect(card.getByTestId('odds')).toBeVisible();
  await queueDice(t, [7, 2, 1]);
  await card.getByTestId('roll').click();
  await expect(card.getByTestId('outcome')).toBeVisible();
});

test('a player who joins after play has begun creates their character mid-campaign and cannot roll until it is ready', async ({ browser }) => {
  const t = await createTable(['ilse'], 'The Border War', false); // stays in session zero until the GM begins play
  const gm = await join(browser, t, 'gm1');
  await join(browser, t, 'ilse');
  await gm.getByTestId('tab-director').click();
  await expect(gm.getByTestId('begin-play')).toBeEnabled(); // Ilse's sheet is ready-made
  await gm.getByTestId('begin-play').click();
  await expect(gm.getByTestId('phase')).toHaveText('play has begun');

  const inv = await api('gm1', 'POST', `/api/campaigns/${t}/invites`);
  expect((await api('wren', 'POST', '/api/invites/accept', { token: inv.json.invite.token })).status).toBe(200);
  const wren = await join(browser, t, 'wren');
  await wren.getByTestId('tab-roster').click();
  await expect(wren.locator('[data-character="wren-pc"] [data-testid="creating-badge"]')).toBeVisible();
  await expect(wren.locator('[data-character="ilse-pc"] [data-testid="creating-badge"]')).toHaveCount(0);
  await open(wren);
  await expect(wren.getByText('Play has begun.')).toBeVisible();
  await expect(creation(wren).getByTestId('finish')).toBeDisabled();
  const card = await api('wren', 'POST', `/api/campaigns/${t}/cards`, { skillName: 'Climb' });
  const roll = await api('wren', 'POST', `/api/campaigns/${t}/cards/${card.json.card.id}/roll`);
  expect([roll.status, roll.json.error.code]).toEqual([409, 'NOT_READY']);
  // The GM can let her through, with the reason on the record.
  await gm.getByTestId('tab-director').click();
  await gm.getByTestId('override-wren-pc-reason').fill('Joining mid-story; we will fill her sheet in as we play');
  await gm.getByTestId('override-wren-pc-go').click();
  await expect(gm.getByTestId('override-log')).toContainText('Joining mid-story');
  await expect(wren.getByTestId('creation-status')).toHaveText('ready');
});

test('a solo draft is private, is marked up, and is brought to the table where it opens the grant cards', async ({ browser }) => {
  const t = await createTable(['mira', 'tobin']);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const draft = await ctx.newPage();
  await draft.goto(`/draft/${t}?as=mira`);
  await expect(draft.getByTestId('draft-workspace')).toHaveAttribute('data-status', 'connected');
  await expect(draft.getByTestId('story')).toBeVisible();
  await draft.locator('.story p').first().click();
  await draft.keyboard.type('Origin: a farm by the river.');
  for (const text of ['The farm years.', 'The siege, and what I did.', 'The road south.']) { await draft.getByTestId('new-post').click(); await draft.keyboard.type(text); }

  // Tobin's draft is his own: it does not show Mira's words.
  const tobinDraft = await (await browser.newContext()).newPage();
  await tobinDraft.goto(`/draft/${t}?as=tobin`);
  await expect(tobinDraft.getByTestId('draft-workspace')).toHaveAttribute('data-status', 'connected');
  await expect(tobinDraft.locator('.story')).not.toContainText('farm');

  // Marks, and what the draft still needs.
  await draft.getByTestId('draft-origin').selectOption({ index: 1 });
  await draft.getByTestId('draft-save').click();
  await expect(draft.getByTestId('draft-problems')).toContainText('Three Life Chapters');
  for (let i = 0; i < 3; i++) {
    await draft.getByTestId('draft-add-chapter').click();
    const row = draft.getByTestId('draft-chapter').nth(i);
    await row.getByTestId('draft-chapter-paragraph').selectOption({ index: i + 2 });
    await row.getByTestId('draft-chapter-summary').fill(['The farm', 'The siege', 'The road'][i]!);
    if (i === 1) await row.getByTestId('draft-chapter-bad').check();
  }
  await draft.getByTestId('draft-save').click();
  await expect(draft.getByTestId('draft-ok')).toBeVisible();

  // Bring it to the table.
  await draft.getByTestId('draft-bring').click();
  await expect(draft).toHaveURL(new RegExp(`/story/${t}`));
  await expect(draft.getByTestId('workspace')).toHaveAttribute('data-status', 'connected');
  await expect(paragraphs(draft)).toHaveCount(4);
  await expect(paragraphs(draft).nth(1)).toContainText('The farm years.');
  await draft.getByTestId('tab-create').click();
  await expect(draft.getByTestId('chapter-block')).toHaveCount(3);
  const tobin = await join(browser, t, 'tobin');
  await expect(paragraphs(tobin)).toHaveCount(4);
  await tobin.getByTestId('tab-create').click();
  await expect(tobin.getByTestId('grant-card')).toHaveCount(3);
  // With two players the other player's proposal settles it at once.
  await tobin.getByTestId('propose-skill-mira-pc-0-skill').fill('Climb');
  await tobin.getByTestId('propose-skill-mira-pc-0-go').click();
  await expect(draft.locator('[data-index="0"] [data-testid="chapter-skill"]')).toContainText('Climb (Trained)');
});
