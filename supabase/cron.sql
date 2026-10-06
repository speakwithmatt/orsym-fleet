-- Run the Enphase sync every 15 minutes. Run this once in the SQL editor after
-- deploying enphase-sync, replacing <PROJECT_REF>. The service role key is read
-- from Vault (add a secret named service_role_key first).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('enphase-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/enphase-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
