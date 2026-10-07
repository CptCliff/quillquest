'use client';
import { useState } from 'react';
import type { GameApi } from '../lib/game-api';
import { Term } from './Term';
import { useAct } from './Ledger';
import type { Me } from './StoryEditor';

export interface SpotlightState { holder: string | null; players: string[]; due: string | null }

/** The composer bar (design plan 5.1): whose turn it is. The holder (or the GM) passes it on; anyone left out for two rounds is named as due. */
export function SpotlightBar({ spotlight, me, names, game, onNotice }: { spotlight: SpotlightState | undefined; me: Me; names: Record<string, string>; game: GameApi; onNotice: (m: string) => void }) {
  const { busy, run } = useAct(onNotice);
  const [to, setTo] = useState('');
  if (!spotlight || (!spotlight.holder && !spotlight.players.length)) return null;
  const who = (id: string | null) => (id ? (id === me.id ? 'You' : (names[id] ?? id)) : 'No one');
  const candidates = spotlight.players.filter((p) => p !== spotlight.holder);
  const target = to && candidates.includes(to) ? to : (spotlight.due && candidates.includes(spotlight.due) ? spotlight.due : candidates[0] ?? '');
  const mayPass = !me.left && (me.role === 'gm' || spotlight.holder === me.id);
  return (
    <div className="spotlight" role="region" aria-label="Spotlight" data-testid="spotlight" data-mine={spotlight.holder === me.id}>
      <span><Term k="spotlight">Spotlight</Term>: <strong data-testid="spotlight-holder">{who(spotlight.holder)}</strong>{spotlight.holder === me.id ? ' — your turn to write' : ''}</span>
      {spotlight.due && spotlight.due !== spotlight.holder && <span className="badge" data-testid="spotlight-due">{who(spotlight.due)} due the next post</span>}
      {mayPass && candidates.length > 0 && (
        <span className="row">
          <select aria-label="Pass the spotlight to" data-testid="spotlight-pass-to" value={target} onChange={(e) => setTo(e.target.value)}>{candidates.map((p) => <option key={p} value={p}>{names[p] ?? p}</option>)}</select>
          <button type="button" data-testid="spotlight-pass" disabled={busy || !target} onClick={() => run(() => game.passSpotlight(target))}>Pass</button>
        </span>
      )}
      {me.role === 'gm' && spotlight.holder !== me.id && <button type="button" data-testid="spotlight-take" disabled={busy} onClick={() => run(() => game.takeSpotlight())}>Take it</button>}
    </div>
  );
}
