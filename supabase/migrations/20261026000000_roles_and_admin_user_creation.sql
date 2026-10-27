-- Definitive roles + accounts created by administrators (public sign-up closed).
--
--   admin          -> TaxForYou administrator: everything.
--   company_admin  -> a customer company's administrator: sees ALL statements of their company and
--                     its sub-companies, creates sub-companies, and creates/edits/deletes the users
--                     of their own company (never TaxForYou admins).
--   (no role row)  -> company user: only their company, only the statements they uploaded.
--
-- NOTE: the enum value must be committed before anything below can use it, so run step 1 on its
-- own first (Postgres rejects using a new enum value in the same transaction that added it).

-- ---------------------------------------------------------------------------------------------
-- Step 1 (run alone)
-- ---------------------------------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'company_admin';

-- ---------------------------------------------------------------------------------------------
-- Step 2
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'company_admin') AND public.my_client_id() IS NOT NULL
$$;

-- Whether the caller may manage (role / password / delete) this user: TaxForYou admins manage
-- anyone; a company admin manages the non-admin users of their own company.
CREATE OR REPLACE FUNCTION public.can_manage_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR (
      public.is_company_admin()
      AND NOT public.has_role(_user_id, 'admin')
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = _user_id AND p.client_id = public.my_client_id())
    )
$$;

-- --- What a company admin can see / do ------------------------------------------------------
DROP POLICY IF EXISTS "Company admins can view their company's users" ON public.profiles;
CREATE POLICY "Company admins can view their company's users"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_company_admin() AND client_id = public.my_client_id());

DROP POLICY IF EXISTS "Company admins can view their users' roles" ON public.user_roles;
CREATE POLICY "Company admins can view their users' roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.can_manage_user(user_id));

DROP POLICY IF EXISTS "Company admins can view their company's analyses" ON public.analyses;
CREATE POLICY "Company admins can view their company's analyses"
  ON public.analyses FOR SELECT TO authenticated
  USING (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Company admins can update their company's analyses" ON public.analyses;
CREATE POLICY "Company admins can update their company's analyses"
  ON public.analyses FOR UPDATE TO authenticated
  USING (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id))
  WITH CHECK (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Company admins can delete their company's analyses" ON public.analyses;
CREATE POLICY "Company admins can delete their company's analyses"
  ON public.analyses FOR DELETE TO authenticated
  USING (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Company admins can view their company's reports" ON public.reports;
CREATE POLICY "Company admins can view their company's reports"
  ON public.reports FOR SELECT TO authenticated
  USING (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Company admins can delete their company's reports" ON public.reports;
CREATE POLICY "Company admins can delete their company's reports"
  ON public.reports FOR DELETE TO authenticated
  USING (public.is_company_admin() AND client_id IS NOT NULL AND public.can_access_client(client_id));

DROP POLICY IF EXISTS "Company admins can read their company's report files" ON storage.objects;
CREATE POLICY "Company admins can read their company's report files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'reports'
    AND public.is_company_admin()
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.clients WHERE id = public.my_client_id() OR parent_id = public.my_client_id()
    )
  );

-- Only admins and company admins create / rename sub-companies (plain users no longer can).
DROP POLICY IF EXISTS "Users can create sub-companies under their company" ON public.clients;
CREATE POLICY "Admins and company admins can create companies"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.is_company_admin() AND parent_id = public.my_client_id())
  );

DROP POLICY IF EXISTS "Users can rename their sub-companies" ON public.clients;
CREATE POLICY "Admins and company admins can rename companies"
  ON public.clients FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR (public.is_company_admin() AND parent_id = public.my_client_id()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR (public.is_company_admin() AND parent_id = public.my_client_id()));

-- --- Accounts are created by administrators only --------------------------------------------
-- Any insert into auth.users that doesn't come from admin_create_user (which flips this
-- transaction-local flag) is rejected, so the public "Register" flow is closed server-side too.
CREATE OR REPLACE FUNCTION public.block_public_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.allow_user_creation', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Sign-up is closed. Ask an administrator to create your account.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_public_signup ON auth.users;
CREATE TRIGGER block_public_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_public_signup();

