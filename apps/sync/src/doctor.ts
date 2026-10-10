// "Doctor": checks a real deployment's configuration against the real services, before any player depends on it.
// Run with `pnpm --filter @quillquest/sync check:services` (reads the same environment variables the server does). It changes nothing
// except sending one test email when you pass --send-to=<address>. Exit code 1 if any check fails.
import { buildRequest, parseAnswer, type Input, type SuggestionKind } from '@quillquest/prompts';
import { providerFromEnv, type LlmProvider } from './llm';
import { mailerFromEnv, type Mailer } from './mail';

export interface Check { area: string; name: string; ok: boolean; detail: string; ms?: number }
type Env = Record<string, string | undefined>;

const THEMES = 'graphic violence toward children';
/** One fixed input per request kind: what the real model has to answer well enough for the strict parsers to accept. */
export const FIXTURES: { kind: SuggestionKind; role: 'gm' | 'player'; input: Input; ctx?: { skills?: string[]; faces?: number } }[] = [
  { kind: 'skillMatch', role: 'player', input: { kind: 'skillMatch', themes: '', sentence: 'I creep past the guards.', skills: ['Sneak', 'Climb', 'Persuade'] }, ctx: { skills: ['Sneak', 'Climb', 'Persuade'] } },
  { kind: 'grant', role: 'player', input: { kind: 'grant', themes: THEMES, chapterProse: 'I held the barricade for three nights, feeding the wounded and counting arrows.', endsBadly: false } },
  { kind: 'grant', role: 'player', input: { kind: 'grant', themes: THEMES, chapterProse: 'I stood the north gate for six winters, checking carts and toll papers at the border.', endsBadly: false, template: { name: 'The Gate Warden', skills: ['Gatekeeping', 'Reading Strangers'], traits: ['Watchful', 'Stoic'] } } },
  { kind: 'beliefCheck', role: 'player', input: { kind: 'beliefCheck', themes: THEMES, belief: { kind: 'objective', text: 'Expose the duke before the council meets' } } },
  { kind: 'beliefChallenge', role: 'gm', input: { kind: 'beliefChallenge', themes: THEMES, scene: 'The gate is shut and the captain is watching.', canon: ['The treaty is a lie.'], character: { name: 'Ilse', beliefs: [{ text: 'Oaths outlast the people who swear them', isCore: true }], burdens: ['Doubts the Oath'] } } },
  { kind: 'danger', role: 'gm', input: { kind: 'danger', themes: THEMES, scene: 'A rooftop chase.', card: { want: 'Cross the roof', risk: 'I slip', onTheLine: null } } },
  { kind: 'npcLine', role: 'gm', input: { kind: 'npcLine', themes: THEMES, scene: 'The captain stops them at the gate.', npc: { name: 'Captain Aldous', skills: ['Swordplay Expert'], beliefs: ['Order before mercy'], notes: '' } } },
  { kind: 'oracle', role: 'gm', input: { kind: 'oracle', themes: THEMES, scene: 'A quiet night in the camp.', faces: ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'] }, ctx: { faces: 6 } },
];

/** Asks the configured model every kind of question and says whether the strict parsers accepted each answer (one retry, as in play). */
export async function checkLlm(provider: LlmProvider | null): Promise<Check[]> {
  if (!provider) return [{ area: 'model', name: 'configured', ok: false, detail: 'QUILLQUEST_LLM is not set: the Claude assistant will answer "not set up"' }];
  const out: Check[] = [{ area: 'model', name: 'configured', ok: true, detail: `provider ${provider.name}` }];
  for (const f of FIXTURES) {
    const request = buildRequest(f.input, f.role);
    const started = Date.now();
    let last = '';
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const { text } = await provider.complete(request);
        const parsed = parseAnswer(f.kind, text, f.ctx ?? {});
        if (parsed.ok) ok = true; else last = parsed.error;
      } catch (e) { last = e instanceof Error ? e.message : 'request failed'; }
    }
    const tag = f.kind === 'grant' && 'template' in f.input && f.input.template ? 'grant (adapt a template)' : f.kind;
    out.push({ area: 'model', name: tag, ok, detail: ok ? 'answer accepted' : `not accepted after a retry: ${last}`, ms: Date.now() - started });
  }
  return out;
}

