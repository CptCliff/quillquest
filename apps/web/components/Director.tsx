'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { DANGER_RANKS, DIFFICULTY_RANKS, RATED_SKILL_RANKS, type Character, type CheckOverride, type ConvictionLogEntry, type Nomination, type Npc, type NpcField } from '@quillquest/rules';
import type { Draft, SuggestionKind } from '@quillquest/prompts';
import { ApiFailure, type GameApi, type LedgerCard, type Settings, type SuggestionRow } from '../lib/game-api';
import { useSession } from '../lib/session';
import { StepForm } from './Forms';
import { useAct } from './Ledger';
import { StoryEditor, type Me } from './StoryEditor';

type Notice = (message: string) => void;
interface Item { id: string; kind: SuggestionKind; label: string; text: string; original: string }

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234';

/** A draft as editable text: prompts, Dangers, a line, or a face of the Burden oracle. */
function draftText(draft: Draft, faces: string[]): string {
  if ('prompts' in draft) return draft.prompts.join('\n');
  if ('options' in draft) return draft.options.map((o) => `${o.danger} (${o.rank})`).join('\n');
  if ('line' in draft) return draft.line;
  if ('face' in draft) return `${faces[draft.face - 1] ?? `Face ${draft.face}`}: ${draft.tie}`;
  return JSON.stringify(draft);
}

