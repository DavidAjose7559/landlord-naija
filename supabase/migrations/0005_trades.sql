-- 0005_trades.sql
--
-- Same idempotency contract as 0001-0004. Section D (trading): moves trade
-- negotiation out of games.state entirely and into its own table, so a
-- counter-offer thread (open -> superseded -> open -> ... -> accepted/
-- declined/cancelled) is real relational history instead of a single
-- flat array embedded in the jsonb blob. Only the moment a trade is
-- actually ACCEPTED still needs to touch games.state (cash/ownership
-- changing hands) — see apply_game_action's new p_accepted_trade_id below,
-- which updates both in one transaction.

create table if not exists trades (
  id uuid primary key default gen_random_uuid()
);

alter table trades add column if not exists game_id uuid not null references games(id) on delete cascade;
alter table trades add column if not exists status text not null default 'open'
  check (status in ('open', 'accepted', 'declined', 'cancelled', 'superseded'));
alter table trades add column if not exists from_player_id uuid not null references players(id) on delete cascade;
alter table trades add column if not exists to_player_id uuid not null references players(id) on delete cascade;
alter table trades add column if not exists offer jsonb not null;
alter table trades add column if not exists request jsonb not null;
alter table trades add column if not exists parent_trade_id uuid references trades(id) on delete set null;
alter table trades add column if not exists round int not null default 1;
alter table trades add column if not exists created_at timestamptz default now();

create index if not exists idx_trades_game_id on trades(game_id);
create index if not exists idx_trades_open_pair on trades(game_id, from_player_id, to_player_id) where status = 'open';

alter table trades enable row level security;

drop policy if exists "anon can read trades" on trades;
create policy "anon can read trades" on trades
  for select to anon using (true);

grant select on trades to anon;

-- One open thread per pair max, in either direction — checked here
-- (not just app-side) since two proposals racing each other is exactly
-- what a unique constraint/lock is for.
create or replace function propose_trade(
  p_id uuid,
  p_game_id uuid,
  p_from_player_id uuid,
  p_to_player_id uuid,
  p_offer jsonb,
  p_request jsonb
) returns void
language plpgsql
as $$
begin
  perform 1 from trades
  where game_id = p_game_id
    and status = 'open'
    and ((from_player_id = p_from_player_id and to_player_id = p_to_player_id)
      or (from_player_id = p_to_player_id and to_player_id = p_from_player_id))
  for update;
  if found then
    raise exception 'an open trade already exists between these two players';
  end if;

  insert into trades (id, game_id, from_player_id, to_player_id, offer, request, status, round)
  values (p_id, p_game_id, p_from_player_id, p_to_player_id, p_offer, p_request, 'open', 1);
end;
$$;

-- Marks the parent superseded and opens a new round with from/to swapped
-- (the spec's "either side can COUNTER"). p_round is computed app-side as
-- parent.round + 1 and re-checked here against the 10-round cap.
create or replace function counter_trade(
  p_id uuid,
  p_parent_trade_id uuid,
  p_game_id uuid,
  p_from_player_id uuid,
  p_to_player_id uuid,
  p_offer jsonb,
  p_request jsonb,
  p_round int
) returns void
language plpgsql
as $$
begin
  if p_round > 10 then
    raise exception 'this negotiation has gone on long enough';
  end if;

  update trades set status = 'superseded'
  where id = p_parent_trade_id and game_id = p_game_id and status = 'open';
  if not found then
    raise exception 'that offer is no longer open';
  end if;

  insert into trades (id, game_id, from_player_id, to_player_id, offer, request, status, parent_trade_id, round)
  values (p_id, p_game_id, p_from_player_id, p_to_player_id, p_offer, p_request, 'open', p_parent_trade_id, p_round);
end;
$$;

-- Decline or cancel — both just retire an open thread without starting a
-- new one. Only succeeds against a currently-open row.
create or replace function respond_trade(
  p_trade_id uuid,
  p_status text
) returns void
language plpgsql
as $$
begin
  if p_status not in ('declined', 'cancelled') then
    raise exception 'invalid trade status %', p_status;
  end if;

  update trades set status = p_status where id = p_trade_id and status = 'open';
  if not found then
    raise exception 'that offer is no longer open';
  end if;
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
  p_deck_state jsonb default null,
  p_accepted_trade_id uuid default null
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

  if p_accepted_trade_id is not null then
    update trades set status = 'accepted' where id = p_accepted_trade_id and game_id = p_game_id;
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

revoke all on function propose_trade from public;
revoke all on function counter_trade from public;
revoke all on function respond_trade from public;
revoke all on function apply_game_action from public;
grant execute on function propose_trade to service_role;
grant execute on function counter_trade to service_role;
grant execute on function respond_trade to service_role;
grant execute on function apply_game_action to service_role;
