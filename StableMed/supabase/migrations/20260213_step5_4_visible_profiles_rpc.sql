-- =============================================================================
-- STEP 5.4 - Unified visible profiles RPC (admin/manager/commercial scopes)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_visible_profiles()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT,
  team_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT
      auth.uid() AS actor_id,
      p.role AS actor_role,
      p.team_id AS actor_team_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1
  )
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.avatar_url,
    p.role,
    p.team_id,
    p.created_at
  FROM public.profiles p
  CROSS JOIN me
  WHERE me.actor_id IS NOT NULL
    AND (
      me.actor_role = 'admin'
      OR (me.actor_role = 'manager' AND p.team_id IS NOT DISTINCT FROM me.actor_team_id)
      OR p.id = me.actor_id
    )
  ORDER BY COALESCE(NULLIF(trim(p.full_name), ''), p.email, p.id::text);
$$;

REVOKE ALL ON FUNCTION public.get_visible_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_profiles() TO service_role;

COMMIT;

