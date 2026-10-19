-- Company hierarchy + per-user history.
--
-- TaxForYou owns the app. Its customers are companies (e.g. "Pepito Pérez"), and each of those
-- manages several companies of its own underneath it. Until now `clients` was one flat, firm-wide
-- list that filled up with whatever name got typed at upload time, and every logged-in user saw
-- every statement in the app. New model:
--
--   clients.parent_id IS NULL      -> a TaxForYou customer company ("Pepito Pérez")
--   clients.parent_id = <company>  -> a sub-company that customer manages
--   profiles.client_id             -> which customer company a login belongs to (Diana -> Pepito Pérez)
--
-- Visibility:
--   * Admins (TaxForYou) see everything.
--   * A non-admin sees only their own company + its sub-companies, and only the statements and
--     reports they uploaded themselves.
--   * A non-admin with no company assigned sees nothing until an admin assigns one (sign-up is open
--     to anyone, so "no company" must never mean "see every customer").

-- ---------------------------------------------------------------------------------------------
-- 1. Hierarchy
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.clients(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS clients_parent_id_idx ON public.clients (parent_id);

-- Names were unique app-wide; two different customers can legitimately each manage an "ABC LLC",
-- so uniqueness is now per parent (still case-insensitive).
DROP INDEX IF EXISTS public.clients_name_unique_idx;
CREATE UNIQUE INDEX clients_name_unique_idx
  ON public.clients (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(name));

-- Exactly two levels: a sub-company's parent must be a top-level company, and a company that
-- already has sub-companies can't itself be moved under another one.
CREATE OR REPLACE FUNCTION public.check_client_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A company cannot be its own parent';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Sub-companies cannot have sub-companies';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clients WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'This company has sub-companies, so it cannot be moved under another company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_client_hierarchy ON public.clients;
CREATE TRIGGER check_client_hierarchy
  BEFORE INSERT OR UPDATE OF parent_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.check_client_hierarchy();

-- ---------------------------------------------------------------------------------------------
-- 2. Which company each login belongs to
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS profiles_client_id_idx ON public.profiles (client_id);

-- Users may edit their own profile (name/phone/country), but must never be able to move
-- themselves into another customer's company. Only admins (or SQL run without a user session,
-- e.g. the dashboard SQL editor or the sign-up trigger) can set it.
CREATE OR REPLACE FUNCTION public.guard_profile_client_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.client_id := NULL;
    ELSE
      NEW.client_id := OLD.client_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_client_id ON public.profiles;
CREATE TRIGGER guard_profile_client_id
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_client_id();

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------------------------
-- 3. Access helpers (SECURITY DEFINER so policies can call them without recursing into RLS)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_id FROM public.profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = _client_id
        AND (c.id = public.my_client_id() OR c.parent_id = public.my_client_id())
    )
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. clients: scoped to the user's own company instead of the whole firm
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can create clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can rename clients" ON public.clients;

CREATE POLICY "Users can view their company and its sub-companies"
  ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR id = public.my_client_id()
    OR parent_id = public.my_client_id()
  );

-- Admins create anything; a company user can only add sub-companies under their own company.
CREATE POLICY "Users can create sub-companies under their company"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.my_client_id() IS NOT NULL AND parent_id = public.my_client_id())
  );

CREATE POLICY "Users can rename their sub-companies"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR parent_id = public.my_client_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR parent_id = public.my_client_id());

-- ("Admins can delete clients" stays as it was.)

-- ---------------------------------------------------------------------------------------------
-- 5. analyses: each user sees only what they uploaded; admins see everything
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all analyses" ON public.analyses;
DROP POLICY IF EXISTS "Authenticated users can delete any analysis" ON public.analyses;
DROP POLICY IF EXISTS "Authenticated users can update any analysis" ON public.analyses;
-- Kept: "Users can view their own analyses", "Admins can view all analyses",
--       "Users can delete their own analyses", "Admins can delete analyses".

DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.analyses;
CREATE POLICY "Users can insert their own analyses"
  ON public.analyses FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (client_id IS NULL OR public.can_access_client(client_id))
  );

-- Reassigning a transaction's category writes back to the row (see Results.tsx).
CREATE POLICY "Users can update their own analyses"
  ON public.analyses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------------------------
-- 6. annual_summaries: visible for companies the user can access (not firm-wide)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all annual summaries" ON public.annual_summaries;
CREATE POLICY "Users can view annual summaries of their companies"
  ON public.annual_summaries FOR SELECT TO authenticated
  USING (client_id IS NOT NULL AND public.can_access_client(client_id));

-- ---------------------------------------------------------------------------------------------
-- 7. Saved PDF/Excel reports: only whoever generated them (plus admins)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all reports" ON public.reports;
DROP POLICY IF EXISTS "Authenticated users can create reports" ON public.reports;
DROP POLICY IF EXISTS "Authenticated users can delete reports" ON public.reports;

CREATE POLICY "Users can view their own reports"
  ON public.reports FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create their own reports"
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete their own reports"
  ON public.reports FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated users can read reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete reports" ON storage.objects;

CREATE POLICY "Users can read their own report files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can delete their own report files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reports' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));
