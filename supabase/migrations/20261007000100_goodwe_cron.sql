-- Sync every connected GoodWe account every 15 minutes. The sync function
-- checks the x-cron-secret header against internal_secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('goodwe-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://lsnhlfvyxonphqxgenqu.supabase.co/functions/v1/goodwe-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.internal_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
