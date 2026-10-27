-- Four roles, clients per user, open sign-up with a 24-hour trial, in-app notifications, receipts.
--
--   admin       -> TaxForYou administrator: everything (users, roles, clients, statements, receipts, settings).
--   accountant  -> "Contador": creates and manages the clients assigned to them; uploads/analyzes
--                  statements and receipts; exports reports. Sees only their own clients.
--   user        -> "Usuario" (no role row; every new sign-up starts here): analyzes their own
--                  statements, uploads their receipts, downloads their reports. Only their own data.
--   authorized  -> "Usuario autorizado": designated by a user or accountant; uploads and views in the
--                  clients shared with them, never deletes, creates clients or manages users.
--
-- Who can see a client is now an explicit grant (client_access), so one person can work with several
-- clients. Uploading needs an active plan: TaxForYou admins always; everyone else while their 24-hour
-- trial lasts or once an admin marks them subscribed (an authorized user rides on whoever designated them).
--
-- NOTE: enum changes must be committed before the rest can use them, so run step A on its own first.

-- ---------------------------------------------------------------------------------------------
-- Step A (run alone)
-- ---------------------------------------------------------------------------------------------
ALTER TYPE public.app_role RENAME VALUE 'company_admin' TO 'accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'authorized';

-- Keeps the policies that still call it valid until step B drops them.
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'accountant') AND public.my_client_id() IS NOT NULL
$$;

-- ---------------------------------------------------------------------------------------------
-- Step B
-- ---------------------------------------------------------------------------------------------

-- --- Sign-up is open again (new people try the app for 24 hours) ------------------------------
DROP TRIGGER IF EXISTS block_public_signup ON auth.users;
DROP FUNCTION IF EXISTS public.block_public_signup();

-- --- Profile: review status, trial, subscription, who designated an authorized user -----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  ADD COLUMN IF NOT EXISTS subscribed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS designated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.profiles p SET reviewed_at = now()
WHERE p.reviewed_at IS NULL AND public.has_role(p.user_id, 'admin');

-- --- Which clients each person works with -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_access (
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS client_access_user_idx ON public.client_access (user_id);
ALTER TABLE public.client_access ENABLE ROW LEVEL SECURITY;

INSERT INTO public.client_access (client_id, user_id)
SELECT client_id, user_id FROM public.profiles WHERE client_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- --- Helpers ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.role_of(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN 'admin'
    WHEN public.has_role(_user_id, 'accountant') THEN 'accountant'
    WHEN public.has_role(_user_id, 'authorized') THEN 'authorized'
    ELSE 'user'
  END
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
      FROM public.client_access a
      JOIN public.clients c ON c.id = _client_id
      WHERE a.user_id = auth.uid() AND (a.client_id = c.id OR a.client_id = c.parent_id)
    )
$$;

-- Rename / delete a client and anything filed under it: admins, or a non-authorized member.
CREATE OR REPLACE FUNCTION public.can_manage_client(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR (NOT public.has_role(auth.uid(), 'authorized') AND public.can_access_client(_client_id))
$$;

-- Role / password / clients / delete for this account: admins for anyone; a user or accountant
-- for the authorized users they designated.
CREATE OR REPLACE FUNCTION public.can_manage_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR (
      public.has_role(_user_id, 'authorized')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _user_id AND p.designated_by = auth.uid())
    )
$$;

CREATE OR REPLACE FUNCTION public.has_active_plan(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _user_id AND (p.subscribed OR p.trial_ends_at > now()))
$$;

-- Whether the caller may upload statements / receipts right now.
CREATE OR REPLACE FUNCTION public.can_upload()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'authorized')
      THEN COALESCE(public.has_active_plan((SELECT designated_by FROM public.profiles WHERE user_id = auth.uid())), false)
    ELSE public.has_active_plan(auth.uid())
  END
$$;

