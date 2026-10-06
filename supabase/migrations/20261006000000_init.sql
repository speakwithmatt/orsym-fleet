-- Orsym Fleet: initial schema.
-- One "org" per installer business. Every data table carries org_id and is
-- locked down with row level security so a user only ever sees the orgs they
-- belong to.

create extension if not exists pgcrypto;

-- ---------- orgs and membership ----------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  region text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  email text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on public.members(user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'member' check (role in ('admin','member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

-- Membership checks used by every policy. security definer so the policies
-- on members itself don't recurse.
create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid());
$$;

create or replace function public.is_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- ---------- fleet data ----------

-- People jobs can be booked with: the installer's own team and contractors.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null,
  name text not null,
  short text,
  kind text not null default 'team' check (kind in ('team','contractor')),
  role text,
  cal text,
  email text,
  unique (org_id, key)
);

create table public.systems (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ref text not null,
  name text not null,
  contact text,
  type text not null default 'Residential' check (type in ('Residential','Commercial','Farm')),
  brand text,
  model text,
  kw numeric(8,2),
  panels int,
  panel_model text,
  battery text,
  town text,
  address text,
  phone text,
  email text,
  serial text,
  installed date,
  status text not null default 'Online' check (status in ('Online','Underperforming','Offline','Fault')),
  plan text not null default 'None' check (plan in ('None','Monitor','Care','Commercial')),
  plan_fee numeric(10,2) not null default 0,
  plan_start date,
  last_service date,
  next_service date,
  inv_warranty date,
  exp_kwh numeric(10,2),          -- expected kWh per day in good weather
  perf numeric(5,3) default 1,    -- latest actual / expected
  offline_days int not null default 0,
  fault_title text,
  fault_sev text,
  offer_sent date,
  connected boolean not null default true,
  source text not null default 'manual' check (source in ('manual','csv','sample','enphase','solaredge','other')),
  external_id text,               -- the inverter portal's own site/system id
  last_reading_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);
create index systems_org_idx on public.systems(org_id);
create unique index systems_external_idx on public.systems(org_id, source, external_id) where external_id is not null;

-- Daily energy per system. Filled by the inverter sync; charts fall back to
-- the modelled numbers on systems when a system has no readings yet.
create table public.readings (
  system_id uuid not null references public.systems(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  day date not null,
  kwh numeric(10,2),
  primary key (system_id, day)
);
create index readings_org_day_idx on public.readings(org_id, day);

create table public.alerts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  system_id uuid not null references public.systems(id) on delete cascade,
  sev text not null check (sev in ('critical','warning','info')),
  title text not null,
  detail text,
  at timestamptz not null default now(),
  state text not null default 'open' check (state in ('open','ack','job')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz
);
create index alerts_org_idx on public.alerts(org_id, state);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ref text not null,
  system_id uuid not null references public.systems(id) on delete cascade,
  kind text not null,
  cat text not null default 'annual' check (cat in ('annual','commercial','fault')),
  due date not null,
  who text,                       -- people.key
  slot date,
  time text,
  via text[] not null default '{}',
  cust boolean not null default false,
  state text not null default 'unscheduled' check (state in ('unscheduled','sent','scheduled','done')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);
create index jobs_org_idx on public.jobs(org_id);

create table public.stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  part text not null,
  qty int not null default 0,
  min int not null default 0
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  ref text not null,
  system_id uuid references public.systems(id) on delete set null,
  item text,
  serial text,
  lodged date,
  state text
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null,
  kind text not null,
  state text not null default 'Not connected',
  synced_at timestamptz,
  last_error text,
  unique (org_id, provider)
);

-- API tokens for inverter portals. RLS on with no policies: only the
-- service role (edge functions) can read or write it, never the browser.
create table public.connection_secrets (
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null,
  secret jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

-- ---------- row level security ----------

alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.people enable row level security;
alter table public.systems enable row level security;
alter table public.readings enable row level security;
alter table public.alerts enable row level security;
alter table public.jobs enable row level security;
alter table public.stock enable row level security;
alter table public.claims enable row level security;
alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;

create policy orgs_read on public.orgs for select to authenticated using (public.is_member(id));
create policy orgs_update on public.orgs for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

create policy members_read on public.members for select to authenticated using (public.is_member(org_id));
create policy members_admin_update on public.members for update to authenticated
  using (public.is_admin(org_id) and role <> 'owner') with check (public.is_admin(org_id) and role <> 'owner');
create policy members_admin_delete on public.members for delete to authenticated
  using ((public.is_admin(org_id) and role <> 'owner') or user_id = auth.uid() and role <> 'owner');

create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin(org_id)) with check (public.is_admin(org_id));
create policy invites_mine on public.invites for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

-- All the fleet tables share one rule: members of the org can do anything
-- with that org's rows.
do $$
declare t text;
begin
  foreach t in array array['people','systems','readings','alerts','jobs','stock','claims','connections'] loop
    execute format('create policy %1$s_member on public.%1$s for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id))', t);
  end loop;
end $$;

-- ---------- RPCs ----------

-- Create a business and make the caller its owner.
create or replace function public.create_org(org_name text, org_region text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  e text := lower(auth.jwt() ->> 'email');
  nm text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(e, '@', 1));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into orgs(name, region, settings) values (trim(org_name), org_region, jsonb_build_object(
    'rules', jsonb_build_object('mode','manual','lead',30,'residential','anyteam','commercial','anyteam','fault','anyteam',
      'team', jsonb_build_object('cal',true,'email',true,'board',false),
      'contractor', jsonb_build_object('email',true,'board',false),
      'customer', true)
  )) returning id into o;
  insert into members(org_id, user_id, role, email) values (o, auth.uid(), 'owner', e);
  insert into people(org_id, key, name, kind, role, cal, email) values (o, 'me', coalesce(nm, 'Me'), 'team', 'Owner', 'Google Calendar', e);
  insert into connections(org_id, provider, kind, state) values
    (o,'Enphase','Inverter portal','Not connected'),
    (o,'SolarEdge','Inverter portal','Not connected'),
    (o,'Fronius','Inverter portal','Not connected'),
    (o,'Huawei','Inverter portal','Not connected'),
    (o,'Sungrow','Inverter portal','Not connected'),
    (o,'GoodWe','Inverter portal','Not connected'),
    (o,'SMA','Inverter portal','Not connected'),
    (o,'Xero','Plan invoicing','Not connected'),
    (o,'Fergus','Job management','Not connected');
  return o;
end $$;

-- Join any businesses the caller has been invited to. Called after sign-in.
create or replace function public.accept_invites() returns int
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(auth.jwt() ->> 'email');
  n int;
begin
  if auth.uid() is null or e is null then return 0; end if;
  insert into members(org_id, user_id, role, email)
    select org_id, auth.uid(), role, e from invites where email = e and accepted_at is null
    on conflict do nothing;
  get diagnostics n = row_count;
  update invites set accepted_at = now() where email = e and accepted_at is null;
  return n;
end $$;

revoke execute on function public.create_org(text, text) from anon, public;
revoke execute on function public.accept_invites() from anon, public;
grant execute on function public.create_org(text, text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
