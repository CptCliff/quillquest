'use client';
import { useEffect, useState } from 'react';
import { ApiFailure, type GameApi } from '../lib/game-api';

/** How this person wants to hear that the story is waiting on them (design plan 10): immediately, a daily digest, or not at all. */
export function NotifyPrefs({ game, onNotice }: { game: GameApi; onNotice: (m: string) => void }) {
  const [state, setState] = useState<{ mode: 'immediate' | 'digest' | 'off'; hasEmail: boolean } | null | 'off-server'>(null);
  useEffect(() => { game.prefs().then(setState, (e) => setState(e instanceof ApiFailure && e.status === 501 ? 'off-server' : null)); }, [game]);
  if (state === null || state === 'off-server') return null;
  return (
    <section aria-label="Notifications" data-testid="notify-prefs">
      <h3>Email me when the story is waiting on me</h3>
      <select aria-label="How often" data-testid="notify-mode" value={state.mode} onChange={(e) => game.savePrefs(e.target.value as typeof state.mode).then(() => setState({ ...state, mode: e.target.value as typeof state.mode }), (x) => onNotice(x instanceof ApiFailure ? x.message : 'Something went wrong'))}>
        <option value="immediate">Soon (batched, after two minutes)</option>
        <option value="digest">A daily digest</option>
        <option value="off">Never</option>
      </select>
      {!state.hasEmail && <p className="muted">There is no email address on your account, so nothing can be sent.</p>}
      <p className="muted">You are never emailed while you have this campaign open.</p>
    </section>
  );
}
