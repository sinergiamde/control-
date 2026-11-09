-- When an administrator sets a provisional password for someone, that person must choose their own
-- the next time they sign in: the app blocks everything else until they do.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

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
  -- A provisional password handed to someone else must be replaced by them at once.
  IF _user_id <> auth.uid() THEN
    UPDATE public.profiles SET must_change_password = true WHERE user_id = _user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles SET must_change_password = false WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.clear_must_change_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;
