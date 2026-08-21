-- 0002_game_secrets_and_rpcs.sql
--
-- Same idempotency contract as 0001: safe to re-run, never drops or
-- rewrites a table. New here: dropping games.server_seed (guarded, dynamic
-- SQL, only if it's still there) after backfilling it into game_secrets —
-- a column drop, not a table drop, exactly like players.client_token in
-- 0001.
--
-- Why this migration exists, beyond just supporting the API layer:
--
-- 1. games had RLS enabled with NO anon policy (server_seed lived there,
--    so a blanket policy would have leaked it). That also silently broke
--    realtime for anon: Supabase Realtime's postgres_changes authorizes
--    against the SOURCE TABLE's RLS for the subscribing role — it can't
--    subscribe through a view — so with zero policies on games, anon
--    subscriptions to it received nothing despite 0001 adding it to the
--    publication. Moving server_seed off games (into this new
--    service-role-only table) lets games get the same blanket anon
--    SELECT policy players/rolls/events already have, which fixes that.
--
-- 2. The API layer's DRAW_CARD flow needs somewhere to persist shuffled
--    deck order between draws. That's exactly as sensitive as
--    server_seed — broadcasting it would let every client see all future
--    card draws — so it lives in this same locked-down table
--    (deck_state), never in games.state, never in the realtime
--    publication.

-- ============================================================================
-- game_secrets
-- ============================================================================

create table if not exists game_secrets (
  game_id uuid primary key references games(id) on delete cascade
);

alter table game_secrets add column if not exists server_seed text;
alter table game_secrets add column if not exists deck_state jsonb;

comment on table game_secrets is
  'Server-only game data: the provably-fair seed and shuffled card-deck order. No RLS policies on purpose — only the service role may read or write it. Never added to the realtime publication.';

alter table game_secrets enable row level security;
-- Deliberately no policies — service role only.

-- Backfill any games.server_seed values still there (from 0001 having
-- already run), then drop that column. Guarded exactly like the
-- players.client_token migration in 0001.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'games' and column_name = 'server_seed'
  ) then
    execute '
      insert into game_secrets (game_id, server_seed)
      select id, server_seed from games
      where server_seed is not null
      on conflict (game_id) do update set server_seed = excluded.server_seed
    ';
    execute 'alter table games drop column server_seed';
  end if;
end $$;

-- ============================================================================
-- games can now carry a normal anon read policy: nothing secret is left
-- on it. This also fixes the realtime gap described above.
-- ============================================================================

drop policy if exists "anon can read games" on games;
create policy "anon can read games" on games
  for select
  to anon
  using (true);

-- ============================================================================
-- games_public: recomputed against the new shape. server_seed now comes
-- from game_secrets via a left join, still masked until the game finishes.
-- Client code should keep reading this view (or the games realtime
-- channel, now that it works) rather than joining game_secrets directly —
-- that join only resolves through this view because it's evaluated with
-- the view owner's privileges against a table anon has no policies on.
-- ============================================================================

create or replace view games_public
  with (security_barrier = true)
as
select
  g.id,
  g.room_code,
  g.status,
  g.server_seed_hash,
  case when g.status = 'finished' then gs.server_seed else null end as server_seed,
  g.roll_index,
  g.current_player_index,
  g.turn_phase,
  g.doubles_count,
  g.state,
  g.created_at,
  g.updated_at
from games g
left join game_secrets gs on gs.game_id = g.id;

grant select on games_public to anon;

-- ============================================================================
-- RPC functions. Every write the API layer makes that touches more than
-- one row/table goes through one of these, so it's a single atomic
-- Postgres transaction rather than several separate supabase-js calls.
-- None of these are reachable by anon/authenticated — only service_role,
-- which is what every API route uses. This is enforced twice: PostgREST
-- only exposes what a role has EXECUTE on, and the revoke/grant below is
-- that enforcement.
-- ============================================================================

create or replace function create_game(
  p_id uuid,
  p_room_code text,
  p_server_seed_hash text,
  p_state jsonb,
  p_server_seed text
) returns void
language plpgsql
as $$
begin
  insert into games (id, room_code, server_seed_hash, state)
  values (p_id, p_room_code, p_server_seed_hash, p_state);

  insert into game_secrets (game_id, server_seed)
  values (p_id, p_server_seed);
