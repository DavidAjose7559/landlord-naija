-- 0001_init.sql
--
-- Idempotency contract: this file is safe to re-run against a database that
-- already has some or all of this schema applied. It never drops or
-- rewrites an existing table.
--   - Tables are created with `create table if not exists` holding only the
--     primary key, then every other column is added with
--     `alter table ... add column if not exists`.
--   - Multi-column unique constraints can't use "if not exists", so they're
--     wrapped in a `do $$ ... $$` block that checks pg_constraint first.
--   - Policies/triggers can't use "if not exists" either; they're recreated
--     with `drop ... if exists` + `create` (this drops the policy/trigger
--     object, never the table or its data).
--   - Views use `create or replace view` (again: not a table).
--   - Extensions/indexes/enabling RLS/publication membership are guarded
--     the same way, each with whatever "if not exists" equivalent Postgres
--     offers for that object type.
--   - The one exception is `players.client_token`: it's dropped (guarded,
--     via dynamic SQL) after being backfilled into player_secrets. That's a
--     column drop, not a table drop, and only fires if the column is still
--     there from a previous run of an earlier version of this file.

create extension if not exists pgcrypto;

-- ============================================================================
-- games
-- ============================================================================

create table if not exists games (
  id uuid primary key default gen_random_uuid()
);

alter table games add column if not exists room_code text unique not null
  check (room_code ~ '^[A-Z0-9]{6}$');
alter table games add column if not exists status text not null default 'lobby'
  check (status in ('lobby', 'active', 'finished'));
-- Never select this column directly for anon; see games_public below.
alter table games add column if not exists server_seed text;
alter table games add column if not exists server_seed_hash text not null;
alter table games add column if not exists roll_index int not null default 0;
alter table games add column if not exists current_player_index int not null default 0;
alter table games add column if not exists turn_phase text not null default 'awaiting_roll';
alter table games add column if not exists doubles_count int not null default 0;
alter table games add column if not exists state jsonb not null;
alter table games add column if not exists created_at timestamptz default now();
alter table games add column if not exists updated_at timestamptz default now();

comment on column games.server_seed is
  'Provably-fair RNG seed. Must never be exposed to clients while status != finished. Use games_public.';

-- ============================================================================
-- players
-- ============================================================================

create table if not exists players (
  id uuid primary key
);

alter table players add column if not exists game_id uuid not null references games(id) on delete cascade;
alter table players add column if not exists name text not null;
alter table players add column if not exists token text not null
  check (token in ('danfo', 'keke', 'jollof', 'gele', 'okada', 'agbada', 'suya', 'bottle'));
alter table players add column if not exists seat_index int not null;
alter table players add column if not exists cash_cents bigint not null;
alter table players add column if not exists position int not null default 0;
alter table players add column if not exists in_jail boolean not null default false;
alter table players add column if not exists jail_turns int not null default 0;
alter table players add column if not exists jail_free_cards int not null default 0;
alter table players add column if not exists bankrupt boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'players_game_id_seat_index_key'
      and conrelid = 'public.players'::regclass
  ) then
    alter table players
      add constraint players_game_id_seat_index_key unique (game_id, seat_index);
  end if;
end $$;

-- ============================================================================
-- player_secrets
--
-- The reconnect secret lives here instead of on players, because RLS is
-- row-level, not column-level: players has a blanket anon read policy
-- (below), and there's no way to carve client_token out of that with a
-- policy alone. This table gets no policies at all — only the service role
-- (which bypasses RLS) may read or write it — and it is never added to the
-- realtime publication.
-- ============================================================================

create table if not exists player_secrets (
  player_id uuid primary key references players(id) on delete cascade
);

alter table player_secrets add column if not exists client_token text not null unique;
alter table player_secrets add column if not exists created_at timestamptz default now();

comment on table player_secrets is
  'Reconnect secrets. Deliberately has no RLS policies — only the service role may read or write it.';

-- Backfill any client_token values still on players (from an earlier
-- version of this migration having already run), then drop that column.
-- The dynamic SQL means this whole block is a no-op once the column is
-- gone, so re-running this file stays safe either way.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'client_token'
  ) then
    execute '
      insert into player_secrets (player_id, client_token)
      select id, client_token from players
      where client_token is not null
      on conflict (player_id) do nothing
    ';
    execute 'alter table players drop column client_token';
  end if;
end $$;

