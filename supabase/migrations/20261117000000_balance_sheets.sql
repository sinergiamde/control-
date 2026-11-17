-- Balance general (balance sheet) per client and date. Cash comes from the bank statements; the other
-- assets and the liabilities are not in a bank statement, so people type them and they are kept here,
-- one row per client and "as of" date. Equity is never stored: it is Assets - Liabilities.

CREATE TABLE IF NOT EXISTS public.balance_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  as_of DATE NOT NULL,
  -- { "receivables": 1200, "inventory": 0, "loans": 5000, ... } — amounts in dollars.
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, as_of)
);

ALTER TABLE public.balance_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read balance sheets of accessible clients"
  ON public.balance_sheets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_access_client(client_id));

CREATE POLICY "Create balance sheets of managed clients"
  ON public.balance_sheets FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.can_manage_client(client_id));

CREATE POLICY "Edit balance sheets of managed clients"
  ON public.balance_sheets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_manage_client(client_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.can_manage_client(client_id));

CREATE POLICY "Delete balance sheets of managed clients"
  ON public.balance_sheets FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_manage_client(client_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.balance_sheets TO authenticated;
