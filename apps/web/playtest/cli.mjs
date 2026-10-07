#!/usr/bin/env node
// Usage: node apps/web/playtest/cli.mjs <user> <command> [args...]    (see the playtest guide for the commands)
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const [user, cmd, ...args] = process.argv.slice(2);
const DIR = '/tmp/playtest';
if (user === 'chat') {
  const [who, ...rest] = [cmd, ...args];
  if (who === 'read') { console.log(existsSync(`${DIR}/chat.log`) ? readFileSync(`${DIR}/chat.log`, 'utf8').split('\n').slice(-60).join('\n') : '(nobody has said anything yet)'); }
  else { appendFileSync(`${DIR}/chat.log`, `[${new Date().toISOString().slice(11, 19)}] ${who}: ${rest.join(' ')}\n`); console.log('said'); }
  process.exit(0);
}
const ports = JSON.parse(readFileSync(`${DIR}/ports.json`, 'utf8'));
if (!ports[user]) { console.log(`unknown user ${user}. Users: ${Object.keys(ports).join(', ')}`); process.exit(1); }
const r = await fetch(`http://127.0.0.1:${ports[user]}/cmd`, { method: 'POST', body: JSON.stringify({ cmd, args }) }).catch(() => null);
console.log(r ? await r.text() : 'ERROR: that browser is not running');
