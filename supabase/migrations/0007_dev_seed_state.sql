-- 0007_dev_seed_state.sql
--
-- Same idempotency contract as 0001-0006. Adds one RPC, dev_seed_state,
-- used exclusively by the dev-only POST /api/dev/seed-state route
-- (src/app/api/dev/seed-state/route.ts) to set up a specific board state
-- directly for testing, instead of grinding out 60-160 rounds of real dice
-- hoping to land on it. That route already refuses to run at all unless
-- NODE_ENV !== "production" AND a DEV_HARNESS_SECRET matching the caller's
-- is configured — this function has no independent guard of its own
-- (Postgres functions can't read Vercel's env), so it's just as dangerous
-- as apply_game_action if called directly; access is restricted to
-- service_role exactly like every other RPC here, and the real gate is the
-- route in front of it never being reachable in production.
--
-- Deliberately skips apply_game_action's optimistic-concurrency check
-- (roll_index must match) — this isn't applying a real game action in
-- sequence, it's overwriting state out of band, so there's nothing to race
-- against. roll_index itself is left untouched: a seeded position is meant
-- to be followed by one real ROLL, which still needs the actual current
-- roll_index to compute the right dice from the seed.
--
-- p_confirm_active guards against exactly the mistake that matters most
-- here: a typo'd room code or a stale test script silently rewriting an
-- actual player's live game instead of the throwaway one it meant to hit.
-- A game with status <> 'active' (lobby, finished) is always seedable
-- with no flag — those are precisely the harness's own test fixtures and
-- can't be "someone's live game" in the sense this is protecting against.
-- Touching an active one requires the caller to pass true, which the API
-- route in front of this makes a required field rather than something
-- that defaults quietly to permissive.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dev_seed_state'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create or replace function dev_seed_state(
  p_game_id uuid,
  p_new_state jsonb,
  p_player_updates jsonb,
  p_confirm_active boolean default false
) returns void
language plpgsql
as $$
declare
  v_player jsonb;
  v_status text;
begin
  select status into v_status from games where id = p_game_id;

  if v_status = 'active' and not p_confirm_active then
    raise exception 'refusing to seed an active game (id=%) without p_confirm_active=true', p_game_id;
  end if;

  update games set
    state = p_new_state,
    current_player_index = (p_new_state->>'currentPlayerIndex')::int,
    turn_phase = p_new_state->>'turnPhase',
    doubles_count = (p_new_state->>'doublesCount')::int,
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
end;
$$;

revoke all on function dev_seed_state from public;
grant execute on function dev_seed_state to service_role;
