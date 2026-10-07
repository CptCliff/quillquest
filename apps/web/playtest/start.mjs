// Seeds a campaign (GM + three players by invite) and starts one browser per person. Writes /tmp/playtest/ports.json and info.json.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const WEB = 'http://localhost:3100';
const SYNC = 'http://localhost:1234';
const people = ['gm1', 'mira', 'tobin', 'wren'];
mkdirSync('/tmp/playtest/shots', { recursive: true });
const call = async (user, method, path, body) => {
  const t = (await (await fetch(`${WEB}/api/dev-token?user=${user}`)).json()).token;
  const r = await fetch(`${SYNC}${path}`, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const made = await call('gm1', 'POST', '/api/campaigns', { title: 'The Border War' });
if (made.status !== 200) throw new Error(`could not create the campaign: ${JSON.stringify(made)}`);
const campaign = made.json.campaign.id;
for (const p of people.slice(1)) {
  const inv = await call('gm1', 'POST', `/api/campaigns/${campaign}/invites`);
  const acc = await call(p, 'POST', '/api/invites/accept', { token: inv.json.invite.token });
  if (acc.status !== 200) throw new Error(`${p} could not join: ${JSON.stringify(acc)}`);
}
const ports = {};
people.forEach((p, i) => { ports[p] = 4101 + i; });
for (const p of people) {
  const child = spawn('node', [new URL('./daemon.mjs', import.meta.url).pathname, p, campaign, String(ports[p])], { detached: true, stdio: ['ignore', 'ignore', 'ignore'], cwd: new URL('..', import.meta.url).pathname });
  child.unref();
}
writeFileSync('/tmp/playtest/ports.json', JSON.stringify(ports));
writeFileSync('/tmp/playtest/info.json', JSON.stringify({ campaign, url: `${WEB}/story/${campaign}`, people }));
await new Promise((r) => setTimeout(r, 6000));
console.log(JSON.stringify({ campaign, ports }));