/** The GM's Director tab (design plan 8.1): Beliefs board, pending cards, Conviction, NPCs, notes, the Claude assistant, overrides, settings. */
export function Director({ game, characters, cards, convictionLog, overrides, me, campaign, onNotice }: {
  game: GameApi; characters: Record<string, Character>; cards: LedgerCard[]; convictionLog: Record<string, ConvictionLogEntry>; overrides: CheckOverride[]; me: Me; campaign: string; onNotice: Notice;
}) {
  const { busy, run } = useAct(onNotice);
  const [data, setData] = useState<{ nominations: Nomination[]; npcs: Npc[]; settings: Settings } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const load = useCallback(() => game.director().then(setData, (e) => onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong')), [game, onNotice]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  const players = useMemo(() => Object.values(characters).filter((c) => c.ownerId && !c.left), [characters]);
  const faces = data?.settings.faces ?? [];

  /** Ask Claude; the answer is only ever a draft in the panel below. */
  const ask = (kind: SuggestionKind, params: Record<string, unknown>, label: string) => run(async () => {
    const r = await game.ask(kind, params);
    const text = draftText(r.suggestion.draft, faces);
    setItems((cur) => [{ id: r.suggestion.id, kind, label, text, original: text }, ...cur]);
    load();
  });
  const settle = (it: Item, status: 'used' | 'edited' | 'dismissed') => run(async () => {
    await game.suggestionStatus(it.id, status);
    if (status !== 'dismissed') await navigator.clipboard?.writeText(it.text).catch(() => undefined);
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    load();
  });

  const pending = cards.filter((c) => c.status === 'draft' || c.status === 'set');
  const nameOf = (id: string) => characters[id]?.name ?? id;
  const openNominations = (data?.nominations ?? []).filter((n) => n.status === 'open');

  return (
    <section aria-label="Director" data-testid="director">
      <h3>Claude assistant {data && <span className="badge" data-testid="llm-remaining">{data.settings.configured ? `${Math.max(data.settings.cap - data.settings.used, 0)} of ${data.settings.cap} left this session` : 'not set up'}</span>}</h3>
      <p className="muted">Drafts only: nothing here reaches the story unless you use it.</p>
      {items.length === 0 && <p className="muted">No drafts yet.</p>}
      {items.map((it) => (
        <div key={it.id} className="card" data-testid="ai-draft" data-kind={it.kind}>
          <strong>{it.label}</strong>
          <textarea aria-label="Draft" data-testid="ai-draft-text" rows={3} value={it.text} onChange={(e) => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))} />
          <div className="actions">
            <button type="button" data-testid="ai-use" disabled={busy} onClick={() => settle(it, it.text === it.original ? 'used' : 'edited')}>Use (copies it)</button>
            <button type="button" data-testid="ai-dismiss" disabled={busy} onClick={() => settle(it, 'dismissed')}>Dismiss</button>
          </div>
        </div>
      ))}

      <h3>Beliefs board</h3>
      {players.length === 0 && <p className="muted">No players yet.</p>}
      {players.map((c) => (
        <article key={c.id} className="card" data-testid="board-character" data-character={c.id}>
          <strong>{c.name}</strong> <span data-testid="board-conviction" aria-label={`${c.conviction} Conviction`}>{'●'.repeat(c.conviction)}{'○'.repeat(Math.max(0, 3 - c.conviction))}</span>
          <ul>
            {c.beliefs.map((b) => (
              <li key={b.id} data-testid="board-belief" data-earned={b.convictionEarnedThisSession}>
                {b.isCore ? 'Core: ' : ''}{b.text}{b.convictionEarnedThisSession ? ' ✓ earned this session' : ''}
                <button type="button" className="linklike" data-testid="board-challenge" disabled={busy} onClick={() => ask('beliefChallenge', { characterId: c.id, beliefId: b.id }, `Ways to test “${b.text}”`)}> challenge prompts</button>
              </li>
            ))}
          </ul>
          {c.burdens.filter((b) => b.status === 'active').map((b) => <div key={b.id}>Burden: {b.name}</div>)}
        </article>
      ))}

      <h3>Pending cards</h3>
      {pending.length === 0 && <p className="muted" data-testid="no-pending">Nothing is waiting on you.</p>}
      {pending.map((c) => (
        <div key={c.id} className="card" data-testid="pending-card" data-card={c.id}>
          <strong>{nameOf(c.characterId)}: {c.skillName}</strong> <span className="badge">{c.status}{c.odds ? ` · ${c.odds.goal}` : ''}</span>
          <div>{c.want || '(no want yet)'} — {c.risk || '(no risk yet)'}</div>
          <div className="row">
            <select aria-label="Difficulty" data-testid="pending-difficulty" value={c.difficulty ?? ''} onChange={(e) => run(() => game.edit(c.id, { difficulty: e.target.value || null }))}>
              <option value="">Difficulty…</option>{DIFFICULTY_RANKS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select aria-label="Danger" data-testid="pending-danger" value={c.danger ?? ''} onChange={(e) => run(() => game.edit(c.id, { danger: e.target.value || null }))}>
              <option value="">Danger…</option>{DANGER_RANKS.map((r) => <option key={r}>{r}</option>)}
            </select>
            {c.status === 'draft' && <button type="button" data-testid="pending-set" disabled={busy} onClick={() => run(() => game.set(c.id))}>Set</button>}
            <button type="button" data-testid="pending-sharpen" disabled={busy} onClick={() => ask('danger', { cardId: c.id }, `Sharper Dangers for ${nameOf(c.characterId)}'s ${c.skillName}`)}>Sharpen Danger</button>
          </div>
        </div>
      ))}

      <h3>Conviction</h3>
      {openNominations.length === 0 && <p className="muted">No nominations waiting.</p>}
      {openNominations.map((n) => (
        <div key={n.id} className="card" data-testid="nomination" data-nomination={n.id}>
          {nameOf(n.characterId)} ({n.kind}): {n.note}
          <div className="actions">
            <button type="button" data-testid="nomination-award" disabled={busy} onClick={() => run(async () => { await game.awardNomination(n.id); load(); })}>Award</button>
            <button type="button" data-testid="nomination-decline" disabled={busy} onClick={() => run(async () => { await game.declineNomination(n.id); load(); })}>Decline</button>
          </div>
        </div>
      ))}
      {players.length > 0 && <AwardForm game={game} players={players} run={run} busy={busy} />}
      <ul data-testid="conviction-log">{Object.values(convictionLog).map((e) => <li key={e.id}>{nameOf(e.characterId)}: {e.note}</li>)}</ul>

      <h3>NPCs</h3>
      <StepForm testId="npc-new" label="Add an NPC" run={run} busy={busy} fields={[{ key: 'name', label: 'Name' }]} submit={async (v) => { await game.createNpc(String(v.name)); load(); }} />
      {(data?.npcs ?? []).map((n) => <NpcCard key={n.id} npc={n} game={game} run={run} busy={busy} reload={load} onLine={() => ask('npcLine', { npcId: n.id }, `A line for ${n.name}`)} />)}

      <h3>Burden oracle</h3>
      <button type="button" data-testid="ask-oracle" disabled={busy} onClick={() => ask('oracle', {}, 'The Burden oracle')}>Ask the oracle</button>

      <h3>GM notes</h3>
      <GmNotes campaign={campaign} me={me} onNotice={onNotice} />

      <h3>Override log</h3>
      {overrides.length === 0 && <p className="muted">No overrides yet.</p>}
      <ul data-testid="override-log-director">{overrides.map((o, i) => <li key={i}>{nameOf(o.characterId)}: {o.reason}</li>)}</ul>

      {data && <SettingsForm settings={data.settings} game={game} run={run} busy={busy} reload={load} />}
      <ClaudeLog game={game} reload={data?.settings.used} />
    </section>
  );
}

function AwardForm({ game, players, run, busy }: { game: GameApi; players: Character[]; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [who, setWho] = useState(players[0]!.id);
  const c = players.find((p) => p.id === who) ?? players[0]!;
  return (
    <div>
      <label className="field"><span>Award Conviction to</span>
        <select data-testid="award-who" value={c.id} onChange={(e) => setWho(e.target.value)}>{players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <StepForm key={c.id} testId="award" label="Award" run={run} busy={busy}
        fields={[
          { key: 'kind', label: 'It paid for', kind: 'select', options: [{ value: 'belief', label: 'A Belief' }, { value: 'instinct', label: 'An Instinct' }, { value: 'trait', label: 'A harmful Trait' }, { value: 'other', label: 'Something else' }] },
          { key: 'beliefId', label: 'Which Belief', kind: 'select', options: c.beliefs.map((b) => ({ value: b.id, label: b.text })) },
          { key: 'note', label: 'What happened' },
        ]}
        submit={(v) => game.awardDirect({ characterId: c.id, kind: String(v.kind), beliefId: v.kind === 'belief' ? String(v.beliefId) : undefined, note: String(v.note) })} />
    </div>
  );
}

function NpcCard({ npc, game, run, busy, reload, onLine }: { npc: Npc; game: GameApi; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean; reload: () => void; onLine: () => void }) {
  const shown = (f: NpcField) => npc.revealedFields.includes(f);
  const reveal = (f: NpcField) => run(async () => { await game.revealNpc(npc.id, f); reload(); });
  const badge = (f: NpcField) => (shown(f)
    ? <span className="badge" data-testid={`npc-${f}-state`}>revealed</span>
    : <button type="button" className="linklike" data-testid={`npc-reveal-${f}`} disabled={busy} onClick={() => reveal(f)}>reveal</button>);
  return (
    <article className="card" data-testid="npc" data-npc={npc.id}>
      <strong>{npc.name}</strong> {badge('name')}
      <StepForm testId={`npc-${npc.id}`} label="Save" run={run} busy={busy}
        fields={[
          { key: 'skills', label: `Skills, as “Name Rank, Name Rank” (${RATED_SKILL_RANKS.join(', ')})`, initial: npc.skills.map((s) => `${s.name} ${s.rank}`).join(', ') },
          { key: 'beliefs', label: 'Beliefs (separate with ;)', initial: npc.beliefs.join('; ') },
          { key: 'notes', label: 'Notes', initial: npc.notes },
        ]}
        submit={async (v) => {
          await game.editNpc(npc.id, {
            skills: String(v.skills).split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.lastIndexOf(' '); return { name: x.slice(0, i).trim(), rank: x.slice(i + 1) as never }; }),
            beliefs: String(v.beliefs).split(';').map((x) => x.trim()).filter(Boolean), notes: String(v.notes),
          });
          reload();
        }} />
      <div>Skills {badge('skills')} · Beliefs {badge('beliefs')} · Notes {badge('notes')}</div>
      <button type="button" data-testid="npc-line" disabled={busy} onClick={onLine}>A line of dialogue</button>
    </article>
  );
}

function SettingsForm({ settings, game, run, busy, reload }: { settings: Settings; game: GameApi; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean; reload: () => void }) {
  return (
    <>
      <h3>Table settings <span className="badge" data-testid="session-no">session {settings.sessionNo}</span></h3>
      <StepForm testId="settings" label="Save settings" run={run} busy={busy}
        fields={[
          { key: 'themes', label: 'Themes to handle lightly or leave out (every Claude prompt carries these)', initial: settings.themes },
          ...[0, 1, 2, 3, 4, 5].map((i) => ({ key: `f${i}`, label: `Burden face ${i + 1}`, initial: settings.faces[i] ?? '' })),
          { key: 'cap', label: 'Claude calls allowed per session (0 turns it off)', initial: String(settings.cap) },
        ]}
        submit={async (v) => {
          const faces = [0, 1, 2, 3, 4, 5].map((i) => String(v[`f${i}`]).trim());
          await game.saveSettings({ themes: String(v.themes), faces: faces.every(Boolean) ? faces : [], cap: Number(v.cap) });
          reload();
        }} />
      <button type="button" data-testid="start-session" disabled={busy} onClick={() => { if (window.confirm('Start a new session? Beliefs may earn Conviction again and the Claude call count restarts.')) run(async () => { await game.startSession(); reload(); }); }}>Start a new session</button>
    </>
  );
}

function ClaudeLog({ game, reload }: { game: GameApi; reload: unknown }) {
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  useEffect(() => { game.suggestions().then((r) => setRows(r.suggestions), () => undefined); }, [game, reload]);
  return (
    <>
      <h3>Claude log</h3>
      <ul data-testid="claude-log">{rows.slice(0, 20).map((r) => <li key={r.id} data-kind={r.kind} data-status={r.status}>{r.kind} · {r.status}</li>)}</ul>
    </>
  );
}

/** The GM's private notes: the same editor in a document only the GM can open. */
function GmNotes({ campaign, me, onNotice }: { campaign: string; me: Me; onNotice: Notice }) {
  const session = useSession();
  const [conn, setConn] = useState<{ doc: Y.Doc; provider: HocuspocusProvider } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: SYNC_URL, name: `${campaign}~gm`, document: doc, token: () => session.getToken() });
    setConn({ doc, provider });
    return () => { provider.destroy(); doc.destroy(); setConn(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);
  if (!conn) return null;
  return (
    <div className="gm-notes" data-testid="gm-notes">
      <StoryEditor doc={conn.doc} provider={conn.provider} me={me} onEditor={() => undefined} onNotice={onNotice} mySkills={() => []} onOpenAuthor={() => undefined}
        onChipInfo={() => undefined} onChipRoll={() => undefined} lookupInk={() => undefined} inkVersion={0} />
    </div>
  );
}
