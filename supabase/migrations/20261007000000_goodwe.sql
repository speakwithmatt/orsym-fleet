-- GoodWe SEMS monitoring.

-- Systems pulled from GoodWe are tagged with their own source.
alter table public.systems drop constraint systems_source_check;
alter table public.systems add constraint systems_source_check
  check (source in ('manual','csv','sample','enphase','solaredge','goodwe','other'));

-- Raw status text from the portal, so we can see what it actually said.
alter table public.systems add column if not exists portal_status text;

-- Shared secret the scheduled sync uses to call the sync functions. Only the
-- database (cron) and edge functions (service role) can read it.
create table if not exists public.internal_secrets (
  name text primary key,
  value text not null
);
alter table public.internal_secrets enable row level security;
insert into public.internal_secrets(name, value)
  values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (name) do nothing;
