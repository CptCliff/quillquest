export interface Migration { name: string; sql: string }

/**
 * Applied in order, once each. Row-level security is enabled on every table with NO policies: a Supabase-style
 * `anon`/`authenticated` session (which Supabase grants table access to by default) can read and write nothing. The server
 * connects with a privileged role, which bypasses row security.
 */
export const MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    sql: `
      create table profiles (
        user_id text primary key,
        display_name text not null check (char_length(display_name) between 1 and 40),
        preferred_color text check (preferred_color ~ '^#[0-9a-f]{6}$'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table campaigns (
        id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
        title text not null check (char_length(title) between 1 and 80),
        gm_user_id text not null references profiles (user_id),
        created_at timestamptz not null default now()
      );

      create table memberships (
        campaign_id text not null references campaigns (id) on delete cascade,
        user_id text not null references profiles (user_id),
        role text not null check (role in ('gm', 'player')),
        color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
        joined_at timestamptz not null default now(),
        left_at timestamptz,
        primary key (campaign_id, user_id)
      );
      -- One GM per campaign, and no two active members share an ink color.
      create unique index memberships_one_gm on memberships (campaign_id) where role = 'gm';
      create unique index memberships_unique_color on memberships (campaign_id, lower(color)) where left_at is null;

      create table invites (
        id text primary key,
        campaign_id text not null references campaigns (id) on delete cascade,
        token_hash text not null unique,
        created_by text not null references profiles (user_id),
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        revoked_at timestamptz,
        accepted_by text references profiles (user_id),
        accepted_at timestamptz
      );

      create table game_state (
        campaign_id text primary key references campaigns (id) on delete cascade,
        state jsonb not null,
        updated_at timestamptz not null default now()
      );
      create table documents (
        campaign_id text primary key references campaigns (id) on delete cascade,
        state bytea not null,
        updated_at timestamptz not null default now()
      );

      alter table profiles enable row level security;
      alter table campaigns enable row level security;
      alter table memberships enable row level security;
      alter table invites enable row level security;
      alter table game_state enable row level security;
      alter table documents enable row level security;
    `,
  },
  {
    // A player's solo character draft (design plan 7.1): a private Yjs document, one per player per campaign.
    name: '0002_draft_documents',
    sql: `
      create table draft_documents (
        campaign_id text not null references campaigns (id) on delete cascade,
        user_id text not null references profiles (user_id),
        state bytea not null,
        updated_at timestamptz not null default now(),
        primary key (campaign_id, user_id)
      );
      alter table draft_documents enable row level security;
    `,
  },
  {
    // The GM's private notes document, and the log of every Claude answer (design plan 3.1, 8.3).
    name: '0003_director',
    sql: `
      create table gm_documents (
        campaign_id text primary key references campaigns (id) on delete cascade,
        state bytea not null,
        updated_at timestamptz not null default now()
      );
      create table suggestions (
        id text primary key,
        campaign_id text not null references campaigns (id) on delete cascade,
        user_id text not null references profiles (user_id),
        kind text not null check (kind in ('beliefChallenge', 'danger', 'npcLine', 'oracle', 'skillMatch', 'grant', 'beliefCheck')),
        input jsonb not null,
        output jsonb,
        status text not null default 'shown' check (status in ('shown', 'used', 'edited', 'dismissed', 'failed')),
        session_no integer not null,
        provider text not null,
        created_at timestamptz not null default now()
      );
      create index suggestions_campaign on suggestions (campaign_id, session_no, created_at);
      alter table gm_documents enable row level security;
      alter table suggestions enable row level security;
    `,
  },
];
