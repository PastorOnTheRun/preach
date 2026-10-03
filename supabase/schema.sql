-- =====================================================================
-- Preach — Supabase schema (tables, RLS, storage bucket + policies, triggers)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PROFILES: one per auth user. role = 'preacher' | 'admin'.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'preacher' check (role in ('preacher', 'admin')),
  created_at   timestamptz not null default now()
);

-- is_admin(): SECURITY DEFINER so policies can check the role without recursive RLS.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Create a profile automatically when someone signs up (magic link or password).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users that existed before this script ran.
insert into public.profiles (id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Users may only change their display name (never their role). Inserts happen via the trigger.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- SERMONS: synced from each preacher's devices (local-first, last-write-wins).
--   updated_at / position_updated_at are set by the CLIENT (for LWW);
--   synced_at is set by the SERVER on every write (for incremental pulls).
-- ---------------------------------------------------------------------
create table if not exists public.sermons (
  id                  text primary key,                     -- UUID generated on the device
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null default 'Untitled sermon',
  content_html        text not null default '',
  timer_settings      jsonb,                                -- { minutes, warnEnabled, warn1, warn2 }
  last_position       integer not null default 0,           -- reading position (first character on the page)
  position_updated_at timestamptz,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  deleted             boolean not null default false,       -- soft delete so other devices learn about it
  synced_at           timestamptz not null default now()
);
create index if not exists sermons_user_synced_idx on public.sermons (user_id, synced_at);
create index if not exists sermons_updated_idx on public.sermons (updated_at desc);

create or replace function public.sermons_before_write()
returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; end if;  -- owner is immutable
  return new;
end;
$$;
drop trigger if exists sermons_before_write on public.sermons;
create trigger sermons_before_write before insert or update on public.sermons
  for each row execute function public.sermons_before_write();

alter table public.sermons enable row level security;
drop policy if exists "sermons_select_own_or_admin" on public.sermons;
create policy "sermons_select_own_or_admin" on public.sermons
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "sermons_insert_own" on public.sermons;
create policy "sermons_insert_own" on public.sermons
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "sermons_update_own" on public.sermons;
create policy "sermons_update_own" on public.sermons
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "sermons_delete_own" on public.sermons;
create policy "sermons_delete_own" on public.sermons
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.sermons from anon;
grant select, insert, update, delete on public.sermons to authenticated;

-- ---------------------------------------------------------------------
-- RECORDINGS: one row per uploaded sermon recording.
--   Preachers create/update their own rows but can NOT write status/transcript/summary/grade_json;
--   the Phase 2 Edge Function (service role, bypasses RLS) fills those in.
-- ---------------------------------------------------------------------
create table if not exists public.recordings (
  id               uuid primary key default gen_random_uuid(),
  local_id         text unique,                             -- id on the device (makes re-sending idempotent)
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sermon_id        text references public.sermons(id) on delete set null,
  sermon_title     text,
  speaker          text,
  notes            text,                                    -- "what do you want feedback on?"
  storage_path     text not null,                           -- <user_id>/<sermon_id>/<timestamp>.<ext> in bucket 'recordings'
  mime_type        text,
  duration         integer,                                 -- seconds
  overtime_seconds integer,
  timer_minutes    integer,
  created_at       timestamptz not null default now(),
  status           text not null default 'uploaded' check (status in ('uploaded', 'processing', 'graded', 'error')),
  transcript       text,
  summary          text,
  grade_json       jsonb
);
create index if not exists recordings_created_idx on public.recordings (created_at desc);
create index if not exists recordings_user_idx on public.recordings (user_id);

create or replace function public.recordings_before_update()
returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id;  -- owner is immutable
  return new;
end;
$$;
drop trigger if exists recordings_before_update on public.recordings;
create trigger recordings_before_update before update on public.recordings
  for each row execute function public.recordings_before_update();

alter table public.recordings enable row level security;
drop policy if exists "recordings_select_own_or_admin" on public.recordings;
create policy "recordings_select_own_or_admin" on public.recordings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "recordings_insert_own" on public.recordings;
create policy "recordings_insert_own" on public.recordings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "recordings_update_own" on public.recordings;
create policy "recordings_update_own" on public.recordings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "recordings_delete_own" on public.recordings;
create policy "recordings_delete_own" on public.recordings
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.recordings from anon, authenticated;
grant select, delete on public.recordings to authenticated;
grant insert (local_id, user_id, sermon_id, sermon_title, speaker, notes, storage_path, mime_type, duration, overtime_seconds, timer_minutes, created_at)
  on public.recordings to authenticated;
grant update (local_id, user_id, sermon_id, sermon_title, speaker, notes, storage_path, mime_type, duration, overtime_seconds, timer_minutes, created_at)
  on public.recordings to authenticated;

-- ---------------------------------------------------------------------
-- STORAGE: private bucket 'recordings'. Path: <user_id>/<sermon_id>/<timestamp>.<ext>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 52428800,  -- 50 MB (≈ 100 min at 64 kbps)
        array['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recordings_upload_own_folder" on storage.objects;
create policy "recordings_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recordings_read_own_or_admin" on storage.objects;
create policy "recordings_read_own_or_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "recordings_update_own_folder" on storage.objects;
create policy "recordings_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recordings_delete_own_folder" on storage.objects;
create policy "recordings_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- PHASE 2 (TODO, not created here): Edge Function `grade-recording`
--   Trigger: app calls supabase.functions.invoke('grade-recording', { body: { recording_id } })
--            or a Database Webhook on INSERT into public.recordings.
--   Steps:  set status='processing' → download audio with the service role key →
--           xAI STT (POST https://api.x.ai/v1/stt) → Grok summary + rubric grade →
--           update transcript/summary/grade_json, status='graded' → email Jake (Resend/Postmark).
--   Secrets: XAI_API_KEY, RESEND_API_KEY (supabase secrets set ...).
-- ---------------------------------------------------------------------

-- After Jake signs in once, make him an admin (run separately):
--   update public.profiles set role = 'admin' where email = 'jake@YOUR-DOMAIN';