-- --- Profile fields only admins (or the account-creation functions) may set -------------------
CREATE OR REPLACE FUNCTION public.guard_profile_client_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND COALESCE(current_setting('app.privileged', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.client_id := NULL;
      NEW.reviewed_at := NULL;
      NEW.trial_ends_at := now() + interval '24 hours';
      NEW.subscribed := false;
      NEW.designated_by := NULL;
    ELSE
      NEW.client_id := OLD.client_id;
      NEW.reviewed_at := OLD.reviewed_at;
      NEW.trial_ends_at := OLD.trial_ends_at;
      NEW.subscribed := OLD.subscribed;
      NEW.designated_by := OLD.designated_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- --- Clients: trimmed names, no duplicates among the clients you work with, only admins re-parent
DROP INDEX IF EXISTS public.clients_name_unique_idx;

CREATE OR REPLACE FUNCTION public.check_client_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := trim(COALESCE(NEW.name, ''));
  IF NEW.name = '' THEN
    RAISE EXCEPTION 'Write a client name';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id
     AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can move clients' USING ERRCODE = '42501';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A client cannot be its own parent';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Sub-clients cannot have sub-clients';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clients WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'This client has sub-clients, so it cannot be moved under another client';
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' OR upper(NEW.name) <> upper(OLD.name)) AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id <> NEW.id
      AND upper(c.name) = upper(NEW.name)
      AND (auth.uid() IS NULL OR public.can_access_client(c.id))
  ) THEN
    RAISE EXCEPTION 'duplicate client name' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

-- --- Policies: drop the one-company model, scope everything through client_access -------------
DROP POLICY IF EXISTS "Users can view their company and its sub-companies" ON public.clients;
DROP POLICY IF EXISTS "Admins and company admins can create companies" ON public.clients;
DROP POLICY IF EXISTS "Admins and company admins can rename companies" ON public.clients;
DROP POLICY IF EXISTS "Admins can delete clients" ON public.clients;
DROP POLICY IF EXISTS "Company admins can view their company's users" ON public.profiles;
DROP POLICY IF EXISTS "Company admins can view their users' roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can view their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Company admins can view their company's analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can update their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Company admins can update their company's analyses" ON public.analyses;
DROP POLICY IF EXISTS "Admins can delete analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can delete their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Company admins can delete their company's analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can view their own reports" ON public.reports;
DROP POLICY IF EXISTS "Company admins can view their company's reports" ON public.reports;
DROP POLICY IF EXISTS "Users can delete their own reports" ON public.reports;
DROP POLICY IF EXISTS "Company admins can delete their company's reports" ON public.reports;
DROP POLICY IF EXISTS "Company admins can read their company's report files" ON storage.objects;
DROP FUNCTION IF EXISTS public.is_company_admin();

CREATE POLICY "Members can view their clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.can_access_client(id));
-- Everyone else creates clients through create_client(), which also grants them access.
CREATE POLICY "Admins can create clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can rename their clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.can_manage_client(id))
  WITH CHECK (public.can_manage_client(id));
CREATE POLICY "Admins can delete clients"
  ON public.clients FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "People see their own client access"
  ON public.client_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_client(client_id));
CREATE POLICY "Admins manage client access"
  ON public.client_access FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Designators can view their authorized users"
  ON public.profiles FOR SELECT TO authenticated
  USING (designated_by = auth.uid());
CREATE POLICY "Designators can view their authorized users' roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.can_manage_user(user_id));

CREATE POLICY "View own or client statements"
  ON public.analyses FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  );
CREATE POLICY "Upload statements to own clients while the plan is active"
  ON public.analyses FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND client_id IS NOT NULL
    AND public.can_access_client(client_id)
    AND public.can_upload()
  );
CREATE POLICY "Update own or managed statements"
  ON public.analyses FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR (client_id IS NOT NULL AND public.can_manage_client(client_id)))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR (client_id IS NOT NULL AND public.can_manage_client(client_id)));
CREATE POLICY "Delete own or managed statements"
  ON public.analyses FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_manage_client(client_id))
    OR (user_id = auth.uid() AND NOT public.has_role(auth.uid(), 'authorized'))
  );

CREATE POLICY "View own or client reports"
  ON public.reports FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_access_client(client_id))
  );
