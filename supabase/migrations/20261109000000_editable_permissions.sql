-- Editable per-person permissions.
--
-- Each role keeps its default permissions; an admin can switch any of them on or off for one person
-- (user_permissions stores only the differences from the role's defaults). Every rule below asks
-- has_permission() instead of checking the role, so the checkboxes in "Roles y permisos" are what
-- the database actually enforces.
--
--   analyze   analyze statements            receipts  upload receipts
--   clients   create & edit clients         delete    delete statements, receipts & clients
--   designate create/share authorized users (admin permission stays tied to the admin role)

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('analyze', 'receipts', 'clients', 'delete', 'designate')),
  granted BOOLEAN NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read permission overrides" ON public.user_permissions;
CREATE POLICY "Admins read permission overrides"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.role_default_permission(_user_id UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN true
    WHEN _perm = 'admin' THEN false
    WHEN public.has_role(_user_id, 'authorized') THEN _perm IN ('analyze', 'receipts')
    ELSE true
  END
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN true
    ELSE COALESCE(
      (SELECT p.granted FROM public.user_permissions p WHERE p.user_id = _user_id AND p.permission = _perm),
      public.role_default_permission(_user_id, _perm)
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'analyze', public.has_permission(auth.uid(), 'analyze'),
    'receipts', public.has_permission(auth.uid(), 'receipts'),
    'clients', public.has_permission(auth.uid(), 'clients'),
    'delete', public.has_permission(auth.uid(), 'delete'),
    'designate', public.has_permission(auth.uid(), 'designate'),
    'admin', public.has_role(auth.uid(), 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_analyze()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_upload() AND public.has_permission(auth.uid(), 'analyze')
$$;

CREATE OR REPLACE FUNCTION public.can_upload_receipt()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_upload() AND public.has_permission(auth.uid(), 'receipts')
$$;

-- Rename / share a client: admins, or someone with access to it who may manage clients.
CREATE OR REPLACE FUNCTION public.can_manage_client(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR (public.has_permission(auth.uid(), 'clients') AND public.can_access_client(_client_id))
$$;

-- Delete a client's statements / receipts / reports.
CREATE OR REPLACE FUNCTION public.can_delete_in_client(_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR (public.has_permission(auth.uid(), 'delete') AND public.can_access_client(_client_id))
$$;

-- --- Policies ---------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Upload statements to own clients while the plan is active" ON public.analyses;
CREATE POLICY "Upload statements to own clients while the plan is active"
  ON public.analyses FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND client_id IS NOT NULL
    AND public.can_access_client(client_id)
    AND public.can_analyze()
  );

DROP POLICY IF EXISTS "Delete own or managed statements" ON public.analyses;
CREATE POLICY "Delete own or managed statements"
  ON public.analyses FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_delete_in_client(client_id))
    OR (user_id = auth.uid() AND public.has_permission(auth.uid(), 'delete'))
  );

DROP POLICY IF EXISTS "Delete own or managed reports" ON public.reports;
CREATE POLICY "Delete own or managed reports"
  ON public.reports FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (client_id IS NOT NULL AND public.can_delete_in_client(client_id))
    OR (created_by = auth.uid() AND public.has_permission(auth.uid(), 'delete'))
  );

DROP POLICY IF EXISTS "Upload receipts to own clients while the plan is active" ON public.receipts;
CREATE POLICY "Upload receipts to own clients while the plan is active"
  ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_client(client_id) AND public.can_upload_receipt());

DROP POLICY IF EXISTS "Delete own or managed receipts" ON public.receipts;
CREATE POLICY "Delete own or managed receipts"
  ON public.receipts FOR DELETE TO authenticated
  USING (
    public.can_delete_in_client(client_id)
    OR (user_id = auth.uid() AND public.has_permission(auth.uid(), 'delete'))
  );

DROP POLICY IF EXISTS "Users upload receipts to their folder" ON storage.objects;
CREATE POLICY "Users upload receipts to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text AND public.can_upload_receipt());

DROP POLICY IF EXISTS "Managers delete receipt files" ON storage.objects;
CREATE POLICY "Managers delete receipt files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.has_permission(auth.uid(), 'delete'))
      OR EXISTS (SELECT 1 FROM public.receipts r WHERE r.storage_path = objects.name AND public.can_delete_in_client(r.client_id))
    )
  );

