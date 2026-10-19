-- Admin tools for TaxForYou (owner of the app): see every login's email, set a new password for
-- someone who lost theirs, and delete a customer company together with everything filed under it.
-- All three are SECURITY DEFINER (they touch auth.users / bypass RLS), so each one checks for the
-- admin role itself before doing anything.

-- ---------------------------------------------------------------------------------------------
-- Users with their login email (profiles has no email column; it lives in auth.users)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (user_id UUID, email TEXT, last_sign_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can list users' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::TEXT, u.last_sign_in_at, u.created_at
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Set a user's password (e.g. Luisa lost hers). Same bcrypt format Supabase Auth itself writes.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_password(_user_id UUID, _new_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change passwords' USING ERRCODE = '42501';
  END IF;
  IF _new_password IS NULL OR length(_new_password) < 8 THEN
    RAISE EXCEPTION 'The password must be at least 8 characters long';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Delete a company with its sub-companies, statements, annual summaries and saved-report rows,
-- in one transaction. Users assigned to it are left without a company (not deleted). The report
-- FILES in storage are removed by the app through the Storage API first (storage rows can't be
-- deleted from SQL).
-- ---------------------------------------------------------------------------------------------
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete companies' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(id) INTO ids FROM public.clients WHERE id = _client_id OR parent_id = _client_id;
  IF ids IS NULL OR NOT (_client_id = ANY (ids)) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  DELETE FROM public.reports
  WHERE client_id = ANY (ids)
     OR analysis_id IN (SELECT id FROM public.analyses WHERE client_id = ANY (ids));
  DELETE FROM public.annual_summaries WHERE client_id = ANY (ids);
  DELETE FROM public.analyses WHERE client_id = ANY (ids);
  GET DIAGNOSTICS n_analyses = ROW_COUNT;
  UPDATE public.profiles SET client_id = NULL WHERE client_id = ANY (ids);
  DELETE FROM public.clients WHERE parent_id = _client_id;
  DELETE FROM public.clients WHERE id = _client_id;

  RETURN jsonb_build_object('statements', n_analyses, 'sub_companies', array_length(ids, 1) - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_client(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_client(UUID) TO authenticated;