CREATE POLICY "Delete own or managed reports"
  ON public.reports FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_manage_client(client_id))
    OR (created_by = auth.uid() AND NOT public.has_role(auth.uid(), 'authorized'))
  );
CREATE POLICY "Members can read their clients' report files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.storage_path = objects.name AND r.client_id IS NOT NULL AND public.can_access_client(r.client_id)
    )
  );

-- --- In-app notifications -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their notifications"
  ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users mark their notifications read"
  ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete their notifications"
  ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- A new sign-up tells every TaxForYou admin (accounts created by an admin or designator don't).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, phone, country)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'country', '')
  );
  IF COALESCE(current_setting('app.privileged', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, kind, data)
    SELECT r.user_id, 'new_signup', jsonb_build_object(
      'user_id', NEW.id,
      'name', COALESCE(NEW.raw_user_meta_data->>'name', ''),
      'email', NEW.email,
      'at', now()
    )
    FROM public.user_roles r WHERE r.role = 'admin';
  END IF;
  RETURN NEW;
END;
$$;

-- --- Settings TaxForYou edits in the app (where "Subscribe" sends people) ---------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read app settings"
  ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins edit app settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.app_settings (key, value) VALUES ('subscribe_whatsapp', ''), ('subscribe_email', '')
ON CONFLICT (key) DO NOTHING;

-- --- Receipts ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  receipt_date DATE,
  merchant TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14, 2),
  tax NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  note TEXT NOT NULL DEFAULT '',
  -- Fields the reader wasn't sure about and the person should double-check ("verificar").
  needs_review TEXT[] NOT NULL DEFAULT '{}',
  extracted JSONB,
  -- The statement transaction this receipt backs up (matched by date / description / amount).
  analysis_id UUID REFERENCES public.analyses(id) ON DELETE SET NULL,
  txn_date TEXT,
  txn_desc TEXT,
  txn_amount NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_client_idx ON public.receipts (client_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS receipts_analysis_idx ON public.receipts (analysis_id);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_receipts_updated_at ON public.receipts;
CREATE TRIGGER update_receipts_updated_at
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "View own or client receipts"
  ON public.receipts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access_client(client_id));
CREATE POLICY "Upload receipts to own clients while the plan is active"
  ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_client(client_id) AND public.can_upload());
CREATE POLICY "Edit own or managed receipts"
  ON public.receipts FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_client(client_id))
  WITH CHECK (public.can_access_client(client_id));
CREATE POLICY "Delete own or managed receipts"
  ON public.receipts FOR DELETE TO authenticated
  USING (public.can_manage_client(client_id) OR (user_id = auth.uid() AND NOT public.has_role(auth.uid(), 'authorized')));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipts', 'receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload receipts to their folder" ON storage.objects;
CREATE POLICY "Users upload receipts to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text AND public.can_upload());
DROP POLICY IF EXISTS "Members read receipt files" ON storage.objects;
CREATE POLICY "Members read receipt files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.receipts r WHERE r.storage_path = objects.name AND public.can_access_client(r.client_id))
    )
  );
DROP POLICY IF EXISTS "Managers delete receipt files" ON storage.objects;
CREATE POLICY "Managers delete receipt files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.receipts r WHERE r.storage_path = objects.name AND public.can_manage_client(r.client_id))
    )
  );

