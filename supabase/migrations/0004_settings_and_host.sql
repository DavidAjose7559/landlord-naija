-- 0004_settings_and_host.sql
--
-- Same idempotency contract as 0001-0003. Adds the two columns Section B
-- (host-configured game settings) needs denormalized onto `games` itself,
-- alongside the existing status/turn_phase/roll_index/etc columns —
-- settings for future query/filter use (e.g. a "public rooms" listing
-- filtering on privateRoom without parsing state jsonb), host_player_id so
-- RLS/ownership checks never have to reach into jsonb either.
--
-- `state.settings` / `state.hostPlayerId` (inside the jsonb blob) stay the
-- single source of truth the engine reads and writes; these columns are
-- mirrors, kept in sync the same way turn_phase/current_player_index/etc
-- already are — derived from p_state/p_new_state inside each RPC rather
-- than threaded through as separate parameters.

alter table games add column if not exists settings jsonb not null default '{}'::jsonb;
alter table games add column if not exists host_player_id uuid references players(id) on delete set null;

-- CREATE OR REPLACE VIEW requires every existing column to keep its exact
-- name and ordinal position — Postgres reads an insertion in the middle of
-- the column list as a rename of whatever was pushed into that slot (here,
-- state -> settings), which it refuses. New columns have to go at the end.
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
  g.updated_at,
  g.settings,
  g.host_player_id
from games g
left join game_secrets gs on gs.game_id = g.id;

grant select on games_public to anon;

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
  insert into games (id, room_code, server_seed_hash, state, settings)
  values (p_id, p_room_code, p_server_seed_hash, p_state, p_state->'settings');

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

  update games set
    state = p_new_state,
    host_player_id = (p_new_state->>'hostPlayerId')::uuid,
    updated_at = now()
  where id = p_game_id;
end;
$$;

create or replace function start_game(
  p_game_id uuid,
  p_new_state jsonb,
  p_treasure_deck jsonb,
  p_surprise_deck jsonb
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
    settings = p_new_state->'settings',
    host_player_id = (p_new_state->>'hostPlayerId')::uuid,
    updated_at = now()
  where id = p_game_id;

  update game_secrets set
    deck_state = jsonb_build_object('treasure', p_treasure_deck, 'surprise', p_surprise_deck)
  where game_id = p_game_id;
end;
$$;

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
    settings = p_new_state->'settings',
    host_player_id = (p_new_state->>'hostPlayerId')::uuid,
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

-- Lobby-only settings patch (UPDATE_SETTINGS), separate from
-- apply_game_action because that RPC's optimistic-concurrency guard and
-- player/roll/event bookkeeping are all in-game concepts that don't apply
-- before a game has started. The `status = 'lobby'` guard is
-- defense-in-depth alongside engine.ts's own check — settings are frozen
-- the instant status leaves 'lobby'.
create or replace function update_settings(
  p_game_id uuid,
  p_new_state jsonb
) returns void
language plpgsql
as $$
begin
  update games set
    state = p_new_state,
    settings = p_new_state->'settings',
    updated_at = now()
  where id = p_game_id and status = 'lobby';
end;
$$;

-- A player leaving the lobby before the game starts (see host promotion:
-- "the lowest seat_index remaining player becomes host" — computed
-- app-side into p_new_state.hostPlayerId, this just persists it).
create or replace function leave_lobby(
  p_game_id uuid,
  p_player_id uuid,
  p_new_state jsonb
) returns void
language plpgsql
as $$
begin
  delete from players where id = p_player_id and game_id = p_game_id;
  delete from player_secrets where player_id = p_player_id;

  update games set
    state = p_new_state,
    host_player_id = (p_new_state->>'hostPlayerId')::uuid,
    updated_at = now()
  where id = p_game_id and status = 'lobby';
end;
$$;

revoke all on function create_game from public;
revoke all on function join_game from public;
revoke all on function start_game from public;
revoke all on function apply_game_action from public;
revoke all on function update_settings from public;
revoke all on function leave_lobby from public;
grant execute on function create_game to service_role;
grant execute on function join_game to service_role;
grant execute on function start_game to service_role;
grant execute on function apply_game_action to service_role;
grant execute on function update_settings to service_role;
grant execute on function leave_lobby to service_role;
