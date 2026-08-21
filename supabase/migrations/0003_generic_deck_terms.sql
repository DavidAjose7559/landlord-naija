-- 0003_generic_deck_terms.sql
--
-- Same idempotency contract as 0001/0002. The engine's Deck type moved from
-- naija-specific flavour names ("owambe"/"village") to generic terms
-- ("treasure"/"surprise") as part of making the board pluggable across
-- multiple maps — every map has its own flavour label for these two deck
-- slots (naija's happen to be "Owambe"/"Village People"), but the engine
-- and the JSON stored in game_secrets.deck_state only ever deal in the
-- generic names. start_game is the only place those names were baked into
-- SQL (as JSON keys), so it's the only function this migration touches.

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
    updated_at = now()
  where id = p_game_id;

  update game_secrets set
    deck_state = jsonb_build_object('treasure', p_treasure_deck, 'surprise', p_surprise_deck)
  where game_id = p_game_id;
end;
$$;

revoke all on function start_game from public;
grant execute on function start_game to service_role;
