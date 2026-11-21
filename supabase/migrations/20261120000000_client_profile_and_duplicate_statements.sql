-- 1) Client profile: the client is the business (its name is the company name), with its owner,
--    industry and what it sells, plus whether it has cost of sales at all (a one-owner service
--    business usually doesn't: its COGS-type costs are reported as operating expenses).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS has_cogs BOOLEAN NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS public.create_client(TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_client(
  _name TEXT,
  _company TEXT DEFAULT NULL,
  _email TEXT DEFAULT NULL,
  _phone TEXT DEFAULT NULL,
  _owner TEXT DEFAULT NULL,
  _industry TEXT DEFAULT NULL,
  _description TEXT DEFAULT NULL,
  _has_cogs BOOLEAN DEFAULT true
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
  IF length(trim(COALESCE(_name, ''))) = 0 THEN
    RAISE EXCEPTION 'The company name is required';
  END IF;
  IF length(trim(COALESCE(_name, ''))) > 150 OR length(COALESCE(_company, '')) > 150
     OR length(COALESCE(_email, '')) > 150 OR length(COALESCE(_phone, '')) > 40
     OR length(COALESCE(_owner, '')) > 150 OR length(COALESCE(_industry, '')) > 150
     OR length(COALESCE(_description, '')) > 1000 THEN
    RAISE EXCEPTION 'A client field is too long';
  END IF;
  INSERT INTO public.clients (name, company, email, phone, owner_name, industry, description, has_cogs, created_by)
  VALUES (
    trim(_name),
    NULLIF(trim(COALESCE(_company, '')), ''),
    NULLIF(trim(COALESCE(_email, '')), ''),
    NULLIF(trim(COALESCE(_phone, '')), ''),
    NULLIF(trim(COALESCE(_owner, '')), ''),
    NULLIF(trim(COALESCE(_industry, '')), ''),
    NULLIF(trim(COALESCE(_description, '')), ''),
    COALESCE(_has_cogs, true),
    auth.uid()
  )
  RETURNING id INTO new_id;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    INSERT INTO public.client_access (client_id, user_id, granted_by) VALUES (new_id, auth.uid(), auth.uid());
  END IF;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_client(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- 2) The same bank statement can't be in the system twice. `file_hash` is the SHA-256 of the
--    uploaded file; `statement_key` identifies the statement by what the bank printed (account, period
--    and opening/closing balances), so a re-downloaded copy of the same statement is caught too. Both
--    are unique across the whole system, whoever uploaded it.
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS file_hash TEXT,
  ADD COLUMN IF NOT EXISTS statement_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS analyses_file_hash_unique ON public.analyses (file_hash) WHERE file_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS analyses_statement_key_unique ON public.analyses (statement_key) WHERE statement_key IS NOT NULL;
