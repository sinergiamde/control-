-- Allow users to delete their own uploaded statements (e.g. to fix a duplicated/wrong month)
CREATE POLICY "Users can delete their own analyses"
  ON public.analyses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Table to hold the automated year-end summary (generated every Jan 1 for the prior year)
CREATE TABLE public.annual_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year int NOT NULL,
  revenues_total numeric NOT NULL DEFAULT 0,
  cogs_total numeric NOT NULL DEFAULT 0,
  opex_total numeric NOT NULL DEFAULT 0,
  personal_total numeric NOT NULL DEFAULT 0,
  fees_total numeric NOT NULL DEFAULT 0,
  net_income numeric NOT NULL DEFAULT 0,
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  statements_count int NOT NULL DEFAULT 0,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);

ALTER TABLE public.annual_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own annual summaries"
  ON public.annual_summaries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all annual summaries"
  ON public.annual_summaries FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Schedule the annual-summary edge function to run every January 1st at 06:00 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'ctrl-plus-annual-summary',
  '0 6 1 1 *',
  $$
  SELECT net.http_post(
    url := 'https://hdenkuiappjyzrtpvzqb.supabase.co/functions/v1/annual-summary',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
