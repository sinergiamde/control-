-- A third fingerprint for "the same bank statement can't be in the system twice": what the statement
-- contains. `content_hash` is the SHA-256 of its transactions (month-day and amount of each one, sorted),
-- computed by the analyzer. It catches a re-downloaded or re-exported copy even when the AI read the
-- account number, period or balances differently the second time.
--
-- Older rows include one known duplicate the owner still has to decide about, so instead of a unique
-- index a trigger refuses any NEW row (or change) whose content is already in the system. It runs as
-- its owner, so it sees statements of every client, not only the ones the uploader can open.

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS analyses_content_hash_idx ON public.analyses (content_hash) WHERE content_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_duplicate_statement_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.analyses a WHERE a.content_hash = NEW.content_hash AND a.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'duplicate statement: this statement is already in the system'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analyses_reject_duplicate_content ON public.analyses;
CREATE TRIGGER analyses_reject_duplicate_content
  BEFORE INSERT OR UPDATE OF content_hash ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_statement_content();
