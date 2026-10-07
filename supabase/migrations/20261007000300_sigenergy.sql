-- Sigenergy monitoring: a sync every 15 minutes.
select cron.schedule('sigenergy-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://lsnhlfvyxonphqxgenqu.supabase.co/functions/v1/sigenergy-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.internal_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
