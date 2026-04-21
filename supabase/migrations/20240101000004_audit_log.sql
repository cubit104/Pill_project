CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  actor_id UUID REFERENCES public.admin_users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  diff JSONB,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON public.audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Append-only: no UPDATE, no DELETE
CREATE POLICY IF NOT EXISTS "audit_log_select_admin" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid() AND is_active = true)
  );

CREATE POLICY IF NOT EXISTS "audit_log_insert_service" ON public.audit_log
  FOR INSERT WITH CHECK (true);
-- Note: In production, restrict INSERT to service_role only via separate policy
