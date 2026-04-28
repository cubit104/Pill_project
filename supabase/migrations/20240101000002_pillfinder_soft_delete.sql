-- Add soft delete + audit columns to pillfinder
ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.admin_users(id);

CREATE INDEX IF NOT EXISTS idx_pillfinder_deleted_at
  ON public.pillfinder(deleted_at) WHERE deleted_at IS NULL;
