-- OPTIONAL (Phase 2 backup trigger). Run in the Supabase SQL editor AFTER schema.sql.
-- The app already calls the `grade-recording` Edge Function right after each upload. This trigger
-- ALSO calls it from the database on every INSERT into public.recordings, so grading starts even if
-- the phone loses signal or the app is closed right after the upload finishes. The function's
-- atomic "claim" makes the double call harmless: only one of them does the work.
--
-- One-time setup (replace the secret with the same value you give the function as WEBHOOK_SECRET):
--   select vault.create_secret('https://bpndhidtxzgjxmrgffyp.supabase.co/functions/v1/grade-recording', 'grade_recording_url');
--   select vault.create_secret('PASTE-THE-WEBHOOK_SECRET-HERE', 'grade_recording_secret');
-- To turn it off: drop trigger if exists recordings_grade_on_insert on public.recordings;

create extension if not exists pg_net;

create or replace function public.recordings_grade_on_insert()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  fn_url text;
  fn_secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'grade_recording_url' limit 1;
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'grade_recording_secret' limit 1;
  if fn_url is null or fn_secret is null then
    return new;  -- not configured: the app's own call still starts grading
  end if;
  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('type', 'INSERT', 'table', 'recordings', 'schema', 'public', 'record', jsonb_build_object('id', new.id)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', fn_secret),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  return new;  -- never block an upload because the webhook couldn't be queued
end;
$$;
revoke all on function public.recordings_grade_on_insert() from public, anon, authenticated;

drop trigger if exists recordings_grade_on_insert on public.recordings;
create trigger recordings_grade_on_insert after insert on public.recordings
  for each row execute function public.recordings_grade_on_insert();