-- --- Functions that checked the role ----------------------------------------------------------
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
  IF NOT public.has_permission(auth.uid(), 'clients') THEN
    RAISE EXCEPTION 'You do not have permission to create clients' USING ERRCODE = '42501';
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
  IF NOT (public.can_delete_in_client(_client_id) AND public.can_manage_client(_client_id)) THEN
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
  IF NOT caller_is_admin AND NOT public.has_permission(auth.uid(), 'designate') THEN
    RAISE EXCEPTION 'You do not have permission to share clients' USING ERRCODE = '42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.admin_create_user(
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
    IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'designate') THEN
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

-- --- Admin: switch one permission on/off for one person ---------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_permission(_user_id UUID, _perm TEXT, _granted BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change permissions' USING ERRCODE = '42501';
  END IF;
  IF _perm NOT IN ('analyze', 'receipts', 'clients', 'delete', 'designate') THEN
    RAISE EXCEPTION 'Invalid permission';
  END IF;
  IF public.has_role(_user_id, 'admin') THEN
    RAISE EXCEPTION 'Administrators always have every permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  -- Matching the role's default needs no override row: drop it so a later role change applies cleanly.
  IF _granted = public.role_default_permission(_user_id, _perm) THEN
    DELETE FROM public.user_permissions WHERE user_id = _user_id AND permission = _perm;
  ELSE
    INSERT INTO public.user_permissions (user_id, permission, granted, updated_by)
    VALUES (_user_id, _perm, _granted, auth.uid())
    ON CONFLICT (user_id, permission) DO UPDATE SET granted = EXCLUDED.granted, updated_by = auth.uid(), updated_at = now();
  END IF;
END;
$$;

-- A role change starts from that role's defaults again.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(_user_id UUID, _role TEXT)
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
  DELETE FROM public.user_permissions WHERE user_id = _user_id;
  UPDATE public.profiles
  SET reviewed_at = COALESCE(reviewed_at, now()),
      designated_by = CASE WHEN _role = 'authorized' THEN COALESCE(designated_by, auth.uid()) ELSE designated_by END
  WHERE user_id = _user_id;
  INSERT INTO public.notifications (user_id, kind, data)
  VALUES (_user_id, 'role_assigned', jsonb_build_object('role', _role));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_permission(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_permission(UUID, TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;
REVOKE ALL ON FUNCTION public.can_analyze() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_analyze() TO authenticated;
REVOKE ALL ON FUNCTION public.can_upload_receipt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_receipt() TO authenticated;

-- --- Client contact details (add-client form) ---------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

DROP FUNCTION IF EXISTS public.create_client(TEXT);
CREATE OR REPLACE FUNCTION public.create_client(
  _name TEXT, _company TEXT DEFAULT NULL, _email TEXT DEFAULT NULL, _phone TEXT DEFAULT NULL
)
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
  IF NOT public.has_permission(auth.uid(), 'clients') THEN
    RAISE EXCEPTION 'You do not have permission to create clients' USING ERRCODE = '42501';
  END IF;
  IF length(trim(COALESCE(_name, ''))) > 150 OR length(COALESCE(_company, '')) > 150
     OR length(COALESCE(_email, '')) > 150 OR length(COALESCE(_phone, '')) > 40 THEN
    RAISE EXCEPTION 'A client field is too long';
  END IF;
  INSERT INTO public.clients (name, company, email, phone, created_by)
  VALUES (COALESCE(_name, ''), NULLIF(trim(COALESCE(_company, '')), ''), NULLIF(trim(COALESCE(_email, '')), ''),
          NULLIF(trim(COALESCE(_phone, '')), ''), auth.uid())
  RETURNING id INTO new_id;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    INSERT INTO public.client_access (client_id, user_id, granted_by) VALUES (new_id, auth.uid(), auth.uid());
  END IF;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_client(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- --- Sign-in email can't be changed by the user -------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND COALESCE(current_setting('app.privileged', true), '') <> 'on' THEN
    RAISE EXCEPTION 'The sign-in email cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS block_email_change ON auth.users;
CREATE TRIGGER block_email_change
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_email_change();
