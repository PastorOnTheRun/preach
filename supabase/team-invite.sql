-- Team invite code for self sign-up (v1.4). Run in the SQL editor after schema.sql. Safe to re-run.
-- New accounts must include the team invite code (user_metadata.invite_code from the app's
-- "Create an account" screen). Enforced by Supabase Auth's "Before User Created" hook, which
-- calls public.hook_require_invite_code() and shows its message to the person signing up.
-- (A plain trigger on auth.users can't do this nicely: Auth hides trigger errors behind
-- "Database error saving new user".) Existing users are unaffected.
--
-- Change the code later (one line):
--   update private.app_settings set value = 'HOPE-2468' where key = 'invite_code';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_settings (
  key   text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.app_settings from public, anon, authenticated;

-- Seed a random easy-to-say code (e.g. MERCY-4821) only if none exists yet.
insert into private.app_settings (key, value)
values ('invite_code',
  (array['GRACE','HOPE','MERCY','FAITH','PEACE','LIGHT','PSALM','CROSS','SHEPHERD','HARVEST'])[1 + floor(random() * 10)::int]
  || '-' || lpad(floor(random() * 10000)::int::text, 4, '0'))
on conflict (key) do nothing;

create or replace function private.norm_code(c text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Auth hook: reject sign-ups without the right code.
create or replace function public.hook_require_invite_code(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
  given text := event->'user'->'user_metadata'->>'invite_code';
begin
  select value into expected from private.app_settings where key = 'invite_code';
  if expected is null or expected = '' then
    return '{}'::jsonb;  -- no code configured: open sign-up
  end if;
  if private.norm_code(given) = private.norm_code(expected) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', case when coalesce(given, '') = ''
      then 'A team invite code is needed to create an account. Ask Jake for it.'
      else 'That team invite code isn’t right. Check it with Jake and try again.' end));
end;
$$;
grant usage on schema private to supabase_auth_admin;
grant execute on function public.hook_require_invite_code(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_require_invite_code(jsonb) from public, anon, authenticated;

-- Admins can see the current code on review.html.
create or replace function public.get_invite_code()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return (select value from private.app_settings where key = 'invite_code');
end;
$$;
revoke execute on function public.get_invite_code() from public, anon;
grant execute on function public.get_invite_code() to authenticated;
