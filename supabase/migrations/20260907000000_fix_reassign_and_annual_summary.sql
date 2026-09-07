-- Reassigning a transaction's category (Results.tsx "reassign" feature) writes the recomputed
-- full_analysis + totals back to `analyses`, but no UPDATE policy existed on this table at all --
-- RLS silently matched zero rows (Supabase/PostgREST returns success with 0 rows affected, not an
-- error, when RLS blocks every row), so the edit looked like it saved (toast said success) but
-- never actually persisted. Matches the shared-team model already used for SELECT/DELETE here.
CREATE POLICY "Authenticated users can update any analysis"
  ON public.analyses FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- annual_summaries was still uniquely keyed by (user_id, year) even after client_id was added in
-- the clients migration -- two different clients analyzed by the same staff account in the same
-- year would collide on that old constraint and silently overwrite each other's annual summary.
-- Re-key it by (client_id, year), which is what the app actually filters/upserts on now.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE tc.table_schema = 'public' AND tc.table_name = 'annual_summaries' AND tc.constraint_type = 'UNIQUE'
  GROUP BY tc.constraint_name
  HAVING array_agg(ccu.column_name ORDER BY ccu.column_name) = ARRAY['user_id', 'year']::text[]
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.annual_summaries DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.annual_summaries
  ADD CONSTRAINT annual_summaries_client_id_year_key UNIQUE (client_id, year);
