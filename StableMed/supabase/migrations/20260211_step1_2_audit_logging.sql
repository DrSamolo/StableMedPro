-- =============================================================================
-- STEP 1.2 - Logging & Traceability foundations
-- =============================================================================
-- Goals:
-- 1) Create a centralized audit_logs table.
-- 2) Log INSERT/UPDATE/DELETE on sensitive business tables.
-- 3) Keep audit reads restricted to admins/service role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select_admin_only ON public.audit_logs;
CREATE POLICY audit_logs_select_admin_only ON public.audit_logs
  FOR SELECT
  USING (auth.role() = 'service_role' OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.audit_log_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
BEGIN
  actor_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, old_data, new_data)
    VALUES (actor_id, TG_OP, TG_TABLE_NAME, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, old_data, new_data)
    VALUES (actor_id, TG_OP, TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, old_data, new_data)
    VALUES (actor_id, TG_OP, TG_TABLE_NAME, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  sensitive_table TEXT;
  trigger_name TEXT;
BEGIN
  FOREACH sensitive_table IN ARRAY ARRAY[
    'teams',
    'profiles',
    'leads',
    'deals',
    'trainings',
    'deal_trainings',
    'comments',
    'role_permissions',
    'invitations',
    'app_settings'
  ]
  LOOP
    IF to_regclass('public.' || sensitive_table) IS NULL THEN
      CONTINUE;
    END IF;

    trigger_name := 'trg_audit_' || sensitive_table;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', trigger_name, sensitive_table);
    EXECUTE format(
      'CREATE TRIGGER %I
       AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW
       EXECUTE FUNCTION public.audit_log_changes();',
      trigger_name,
      sensitive_table
    );
  END LOOP;
END $$;

COMMIT;