-- The profile-company guard must let admin_create_user place the new user in a company even when
-- the caller is a company admin (it already forces that company to be the caller's own).
CREATE OR REPLACE FUNCTION public.guard_profile_client_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND COALESCE(current_setting('app.allow_user_creation', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.client_id := NULL;
    ELSE
      NEW.client_id := OLD.client_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_user(
  _email TEXT, _password TEXT, _name TEXT, _role TEXT, _client_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin BOOLEAN := public.has_role(auth.uid(), 'admin');
  target_client UUID := _client_id;
  new_id UUID := gen_random_uuid();
  clean_email TEXT := lower(trim(COALESCE(_email, '')));
  clean_name TEXT := NULLIF(trim(COALESCE(_name, '')), '');
BEGIN
  IF _role NOT IN ('admin', 'company_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF NOT caller_is_admin THEN
    IF NOT public.is_company_admin() THEN
      RAISE EXCEPTION 'Only administrators can create users' USING ERRCODE = '42501';
    END IF;
    IF _role = 'admin' THEN
      RAISE EXCEPTION 'Company administrators cannot create TaxForYou administrators' USING ERRCODE = '42501';
    END IF;
    target_client := public.my_client_id();
  END IF;

  IF _role = 'admin' THEN
    target_client := NULL;
  ELSIF target_client IS NULL THEN
    RAISE EXCEPTION 'Choose the company this user belongs to';
  ELSIF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = target_client AND parent_id IS NULL) THEN
    RAISE EXCEPTION 'Company not found';
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

  PERFORM set_config('app.allow_user_creation', 'on', true);

  -- Same shape Supabase Auth writes for an email/password account (confirmed, so they can sign in
  -- straight away with the password the administrator hands them).
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

  -- handle_new_user already created the profile; place it in its company.
  UPDATE public.profiles SET client_id = target_client WHERE user_id = new_id;
  IF _role <> 'user' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new_id, _role::public.app_role);
  END IF;

  PERFORM set_config('app.allow_user_creation', 'off', true);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- One role per user: admin / company_admin / user (= no role row).
CREATE OR REPLACE FUNCTION public.admin_set_user_role(_user_id UUID, _role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _role NOT IN ('admin', 'company_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;
  IF NOT public.can_manage_user(_user_id) THEN
    RAISE EXCEPTION 'You cannot manage this user' USING ERRCODE = '42501';
  END IF;
  IF _role = 'admin' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only TaxForYou administrators can grant that role' USING ERRCODE = '42501';
  END IF;
  IF _role = 'company_admin' AND (SELECT client_id FROM public.profiles WHERE user_id = _user_id) IS NULL THEN
    RAISE EXCEPTION 'Assign the user to a company first';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin', 'company_admin');
  IF _role <> 'user' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role::public.app_role);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;

-- --- Existing admin tools now also work for company admins, scoped to their own users ---------
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
  ELSIF public.is_company_admin() THEN
    RETURN QUERY
      SELECT u.id, u.email::TEXT, u.last_sign_in_at, u.created_at
      FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
      WHERE p.client_id = public.my_client_id()
      ORDER BY u.created_at DESC;
  ELSE
    RAISE EXCEPTION 'Only administrators can list users' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_password(_user_id UUID, _new_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_user(_user_id) THEN
    RAISE EXCEPTION 'You cannot change this user''s password' USING ERRCODE = '42501';
  END IF;
  IF _new_password IS NULL OR length(_new_password) < 8 THEN
    RAISE EXCEPTION 'The password must be at least 8 characters long';
  END IF;
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(_new_password, extensions.gen_salt('bf')), updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;
  IF NOT public.can_manage_user(_user_id) THEN
    RAISE EXCEPTION 'You cannot delete this user' USING ERRCODE = '42501';
  END IF;
  UPDATE public.annual_summaries SET user_id = auth.uid() WHERE user_id = _user_id;
  UPDATE public.reports SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.clients SET created_by = NULL WHERE created_by = _user_id;
  DELETE FROM auth.users WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;
