-- The annual-summary edge function now rejects any call that doesn't present the shared
-- "x-cron-secret" header (see supabase/functions/annual-summary/index.ts) — it uses the
-- service-role key to read/rewrite every user's data, bypassing RLS, so it must only ever be
-- triggerable by our own scheduled job, not by anyone holding the public anon key.
--
-- IMPORTANT (manual step required): before this reschedule takes effect securely, set a
-- "CRON_SECRET" value in this project's Edge Function secrets (Supabase Dashboard → Edge
-- Functions → Manage secrets, or `supabase secrets set CRON_SECRET=<a-long-random-value>`), and
-- replace 'REPLACE_WITH_CRON_SECRET' below with that same value before applying this migration.
-- cron.schedule() upserts by job name, so re-running this safely replaces the existing schedule.

SELECT cron.schedule(
  'ctrl-plus-annual-summary',
  '0 6 1 1 *',
  $$
  SELECT net.http_post(
    url := 'https://hdenkuiappjyzrtpvzqb.supabase.co/functions/v1/annual-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'REPLACE_WITH_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
