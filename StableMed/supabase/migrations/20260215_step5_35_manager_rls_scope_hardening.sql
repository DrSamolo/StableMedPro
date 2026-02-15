-- =============================================================================
-- STEP 5.35 - Manager RLS scope hardening (profiles/leads/deals)
-- =============================================================================

BEGIN;

-- Security-definer helpers avoid recursive/fragile RLS self-joins in policy expressions.
CREATE OR REPLACE FUNCTION public.get_profile_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(COALESCE(p.role, '')))
  FROM public.profiles p
  WHERE p.id = p_user_id
$$;

CREATE OR REPLACE FUNCTION public.get_profile_team_id(p_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.team_id
  FROM public.profiles p
  WHERE p.id = p_user_id
$$;

CREATE OR REPLACE FUNCTION public.is_manager_same_team(
  p_actor_id UUID,
  p_owner_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.get_profile_role(p_actor_id) = 'manager'
    AND public.get_profile_team_id(p_actor_id) IS NOT NULL
    AND public.get_profile_team_id(p_owner_id) IS NOT DISTINCT FROM public.get_profile_team_id(p_actor_id)
$$;

REVOKE ALL ON FUNCTION public.get_profile_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_role(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.get_profile_team_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_team_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_team_id(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.is_manager_same_team(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_manager_same_team(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_same_team(UUID, UUID) TO service_role;

-- Profiles: manager can read same-team members reliably.
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin(auth.uid())
    OR (
      public.get_profile_role(auth.uid()) = 'manager'
      AND public.get_profile_team_id(auth.uid()) IS NOT NULL
      AND team_id IS NOT DISTINCT FROM public.get_profile_team_id(auth.uid())
    )
  );

-- Leads policies: replace recursive profile joins with helper check.
DROP POLICY IF EXISTS leads_select_scoped ON public.leads;
CREATE POLICY leads_select_scoped ON public.leads
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS leads_insert_scoped ON public.leads;
CREATE POLICY leads_insert_scoped ON public.leads
  FOR INSERT
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS leads_update_scoped ON public.leads;
CREATE POLICY leads_update_scoped ON public.leads
  FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), user_id)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), user_id)
  );

-- Deals policies: same hardening.
DROP POLICY IF EXISTS deals_select_scoped ON public.deals;
CREATE POLICY deals_select_scoped ON public.deals
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), owner_id)
  );

DROP POLICY IF EXISTS deals_insert_scoped ON public.deals;
CREATE POLICY deals_insert_scoped ON public.deals
  FOR INSERT
  WITH CHECK (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), owner_id)
  );

DROP POLICY IF EXISTS deals_update_scoped ON public.deals;
CREATE POLICY deals_update_scoped ON public.deals
  FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), owner_id)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR public.is_manager_same_team(auth.uid(), owner_id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
