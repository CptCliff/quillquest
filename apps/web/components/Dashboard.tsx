'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AccountApi, ApiClient, ApiFailure, type CampaignSummary, type Profile } from '../lib/game-api';
import { useSession } from '../lib/session';

/** Your profile (display name and ink) and your campaigns. */
export function Dashboard() {
  const session = useSession();
  const accounts = useMemo(() => new AccountApi(new ApiClient(session.getToken)), [session.getToken]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1d4ed8');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const fail = (e: unknown) => setNote(e instanceof ApiFailure ? e.message : 'Something went wrong');

  const load = () => accounts.me().then((m) => {
    setProfile(m.profile); setCampaigns(m.campaigns); setName(m.profile.displayName); if (m.profile.preferredColor) setColor(m.profile.preferredColor);
  }, fail);
  useEffect(() => { load(); }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="home" data-testid="dashboard">
      <header className="row"><h1>Quillquest</h1><button onClick={() => session.signOut()} data-testid="sign-out">Sign out</button></header>
      {note && <p role="alert" className="notice" data-testid="dash-notice">{note}</p>}

      <section aria-label="Your profile">
        <h2>You</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); accounts.saveProfile(name, color).then(() => { setNote(null); load(); }, fail); }}>
          <label className="field"><span>Display name</span><input data-testid="profile-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Your ink (used when you join a table; nudged if someone has it)</span><input data-testid="profile-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          <button type="submit" data-testid="profile-save">Save</button>
        </form>
        {profile && <p className="muted">Signed in as {profile.displayName}.</p>}
      </section>

      <section aria-label="Your campaigns">
        <h2>Campaigns</h2>
        {campaigns.length === 0 && <p className="muted">You are not in any campaign yet. Create one, or open an invite link from your GM.</p>}
        <ul className="campaigns">
          {campaigns.map((c) => (
            <li key={c.id} data-testid="campaign">
              <span className="dot" style={{ background: c.color }} />
              <Link href={`/story/${c.id}`}>{c.title}</Link> <span className="badge">{c.role === 'gm' ? 'GM' : c.left ? 'left' : 'player'}</span>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={(e) => { e.preventDefault(); accounts.createCampaign(title).then((r) => { setTitle(''); window.location.assign(`/story/${r.campaign.id}`); }, fail); }}>
          <label className="field"><span>New campaign</span><input data-testid="campaign-title" value={title} maxLength={80} placeholder="The Border War" onChange={(e) => setTitle(e.target.value)} /></label>
          <button type="submit" data-testid="campaign-create" disabled={!title.trim()}>Create (you will be the GM)</button>
        </form>
      </section>
    </main>
  );
}