-- ============================================================================
-- rolls (append-only fairness ledger — never UPDATE, never DELETE)
-- ============================================================================

create table if not exists rolls (
  id bigserial primary key
);

alter table rolls add column if not exists game_id uuid not null references games(id) on delete cascade;
alter table rolls add column if not exists roll_index int not null;
alter table rolls add column if not exists player_id uuid not null references players(id);
alter table rolls add column if not exists die_1 smallint not null check (die_1 between 1 and 6);
alter table rolls add column if not exists die_2 smallint not null check (die_2 between 1 and 6);
alter table rolls add column if not exists prev_hash text not null;
alter table rolls add column if not exists hash text not null;
alter table rolls add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rolls_game_id_roll_index_key'
      and conrelid = 'public.rolls'::regclass
  ) then
    alter table rolls
      add constraint rolls_game_id_roll_index_key unique (game_id, roll_index);
  end if;
end $$;

comment on table rolls is 'Append-only fairness ledger. Application code must never UPDATE or DELETE rows; enforced below by trigger.';

-- ============================================================================
-- events (append-only game log for the activity feed)
-- ============================================================================

create table if not exists events (
  id bigserial primary key
);

alter table events add column if not exists game_id uuid not null references games(id) on delete cascade;
alter table events add column if not exists seq int not null;
alter table events add column if not exists type text not null;
alter table events add column if not exists payload jsonb not null;
alter table events add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_game_id_seq_key'
      and conrelid = 'public.events'::regclass
  ) then
    alter table events
      add constraint events_game_id_seq_key unique (game_id, seq);
  end if;
end $$;

comment on table events is 'Append-only game log. Application code must never UPDATE or DELETE rows; enforced below by trigger.';

-- ============================================================================
-- indexes (foreign keys are not auto-indexed in Postgres)
-- ============================================================================

create index if not exists idx_players_game_id on players(game_id);
create index if not exists idx_rolls_game_id on rolls(game_id);
create index if not exists idx_rolls_player_id on rolls(player_id);
create index if not exists idx_events_game_id on events(game_id);

-- ============================================================================
-- append-only enforcement for rolls / events
-- ============================================================================

create or replace function reject_update_delete() returns trigger as $$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$ language plpgsql;

drop trigger if exists rolls_no_update on rolls;
create trigger rolls_no_update
  before update on rolls
  for each row execute function reject_update_delete();

drop trigger if exists rolls_no_delete on rolls;
create trigger rolls_no_delete
  before delete on rolls
  for each row execute function reject_update_delete();

drop trigger if exists events_no_update on events;
create trigger events_no_update
  before update on events
  for each row execute function reject_update_delete();

drop trigger if exists events_no_delete on events;
create trigger events_no_delete
  before delete on events
  for each row execute function reject_update_delete();

-- ============================================================================
-- row level security
--
-- No anon write policies anywhere, on any table: all writes go through the
-- server using the service role key, which bypasses RLS entirely.
-- ============================================================================

alter table games enable row level security;
alter table players enable row level security;
alter table rolls enable row level security;
alter table events enable row level security;
alter table player_secrets enable row level security;

-- Deliberately NO anon select policy on games itself: it holds server_seed.
-- Anon reads go through the games_public view instead (below), which masks
-- server_seed until the game is finished.

-- Deliberately NO policies at all on player_secrets — see its table
-- comment above. Only the service role may touch it.

drop policy if exists "anon can read players" on players;
create policy "anon can read players" on players
  for select
  to anon
  using (true);

drop policy if exists "anon can read rolls" on rolls;
create policy "anon can read rolls" on rolls
  for select
  to anon
  using (true);

drop policy if exists "anon can read events" on events;
create policy "anon can read events" on events
  for select
  to anon
  using (true);

-- ============================================================================
-- games_public: everything on games except server_seed, which is only
-- included once the game has finished. security_barrier stops the query
-- planner from optimizing predicates in a way that could leak the masked
-- column ahead of the CASE expression.
-- ============================================================================

create or replace view games_public
  with (security_barrier = true)
as
select
  id,
  room_code,
  status,
  server_seed_hash,
  case when status = 'finished' then server_seed else null end as server_seed,
  roll_index,
  current_player_index,
  turn_phase,
  doubles_count,
  state,
  created_at,
  updated_at
from games;

grant select on games_public to anon;

-- ============================================================================
-- realtime replication
-- ============================================================================

alter table games replica identity full;
alter table players replica identity full;
alter table events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;
