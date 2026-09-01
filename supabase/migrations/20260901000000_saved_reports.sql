-- Every generated PDF/Excel gets saved here too (not just downloaded to the browser), so it can be
-- reopened later without regenerating it — answers "¿a quién se le va a guardar el PDF?": it's
-- saved against the client (shared, same as everything else), not tucked away under whichever
-- user happened to click download.

-- Private bucket — access only through signed URLs generated on demand, never a public link.
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload reports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports');

CREATE POLICY "Authenticated users can read reports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reports');

CREATE POLICY "Authenticated users can delete reports"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reports');

-- Metadata so the UI can list what's saved without listing the storage bucket directly.
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id),
  analysis_id UUID REFERENCES public.analyses(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'excel')),
  period_label TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all reports"
  ON public.reports FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create reports"
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete reports"
  ON public.reports FOR DELETE TO authenticated
  USING (true);

CREATE INDEX reports_client_id_idx ON public.reports (client_id);
CREATE INDEX reports_analysis_id_idx ON public.reports (analysis_id);