end;
$$;

create or replace function join_game(
  p_game_id uuid,
  p_player_id uuid,
  p_name text,
  p_token text,
  p_seat_index int,
  p_cash_cents bigint,
  p_client_token text,
  p_new_state jsonb
) returns void
language plpgsql
as $$
begin
  insert into players (id, game_id, name, token, seat_index, cash_cents, position, in_jail, jail_turns, jail_free_cards, bankrupt)
  values (p_player_id, p_game_id, p_name, p_token, p_seat_index, p_cash_cents, 0, false, 0, 0, false);

  insert into player_secrets (player_id, client_token)
  values (p_player_id, p_client_token);

  update games set state = p_new_state, updated_at = now() where id = p_game_id;
end;
$$;

create or replace function start_game(
  p_game_id uuid,
  p_new_state jsonb,
  p_owambe_deck jsonb,
  p_village_deck jsonb
) returns void
language plpgsql
as $$
begin
  update games set
    state = p_new_state,
    status = 'active',
    turn_phase = 'awaiting_roll',
    current_player_index = 0,
    doubles_count = 0,
    updated_at = now()
  where id = p_game_id;

  update game_secrets set
    deck_state = jsonb_build_object('owambe', p_owambe_deck, 'village', p_village_deck)
  where game_id = p_game_id;
end;
$$;

-- The one mutation endpoint's write path. p_expected_roll_index is an
-- optimistic-concurrency guard: if games.roll_index has moved on since the
-- caller read it (a racing request already applied), this raises and the
-- whole call — and everything it would have written — rolls back.
create or replace function apply_game_action(
  p_game_id uuid,
  p_expected_roll_index int,
  p_new_state jsonb,
  p_new_status text,
  p_new_roll_index int,
  p_new_current_player_index int,
  p_new_turn_phase text,
  p_new_doubles_count int,
  p_player_updates jsonb,
  p_events jsonb,
  p_roll jsonb default null,
  p_deck_state jsonb default null
) returns void
language plpgsql
as $$
declare
  v_seq int;
  v_event jsonb;
  v_player jsonb;
begin
  perform 1 from games where id = p_game_id and roll_index = p_expected_roll_index for update;
  if not found then
    raise exception 'stale game state: roll_index has changed since it was read';
  end if;

  update games set
    state = p_new_state,
    status = p_new_status,
    roll_index = p_new_roll_index,
    current_player_index = p_new_current_player_index,
    turn_phase = p_new_turn_phase,
    doubles_count = p_new_doubles_count,
    updated_at = now()
  where id = p_game_id;

  for v_player in select * from jsonb_array_elements(p_player_updates)
  loop
    update players set
      cash_cents = (v_player->>'cash_cents')::bigint,
      position = (v_player->>'position')::int,
      in_jail = (v_player->>'in_jail')::boolean,
      jail_turns = (v_player->>'jail_turns')::int,
      jail_free_cards = (v_player->>'jail_free_cards')::int,
      bankrupt = (v_player->>'bankrupt')::boolean
    where id = (v_player->>'id')::uuid and game_id = p_game_id;
  end loop;

  if p_roll is not null then
    insert into rolls (game_id, roll_index, player_id, die_1, die_2, prev_hash, hash)
    values (
      p_game_id,
      (p_roll->>'roll_index')::int,
      (p_roll->>'player_id')::uuid,
      (p_roll->>'die_1')::smallint,
      (p_roll->>'die_2')::smallint,
      p_roll->>'prev_hash',
      p_roll->>'hash'
    );
  end if;

  if p_deck_state is not null then
    update game_secrets set deck_state = p_deck_state where game_id = p_game_id;
  end if;

  select coalesce(max(seq), 0) into v_seq from events where game_id = p_game_id;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_seq := v_seq + 1;
    insert into events (game_id, seq, type, payload)
    values (p_game_id, v_seq, v_event->>'type', v_event->'payload');
  end loop;
end;
$$;

revoke all on function create_game from public;
revoke all on function join_game from public;
revoke all on function start_game from public;
revoke all on function apply_game_action from public;

grant execute on function create_game to service_role;
grant execute on function join_game to service_role;
grant execute on function start_game to service_role;
grant execute on function apply_game_action to service_role;
