-- Sungrow iSolarCloud monitoring: its own source, and a sync every 15 minutes.
alter table public.systems drop constraint systems_source_check;
alter table public.systems add constraint systems_source_check
  check (source in ('manual','csv','sample','enphase','solaredge','goodwe','sungrow','sigenergy','other'));
select cron.schedule('sungrow-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://lsnhlfvyxonphqxgenqu.supabase.co/functions/v1/sungrow-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.internal_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
