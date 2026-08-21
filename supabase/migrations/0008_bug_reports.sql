-- 0008_bug_reports.sql
--
-- Same idempotency contract as 0001-0007. Adds the in-game bug report
-- button's storage: a standalone table (not part of games.state — a bug
-- report must survive the game it describes, and must never be able to
-- mutate that game's state) plus two RPCs (create, toggle-resolved).
--
-- game_id uses ON DELETE SET NULL (not CASCADE) deliberately: this table
-- exists specifically so reports outlive the game they came from. Nothing
-- about submitting or reviewing a report ever touches the games/players/
-- events/rolls/trades tables — POST /api/bugs only reads them to build the
-- snapshot, then does one INSERT here.

create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid()
);

alter table bug_reports add column if not exists game_id uuid references games(id) on delete set null;
alter table bug_reports add column if not exists reporter_player_id uuid;
alter table bug_reports add column if not exists room_code text;
alter table bug_reports add column if not exists severity text not null default 'annoying'
  check (severity in ('ruins_game', 'annoying', 'cosmetic'));
alter table bug_reports add column if not exists description text not null;
alter table bug_reports add column if not exists commit_sha text;
alter table bug_reports add column if not exists snapshot jsonb not null;
alter table bug_reports add column if not exists resolved boolean not null default false;
alter table bug_reports add column if not exists created_at timestamptz default now();

create index if not exists idx_bug_reports_created_at on bug_reports(created_at desc);
create index if not exists idx_bug_reports_unresolved on bug_reports(created_at desc) where resolved = false;

comment on table bug_reports is
  'Player-submitted bug reports with a full auto-captured game snapshot. No RLS policies on purpose — only the service role (POST/GET /api/bugs, the /bugs review page, both gated by ADMIN_SECRET) may read or write it. Never added to the realtime publication.';

alter table bug_reports enable row level security;
-- Deliberately no policies at all — same treatment as player_secrets and
-- game_secrets. Anon gets nothing; every read and write goes through
-- server-side routes using the service role.

-- Read-only from the engine's perspective: everything this function does
-- is a single INSERT into a table no game logic ever reads from. It
-- cannot mutate games/players/events/rolls/trades even in principle.
create or replace function create_bug_report(
  p_id uuid,
  p_game_id uuid,
  p_reporter_player_id uuid,
  p_room_code text,
  p_severity text,
  p_description text,
  p_commit_sha text,
  p_snapshot jsonb
) returns void
language plpgsql
as $$
begin
  insert into bug_reports (id, game_id, reporter_player_id, room_code, severity, description, commit_sha, snapshot)
  values (p_id, p_game_id, p_reporter_player_id, p_room_code, p_severity, p_description, p_commit_sha, p_snapshot);
end;
$$;

create or replace function set_bug_report_resolved(
  p_id uuid,
  p_resolved boolean
) returns void
language plpgsql
as $$
begin
  update bug_reports set resolved = p_resolved where id = p_id;
end;
$$;

revoke all on function create_bug_report from public;
revoke all on function set_bug_report_resolved from public;
grant execute on function create_bug_report to service_role;
grant execute on function set_bug_report_resolved to service_role;