-- --- RPCs -------------------------------------------------------------------------------------
-- Any user or accountant (and admins) can add a client; it's theirs straight away.
CREATE OR REPLACE FUNCTION public.create_client(_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(auth.uid(), 'authorized') THEN
    RAISE EXCEPTION 'Authorized users cannot create clients' USING ERRCODE = '42501';
  END IF;
  IF length(trim(COALESCE(_name, ''))) > 150 THEN
    RAISE EXCEPTION 'The client name is too long';
  END IF;
  INSERT INTO public.clients (name, created_by) VALUES (COALESCE(_name, ''), auth.uid()) RETURNING id INTO new_id;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    INSERT INTO public.client_access (client_id, user_id, granted_by) VALUES (new_id, auth.uid(), auth.uid());
  END IF;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_client(_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ids UUID[];
  n_analyses INT;
BEGIN
  IF NOT public.can_manage_client(_client_id) THEN
    RAISE EXCEPTION 'You cannot delete this client' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(id) INTO ids FROM public.clients WHERE id = _client_id OR parent_id = _client_id;
  IF ids IS NULL OR NOT (_client_id = ANY (ids)) THEN
    RAISE EXCEPTION 'Client not found';
  END IF;
  DELETE FROM public.reports
  WHERE client_id = ANY (ids)
     OR analysis_id IN (SELECT id FROM public.analyses WHERE client_id = ANY (ids));
  DELETE FROM public.receipts WHERE client_id = ANY (ids);
  DELETE FROM public.annual_summaries WHERE client_id = ANY (ids);
  DELETE FROM public.analyses WHERE client_id = ANY (ids);
  GET DIAGNOSTICS n_analyses = ROW_COUNT;
  UPDATE public.profiles SET client_id = NULL WHERE client_id = ANY (ids);
  DELETE FROM public.clients WHERE parent_id = _client_id;
  DELETE FROM public.clients WHERE id = _client_id;
  RETURN jsonb_build_object('statements', n_analyses, 'sub_companies', array_length(ids, 1) - 1);
END;
$$;

-- Replaces the clients a person works with. Admins assign any client; a user or accountant shares
-- only their own clients with the authorized users they designated.
CREATE OR REPLACE FUNCTION public.set_user_clients(_user_id UUID, _client_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN := public.has_role(auth.uid(), 'admin');
  wanted UUID[] := COALESCE(_client_ids, '{}');
  added_names TEXT[];
BEGIN
  IF NOT public.can_manage_user(_user_id) THEN
    RAISE EXCEPTION 'You cannot manage this user' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(_user_id, 'admin') THEN
    RAISE EXCEPTION 'Administrators already see every client';
  END IF;
  IF NOT caller_is_admin AND EXISTS (SELECT 1 FROM unnest(wanted) w(id) WHERE NOT public.can_manage_client(w.id)) THEN
    RAISE EXCEPTION 'You can only share your own clients' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.name ORDER BY c.name) INTO added_names
  FROM public.clients c
  WHERE c.id = ANY (wanted)
    AND NOT EXISTS (SELECT 1 FROM public.client_access a WHERE a.user_id = _user_id AND a.client_id = c.id);

  DELETE FROM public.client_access a
  WHERE a.user_id = _user_id
    AND NOT (a.client_id = ANY (wanted))
    AND (caller_is_admin OR public.can_manage_client(a.client_id));
  INSERT INTO public.client_access (client_id, user_id, granted_by)
  SELECT w.id, _user_id, auth.uid() FROM unnest(wanted) w(id)
  WHERE EXISTS (SELECT 1 FROM public.clients c WHERE c.id = w.id)
  ON CONFLICT DO NOTHING;

  IF caller_is_admin THEN
    UPDATE public.profiles SET reviewed_at = COALESCE(reviewed_at, now()) WHERE user_id = _user_id;
  END IF;
  IF added_names IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, data)
    VALUES (_user_id, 'clients_assigned', jsonb_build_object('clients', to_jsonb(added_names)));
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_set_user_role(UUID, TEXT);
CREATE FUNCTION public.admin_set_user_role(_user_id UUID, _role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change roles' USING ERRCODE = '42501';
  END IF;
  IF _role NOT IN ('admin', 'accountant', 'user', 'authorized') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  IF _role <> 'user' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role::public.app_role);
  END IF;
  UPDATE public.profiles
  SET reviewed_at = COALESCE(reviewed_at, now()),
      designated_by = CASE WHEN _role = 'authorized' THEN COALESCE(designated_by, auth.uid()) ELSE designated_by END
  WHERE user_id = _user_id;
  INSERT INTO public.notifications (user_id, kind, data)
  VALUES (_user_id, 'role_assigned', jsonb_build_object('role', _role));
END;
$$;

-- Subscription is activated by hand for now (people pay TaxForYou via WhatsApp / email).
CREATE OR REPLACE FUNCTION public.admin_set_user_plan(_user_id UUID, _subscribed BOOLEAN, _trial_ends_at TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change subscriptions' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
  SET subscribed = COALESCE(_subscribed, subscribed),
      trial_ends_at = COALESCE(_trial_ends_at, trial_ends_at),
      reviewed_at = COALESCE(reviewed_at, now())
  WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF _subscribed THEN
    INSERT INTO public.notifications (user_id, kind, data) VALUES (_user_id, 'subscription_activated', '{}'::jsonb);
  END IF;
END;
$$;

-- "Subscribe" button: lets every admin know (at most once an hour per person).
CREATE OR REPLACE FUNCTION public.request_subscription()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE kind = 'subscription_request' AND data->>'user_id' = auth.uid()::text AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, kind, data)
  SELECT r.user_id, 'subscription_request', jsonb_build_object('user_id', auth.uid(), 'name', p.name, 'email', u.email)
  FROM public.user_roles r
  JOIN public.profiles p ON p.user_id = auth.uid()
  JOIN auth.users u ON u.id = auth.uid()
  WHERE r.role = 'admin';
END;
$$;

DROP FUNCTION IF EXISTS public.admin_create_user(TEXT, TEXT, TEXT, TEXT, UUID);
CREATE FUNCTION public.admin_create_user(
  _email TEXT, _password TEXT, _name TEXT, _role TEXT, _client_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN := public.has_role(auth.uid(), 'admin');
  new_id UUID := gen_random_uuid();
  clean_email TEXT := lower(trim(COALESCE(_email, '')));
  clean_name TEXT := NULLIF(trim(COALESCE(_name, '')), '');
  wanted UUID[] := COALESCE(_client_ids, '{}');
BEGIN
  IF _role NOT IN ('admin', 'accountant', 'user', 'authorized') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF NOT caller_is_admin THEN
    IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'authorized') THEN
      RAISE EXCEPTION 'You cannot create users' USING ERRCODE = '42501';
    END IF;
    IF _role <> 'authorized' THEN
      RAISE EXCEPTION 'You can only create authorized users' USING ERRCODE = '42501';
    END IF;
    IF cardinality(wanted) = 0 THEN
      RAISE EXCEPTION 'Choose at least one client to share';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(wanted) w(id) WHERE NOT public.can_manage_client(w.id)) THEN
      RAISE EXCEPTION 'You can only share your own clients' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _role = 'admin' THEN
    wanted := '{}';
  END IF;

  IF clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;
  IF _password IS NULL OR length(_password) < 8 THEN
    RAISE EXCEPTION 'The password must be at least 8 characters long';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = clean_email) THEN
    RAISE EXCEPTION 'A user with that email already exists';
  END IF;

  PERFORM set_config('app.privileged', 'on', true);

  -- Same shape Supabase Auth writes for a confirmed email/password account, so they can sign in
  -- straight away with the password they're handed.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', clean_email,
    extensions.crypt(_password, extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('name', COALESCE(clean_name, split_part(clean_email, '@', 1))),
    now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', clean_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  UPDATE public.profiles
  SET reviewed_at = now(),
      designated_by = CASE WHEN _role = 'authorized' THEN auth.uid() ELSE NULL END
  WHERE user_id = new_id;
  IF _role <> 'user' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new_id, _role::public.app_role);
  END IF;
  INSERT INTO public.client_access (client_id, user_id, granted_by)
  SELECT w.id, new_id, auth.uid() FROM unnest(wanted) w(id)
  WHERE EXISTS (SELECT 1 FROM public.clients c WHERE c.id = w.id)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('app.privileged', 'off', true);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (user_id UUID, email TEXT, last_sign_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN QUERY
      SELECT u.id, u.email::TEXT, u.last_sign_in_at, u.created_at FROM auth.users u ORDER BY u.created_at DESC;
  ELSE
    RETURN QUERY
      SELECT u.id, u.email::TEXT, u.last_sign_in_at, u.created_at
      FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
      WHERE p.designated_by = auth.uid()
      ORDER BY u.created_at DESC;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_client(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.set_user_clients(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_clients(UUID, UUID[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_plan(UUID, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_plan(UUID, BOOLEAN, TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.request_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_subscription() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