/** Validates the mail settings and, only if asked, sends one test message. */
export async function checkMail(mailer: Mailer | null, sendTo?: string): Promise<Check[]> {
  if (!mailer) return [{ area: 'mail', name: 'configured', ok: false, detail: 'QUILLQUEST_MAIL is not set: nobody will be emailed (the game works without it)' }];
  const out: Check[] = [{ area: 'mail', name: 'configured', ok: true, detail: `provider ${mailer.name}` }];
  if (!sendTo) { out.push({ area: 'mail', name: 'test message', ok: true, detail: 'skipped: pass --send-to=you@example.com to send one' }); return out; }
  const started = Date.now();
  try {
    await mailer.send({ to: sendTo, subject: 'Quillquest: test message', text: 'If you can read this, Quillquest can send mail.' });
    out.push({ area: 'mail', name: 'test message', ok: true, detail: `sent to ${sendTo}; check the inbox (and spam)`, ms: Date.now() - started });
  } catch (e) { out.push({ area: 'mail', name: 'test message', ok: false, detail: e instanceof Error ? e.message : 'send failed', ms: Date.now() - started }); }
  return out;
}

/** Supabase: the project answers, publishes signing keys (or an HS256 secret is set), and no dev switches are on. */
export async function checkAuth(env: Env, fetchFn: typeof fetch = fetch): Promise<Check[]> {
  const out: Check[] = [];
  const base = env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) return [{ area: 'sign-in', name: 'SUPABASE_URL', ok: false, detail: 'not set: the server will not start in production' }];
  out.push({ area: 'sign-in', name: 'SUPABASE_URL', ok: true, detail: base });
  try {
    const res = await fetchFn(`${base}/.well-known/jwks.json`);
    const keys = res.ok ? ((await res.json()) as { keys?: unknown[] }).keys?.length ?? 0 : 0;
    if (keys > 0) out.push({ area: 'sign-in', name: 'signing keys', ok: true, detail: `${keys} published` });
    else if (env.SUPABASE_JWT_SECRET) out.push({ area: 'sign-in', name: 'signing keys', ok: true, detail: 'none published; using SUPABASE_JWT_SECRET (HS256)' });
    else out.push({ area: 'sign-in', name: 'signing keys', ok: false, detail: `no keys at ${base}/.well-known/jwks.json (HTTP ${res.status}) and no SUPABASE_JWT_SECRET: tokens cannot be verified` });
  } catch (e) { out.push({ area: 'sign-in', name: 'signing keys', ok: false, detail: `could not reach the project: ${e instanceof Error ? e.message : 'request failed'}` }); }
  for (const k of ['QUILLQUEST_DEV_AUTH', 'NEXT_PUBLIC_DEV_AUTH']) out.push({ area: 'sign-in', name: `${k} is off`, ok: !env[k], detail: env[k] ? 'must not be set outside your own machine' : 'not set' });
  out.push({ area: 'sign-in', name: 'web variables', ok: !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY, detail: env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY set' : 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing (needed by the web app)' });
  return out;
}

export function render(checks: Check[]): string {
  const areas = [...new Set(checks.map((c) => c.area))];
  return areas.map((a) => [`\n${a}`, ...checks.filter((c) => c.area === a).map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}${c.ms !== undefined ? ` (${c.ms} ms)` : ''}`)].join('\n')).join('\n');
}

async function main() {
  const env = process.env;
  const sendTo = process.argv.find((a) => a.startsWith('--send-to='))?.slice(10);
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const wants = (area: string) => !only || only.split(',').includes(area);
  const checks: Check[] = [];
  const guard = async (area: string, fn: () => Promise<Check[]>) => { try { checks.push(...(await fn())); } catch (e) { checks.push({ area, name: 'setup', ok: false, detail: e instanceof Error ? e.message : 'failed' }); } };
  if (wants('sign-in')) await guard('sign-in', () => checkAuth(env));
  if (wants('model')) await guard('model', async () => checkLlm(providerFromEnv(env, true)));
  if (wants('mail')) await guard('mail', async () => checkMail(mailerFromEnv(env, true), sendTo));
  console.log(render(checks));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main();
