CREATE TABLE IF NOT EXISTS public.pill_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pill_id UUID REFERENCES public.pillfinder(id) ON DELETE CASCADE,
  draft_data JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'rejected')),
  created_by UUID REFERENCES public.admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.admin_users(id),
  review_notes TEXT
);

ALTER TABLE public.pill_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "pill_drafts_admin_select" ON public.pill_drafts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid() AND is_active = true)
  );

CREATE POLICY IF NOT EXISTS "pill_drafts_editor_insert" ON public.pill_drafts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id = auth.uid() AND role IN ('superadmin','editor','reviewer') AND is_active = true
    )
  );

CREATE POLICY IF NOT EXISTS "pill_drafts_editor_update" ON public.pill_drafts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id = auth.uid() AND role IN ('superadmin','editor','reviewer') AND is_active = true
    )
  );
