// One playtester's browser: a headless Chromium on the table as one dev user, driven over a tiny local HTTP API by cli.mjs.
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const [user, campaign, port] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3100';
const SYNC = process.env.SYNC ?? 'http://localhost:1234';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(6000);
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
await page.goto(`${WEB}/story/${campaign}?as=${user}`);

const scope = (spec) => (!spec ? page.locator('body') : spec.startsWith('testid=') ? page.getByTestId(spec.slice(7)) : page.locator(spec));
const flags = (args) => { const nth = args.find((a) => a.startsWith('--nth=')); return { nth: nth ? Number(nth.slice(6)) : undefined, rest: args.filter((a) => !a.startsWith('--nth=')) }; };
const pick = (loc, nth) => (nth === undefined ? loc : loc.nth(nth));
async function one(loc, what) {
  const n = await loc.count();
  if (n === 0) throw new Error(`nothing matches ${what}`);
  if (n > 1) throw new Error(`${n} things match ${what}; add --nth=0..${n - 1} or be more specific`);
  return loc;
}

const commands = {
  async look([spec]) {
    const snap = await scope(spec).ariaSnapshot();
    return `URL: ${page.url()}\n${snap.length > 14000 ? `${snap.slice(0, 14000)}\n…(truncated; use "look testid=..." or "look <css>" to narrow)` : snap}`;
  },
  async text([spec]) { return (await scope(spec).innerText()).slice(0, 8000); },
  async click(args) { const { nth, rest } = flags(args); const [role, ...name] = rest; const loc = pick(page.getByRole(role, { name: name.join(' ') }), nth); await (await one(loc, `${role} "${name.join(' ')}"`)).click(); return 'clicked'; },
  async clicktid(args) { const { nth, rest } = flags(args); const loc = pick(page.getByTestId(rest[0]), nth); await (await one(loc, `testid ${rest[0]}`)).click(); return 'clicked'; },
  async clicktext(args) { const { nth, rest } = flags(args); const loc = pick(page.getByText(rest.join(' '), { exact: false }), nth); await (await one(loc, `text "${rest.join(' ')}"`)).click(); return 'clicked'; },
  async fill(args) { const { nth, rest } = flags(args); const [label, ...v] = rest; const loc = pick(page.getByLabel(label), nth); await (await one(loc, `field "${label}"`)).fill(v.join(' ')); return 'filled'; },
  async filltid(args) { const { nth, rest } = flags(args); const [id, ...v] = rest; const loc = pick(page.getByTestId(id), nth); await (await one(loc, `testid ${id}`)).fill(v.join(' ')); return 'filled'; },
  async select(args) { const { nth, rest } = flags(args); const [label, ...v] = rest; const loc = pick(page.getByLabel(label), nth); await (await one(loc, `select "${label}"`)).selectOption({ label: v.join(' ') }); return 'selected'; },
  async selecttid(args) { const { nth, rest } = flags(args); const [id, ...v] = rest; const loc = pick(page.getByTestId(id), nth); const x = await one(loc, `testid ${id}`); await x.selectOption({ label: v.join(' ') }).catch(() => x.selectOption(v.join(' '))); return 'selected'; },
  async check(args) { const { nth, rest } = flags(args); const loc = pick(page.getByLabel(rest.join(' ')), nth); await (await one(loc, `checkbox "${rest.join(' ')}"`)).check(); return 'checked'; },
  async checktid(args) { const loc = page.getByTestId(args[0]); await (await one(loc, `testid ${args[0]}`)).check(); return 'checked'; },
  /** Write a new paragraph of your own at the end of the story (starts a new post unless the story is empty). */
  async write(args) {
    const text = args.join(' ');
    const paras = page.locator('.story-pane .story p');
    const empty = (await paras.count()) === 1 && !(await paras.first().innerText()).replace(/\s|​/g, '').replace(/^[A-Za-z]+·?/, '').length;
    if (empty) await paras.first().click(); else await page.getByTestId('new-post').click();
    await page.keyboard.type(text, { delay: 5 });
    return 'written';
  },
  async type(args) { await page.keyboard.type(args.join(' '), { delay: 5 }); return 'typed'; },
  async press([key]) { await page.keyboard.press(key); return `pressed ${key}`; },
  async shot([name = 'view']) { const path = `/tmp/playtest/shots/${user}-${name}.png`; await page.screenshot({ path }); return path; },
  async wait([ms = '1000']) { await page.waitForTimeout(Number(ms)); return 'waited'; },
  async reload() { await page.reload(); await page.waitForTimeout(1500); return 'reloaded'; },
  async goto([path]) { await page.goto(`${WEB}${path.includes('?') ? path : `${path}?as=${user}`}`); await page.waitForTimeout(1200); return page.url(); },
  async logs() { const l = logs.splice(0); return l.length ? l.join('\n') : '(no console errors or warnings)'; },
  async viewport([w, h]) { await page.setViewportSize({ width: Number(w), height: Number(h) }); return `viewport ${w}x${h}`; },
  /** Escape hatch: call the game API as this user. Prefer the UI; use this to check what the server says. */
  async api([method, path, body]) {
    const t = (await (await fetch(`${WEB}/api/dev-token?user=${user}`)).json()).token;
    const r = await fetch(`${SYNC}${path}`, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: body || undefined });
    return `${r.status} ${(await r.text()).slice(0, 3000)}`;
  },
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    if (req.url === '/stop') { res.end('bye'); await browser.close(); process.exit(0); }
    try {
      const { cmd, args } = JSON.parse(raw);
      const fn = commands[cmd];
      if (!fn) throw new Error(`unknown command ${cmd}. Commands: ${Object.keys(commands).join(', ')}`);
      const out = await fn(args ?? []);
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end(String(out));
    } catch (e) {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`ERROR: ${String(e.message ?? e).split('\n')[0]}`);
    }
  });
}).listen(Number(port), '127.0.0.1');
console.log(`${user} ready on ${port}`);
