-- 0010_bug_report_attachments.sql
--
-- Same idempotency contract as 0001-0009. Adds screenshot storage for bug
-- reports: a private Supabase Storage bucket plus the column pointing at
-- an object in it. Breadcrumbs need no schema change at all — they're
-- just one more field inside bug_reports.snapshot (already jsonb).

alter table bug_reports add column if not exists screenshot_path text;

comment on column bug_reports.screenshot_path is
  'Object path in the private bug-screenshots bucket, or null if the reporter had none/it failed to upload. Never a public URL — the /bugs review page reads it via a server-generated signed URL.';

-- Private bucket: no anon access, read or write. POST /api/bugs uploads
-- with the service role (which bypasses storage RLS entirely, same as
-- every other write path in this app); GET /bugs generates a short-lived
-- signed URL server-side to display it. public = false is what keeps a
-- guessed/leaked object path from being fetchable directly.
insert into storage.buckets (id, name, public)
values ('bug-screenshots', 'bug-screenshots', false)
on conflict (id) do nothing;

-- Deliberately no storage.objects RLS policies for this bucket — same
-- treatment as bug_reports itself (see 0008's comment): the service role
-- bypasses RLS, and there is no legitimate anon read or write path.

-- create_bug_report gains a trailing p_screenshot_path parameter. Adding a
-- parameter changes the function's signature, so CREATE OR REPLACE alone
-- would create a second overload instead of replacing the original —
-- drop every existing overload by name first, same guarded pattern 0004/
-- 0005 use for apply_game_action.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_bug_report'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create or replace function create_bug_report(
  p_id uuid,
  p_game_id uuid,
  p_reporter_player_id uuid,
  p_room_code text,
  p_severity text,
  p_description text,
  p_commit_sha text,
  p_snapshot jsonb,
  p_screenshot_path text default null
) returns void
language plpgsql
as $$
begin
  insert into bug_reports (id, game_id, reporter_player_id, room_code, severity, description, commit_sha, snapshot, screenshot_path)
  values (p_id, p_game_id, p_reporter_player_id, p_room_code, p_severity, p_description, p_commit_sha, p_snapshot, p_screenshot_path);
end;
$$;

revoke all on function create_bug_report from public;
grant execute on function create_bug_report to service_role;
