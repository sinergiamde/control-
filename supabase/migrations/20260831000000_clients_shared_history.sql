-- Clients: a shared roster for the firm. Any authenticated user (Cristian, Juan Fernando, etc.)
-- can see, create, and rename clients -- it's one shared list, not per-login. This is what lets the
-- Dashboard's client picker do type-to-search ("Tax" -> "TAXFOURYOU INC") and lets History filter
-- statements by client so different clients' bank statements never get mixed together.
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all clients"
  ON public.clients FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can rename clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Admins can delete clients"
  ON public.clients FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Case-insensitive uniqueness so "Tax-Free" and "TAX-FREE" can't be created as two separate
-- clients by accident, while still preserving whatever casing the user actually typed (e.g. the
-- client wants "TAXFOURYOU INC" saved exactly in caps).
CREATE UNIQUE INDEX clients_name_unique_idx ON public.clients (upper(name));

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tie each analyzed statement to a client. Nullable so existing rows (analyzed before this
-- feature existed) don't break; new uploads set it from the Dashboard's client picker.
ALTER TABLE public.analyses ADD COLUMN client_id UUID REFERENCES public.clients(id);
CREATE INDEX analyses_client_id_idx ON public.analyses (client_id);
ALTER TABLE public.annual_summaries ADD COLUMN client_id UUID REFERENCES public.clients(id);
CREATE INDEX annual_summaries_client_id_idx ON public.annual_summaries (client_id);

-- Firm-wide shared history: any authenticated user can see every statement and every annual
-- summary (not just their own uploads), so Cristian and Juan Fernando see the exact same history
-- for a given client. The existing "own rows only" policies stay in place too (harmless overlap --
-- Postgres RLS OR's multiple permissive SELECT policies together) as a fallback.
CREATE POLICY "Authenticated users can view all analyses"
  ON public.analyses FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view all annual summaries"
  ON public.annual_summaries FOR SELECT TO authenticated
  USING (true);
