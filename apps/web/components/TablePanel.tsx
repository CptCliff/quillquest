'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, type AccountApi, type InviteInfo, type MemberInfo } from '../lib/game-api';

/** The GM's table: who is here, and invite links (design plan 9.1). A token is shown once, when it is made. */
export function TablePanel({ accounts, campaign, onNotice }: { accounts: AccountApi; campaign: string; onNotice: (m: string) => void }) {
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [fresh, setFresh] = useState<{ id: string; link: string } | null>(null);
  const fail = (e: unknown) => onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong');
  const load = useCallback(() => Promise.all([accounts.members(campaign), accounts.invites(campaign)]).then(([m, i]) => { setMembers(m.members); setInvites(i.invites); }, fail), [accounts, campaign]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  return (
    <section aria-label="Table" data-testid="table-panel">
      <h3>At the table</h3>
      <ul className="members" data-testid="members">
        {members.map((m) => (
          <li key={m.userId} data-testid="member"><span className="dot" style={{ background: m.color }} /> {m.displayName} <span className="badge">{m.role === 'gm' ? 'GM' : m.left ? 'left' : 'player'}</span></li>
        ))}
      </ul>
      <h3>Invite a player</h3>
      <p className="muted">Each link works once and expires in a week. Send it however you like.</p>
      <button type="button" data-testid="invite-create" onClick={() => accounts.createInvite(campaign).then((r) => { setFresh({ id: r.invite.id, link: `${window.location.origin}/join/${r.invite.token}` }); load(); }, fail)}>Create invite link</button>
      {fresh && (
        <div className="row" data-testid="invite-fresh">
          <input readOnly aria-label="Invite link" data-testid="invite-link" value={fresh.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => navigator.clipboard?.writeText(fresh.link).catch(() => undefined)}>Copy</button>
        </div>
      )}
      <ul className="invites" data-testid="invites">
        {invites.map((i) => (
          <li key={i.id} data-testid="invite" data-status={i.status}>
            <span>Invite {i.id.slice(0, 4)}…</span> <span className="badge">{i.status}</span>
            {i.status === 'open' && <button type="button" data-testid="invite-revoke" onClick={() => accounts.revokeInvite(campaign, i.id).then(load, fail)}>Revoke</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
