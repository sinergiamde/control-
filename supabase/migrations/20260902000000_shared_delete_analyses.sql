-- Deleting a statement was restricted to whoever originally uploaded it (auth.uid() = user_id),
-- which silently failed for anyone else on the shared team -- inconsistent with every other shared
-- policy added for "todos ven lo mismo" (clients, analyses SELECT, annual_summaries). Widen it so
-- any authenticated user can delete any statement, matching the rest of the shared-team model.
CREATE POLICY "Authenticated users can delete any analysis"
  ON public.analyses FOR DELETE TO authenticated
  USING (true);
