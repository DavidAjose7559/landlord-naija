-- 0009_messages.sql
--
-- Same idempotency contract as 0001-0008. In-game chat: a standalone
-- append-only-in-practice table (no update/delete trigger is added here —
-- unlike rolls/events, nothing depends on messages being tamper-evident,
-- so this stays simple), read via the same "anon SELECT + realtime
-- subscription" pattern as events/trades. All writes go through
-- POST /api/games/[code]/chat using the service role via post_message,
-- authenticated by client_token exactly like every other action —
-- deliberately NOT part of GameAction/the engine, since chat never
-- touches games.state or the events log.

create table if not exists messages (
  id bigserial primary key
);

alter table messages add column if not exists game_id uuid not null references games(id) on delete cascade;
-- ON DELETE SET NULL (not CASCADE): a message survives the player who
-- sent it leaving — same reasoning as bug_reports.reporter_player_id.
alter table messages add column if not exists player_id uuid references players(id) on delete set null;
alter table messages add column if not exists body text not null;
alter table messages add column if not exists created_at timestamptz default now();

create index if not exists idx_messages_game_id on messages(game_id);

alter table messages enable row level security;

drop policy if exists "anon can read messages" on messages;
create policy "anon can read messages" on messages
  for select
  to anon
  using (true);

-- Deliberately no anon write policy — see the module comment above.
create or replace function post_message(
  p_game_id uuid,
  p_player_id uuid,
  p_body text
) returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into messages (game_id, player_id, body)
  values (p_game_id, p_player_id, p_body)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function post_message from public;
grant execute on function post_message to service_role;

alter table messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
