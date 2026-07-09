
CREATE TABLE public.analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company text NOT NULL DEFAULT '',
  period text NOT NULL DEFAULT '',
  revenues_total numeric NOT NULL DEFAULT 0,
  cogs_total numeric NOT NULL DEFAULT 0,
  opex_total numeric NOT NULL DEFAULT 0,
  personal_total numeric NOT NULL DEFAULT 0,
  fees_total numeric NOT NULL DEFAULT 0,
  full_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own analyses"
  ON public.analyses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analyses"
  ON public.analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all analyses"
  ON public.analyses FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete analyses"
  ON public.analyses FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
