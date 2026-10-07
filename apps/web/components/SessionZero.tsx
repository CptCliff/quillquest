'use client';
import { useState } from 'react';
import { slotState, type CanonEntry, type CheckOverride, type Character, type CreationState } from '@quillquest/rules';
import type { GameApi } from '../lib/game-api';
import { StepForm } from './Forms';
import { useAct } from './Ledger';

type Notice = (message: string) => void;

/** The GM's session-zero tools: the world fact, who is ready and why not, the tie-breaks, the logged override, and Begin play. */
export function SessionZero({ game, characters, creation, canon, phase, overrides, onNotice }: {
  game: GameApi; characters: Record<string, Character>; creation: Record<string, CreationState>; canon: Record<string, CanonEntry>;
  phase: string; overrides: CheckOverride[]; onNotice: Notice;
}) {
  const { busy, run } = useAct(onNotice);
  const players = Object.values(characters).filter((c) => c.ownerId && !c.left);
  const fact = Object.values(canon).find((e) => e.source.type === 'gm');
  const [missing, setMissing] = useState<Record<string, string[]>>({});
  const step = (name: string, body: Record<string, unknown> = {}) => game.step(name, body);
  const why = (id: string) => run(async () => { const r = await game.check(id); setMissing((m) => ({ ...m, [id]: r.problems.map((p) => p.message) })); });
  const allReady = players.length > 0 && players.every((c) => creation[c.id]?.status === 'ready');

  return (
    <section aria-label="Session zero" data-testid="session-zero">
      <h3>Session zero <span className="badge" data-testid="phase">{phase === 'playing' ? 'play has begun' : 'session zero'}</span></h3>
      <StepForm testId="world-fact" title="The world fact for the whole table" label={fact ? 'Replace it' : 'Add to the Canon'} run={run} busy={busy}
        fields={[{ key: 'text', label: fact ? `Now: ${fact.text}` : 'One thing that is true of this world', placeholder: 'The Border War ended in a treaty nobody trusts.' }]}
        submit={(v) => step('world-fact', { text: v.text })} />
      {phase !== 'playing' && (
        <p>
          <button type="button" data-testid="begin-play" disabled={busy || !allReady} onClick={() => run(() => step('begin'))}>Begin play</button>
          {!allReady && <span className="muted"> every character must be ready first</span>}
        </p>
      )}
      <h3>Characters</h3>
      {players.length === 0 && <p className="muted">No players yet. Invite them from “At the table” below.</p>}
      {players.map((c) => {
        const st = creation[c.id];
        return (
          <div key={c.id} className="card" data-testid="zero-character" data-character={c.id}>
            <strong>{c.name}</strong> <span className="badge" data-testid="zero-status">{st?.status === 'ready' ? 'ready' : 'creating'}</span>
            {st?.status === 'creating' && (
              <>
                <button type="button" className="linklike" data-testid="zero-why" onClick={() => why(c.id)}> what is missing?</button>
                {missing[c.id] && <ul>{missing[c.id]!.map((m) => <li key={m}>{m}</li>)}</ul>}
                <StepForm testId={`override-${c.id}`} title="Let them play anyway (logged)" label="Override the check" run={run} busy={busy}
                  fields={[{ key: 'reason', label: 'Why' }]} submit={(v) => step('override', { characterId: c.id, reason: v.reason })} />
              </>
            )}
            {(st?.chapters ?? []).flatMap((ch) => (['skill', 'trait'] as const).map((part) => ({ ch, part }))).filter(({ ch, part }) => !ch[part].applied && ch[part].proposals.length > 0).map(({ ch, part }) => {
              const slot = ch[part];
              const tied = slotState(slot as never, Math.max(players.length - 1, 1)) === 'tied';
              return (
                <div key={`${ch.index}-${part}`} data-testid="gm-grant" data-tied={tied}>
                  <em>Chapter {ch.index + 1} {part}{tied ? ' — tied' : ''}</em>
                  {slot.proposals.map((p) => {
                    const q = p as unknown as { id: string; skill?: string; trait?: string; accepts: string[] };
                    return (
                      <div key={q.id} className="row"><span>{q.skill ?? q.trait} ({q.accepts.length} agree)</span>
                        <button type="button" data-testid="gm-choose" disabled={busy} onClick={() => run(() => step('gm-resolve', { characterId: c.id, chapter: ch.index, part, proposalId: q.id }))}>Choose this</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
      {overrides.length > 0 && (
        <>
          <h3>Overrides</h3>
          <ul data-testid="override-log">{overrides.map((o, i) => <li key={i}>{characters[o.characterId]?.name ?? o.characterId}: {o.reason}</li>)}</ul>
        </>
      )}
    </section>
  );
}
