
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS original_filename text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS total_spent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_category text NOT NULL DEFAULT '';
