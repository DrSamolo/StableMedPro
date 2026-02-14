-- =============================================================================
-- STEP 5.23 - Trainings RLS hardening (admin-only writes)
-- =============================================================================

BEGIN;

ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trainings_select_authenticated ON public.trainings;
DROP POLICY IF EXISTS trainings_admin_manage ON public.trainings;
DROP POLICY IF EXISTS trainings_insert_admin_only ON public.trainings;
DROP POLICY IF EXISTS trainings_update_admin_only ON public.trainings;
DROP POLICY IF EXISTS trainings_delete_admin_only ON public.trainings;

-- Everyone authenticated can read the catalog.
CREATE POLICY trainings_select_authenticated ON public.trainings
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can create catalog entries.
CREATE POLICY trainings_insert_admin_only ON public.trainings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

-- Only admins can update catalog entries.
CREATE POLICY trainings_update_admin_only ON public.trainings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Only admins can delete catalog entries.
CREATE POLICY trainings_delete_admin_only ON public.trainings
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

COMMIT;
