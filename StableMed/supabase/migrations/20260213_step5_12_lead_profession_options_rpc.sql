-- =============================================================================
-- STEP 5.12 - Lead profession options RPC (server-side distinct)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_lead_profession_options(
  p_selected_user_id UUID DEFAULT NULL,
  p_selected_team_id UUID DEFAULT NULL
)
RETURNS TABLE (
  profession TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT trim(COALESCE(NULLIF(l.profession, ''), NULLIF(l.specialty, ''))) AS profession
  FROM public.leads l
  LEFT JOIN public.profiles p ON p.id = l.user_id
  WHERE (
      p_selected_user_id IS NULL
      OR l.user_id = p_selected_user_id
    )
    AND (
      p_selected_team_id IS NULL
      OR p.team_id = p_selected_team_id
    )
    AND trim(COALESCE(NULLIF(l.profession, ''), NULLIF(l.specialty, ''))) IS NOT NULL
  ORDER BY 1 ASC;
$$;

REVOKE ALL ON FUNCTION public.get_lead_profession_options(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lead_profession_options(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_profession_options(UUID, UUID) TO service_role;

COMMIT;

