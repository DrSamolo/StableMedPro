-- =============================================================================
-- STEP 5.28 - Reliable admin team assignment RPC
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_user_team(
  p_user_id UUID,
  p_team_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  updated_user_id UUID;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  SELECT lower(trim(COALESCE(p.role, '')))
  INTO actor_role
  FROM public.profiles p
  WHERE p.id = actor_id;

  IF actor_role <> 'admin' THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur cible invalide';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable';
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Equipe cible introuvable';
  END IF;

  UPDATE public.profiles p
  SET team_id = p_team_id
  WHERE p.id = p_user_id
  RETURNING p.id INTO updated_user_id;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'Aucune modification appliquee';
  END IF;

  RETURN updated_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_user_team(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_user_team(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_team(UUID, UUID) TO service_role;

COMMIT;
