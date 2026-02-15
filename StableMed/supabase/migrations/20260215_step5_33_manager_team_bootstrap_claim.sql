-- =============================================================================
-- STEP 5.33 - Allow manager to claim own team when currently unassigned
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_user_team_v2(
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
  actor_team UUID;
  target_role TEXT;
  target_team UUID;
  updated_user_id UUID;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  SELECT lower(trim(COALESCE(p.role, ''))), p.team_id
  INTO actor_role, actor_team
  FROM public.profiles p
  WHERE p.id = actor_id;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur cible invalide';
  END IF;

  SELECT lower(trim(COALESCE(p.role, ''))), p.team_id
  INTO target_role, target_team
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable';
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Equipe cible introuvable';
  END IF;

  IF actor_role = 'admin' THEN
    UPDATE public.profiles p
    SET team_id = p_team_id
    WHERE p.id = p_user_id
    RETURNING p.id INTO updated_user_id;
  ELSIF actor_role = 'manager' THEN
    IF actor_team IS NULL THEN
      -- Bootstrap: manager can set his own team once when currently unassigned.
      IF p_user_id = actor_id AND p_team_id IS NOT NULL THEN
        UPDATE public.profiles p
        SET team_id = p_team_id
        WHERE p.id = actor_id
          AND p.team_id IS NULL
        RETURNING p.id INTO updated_user_id;
      ELSE
        RAISE EXCEPTION 'Manager sans equipe';
      END IF;
    ELSE
      IF p_team_id IS DISTINCT FROM actor_team THEN
        RAISE EXCEPTION 'Un manager ne peut affecter qu''a son equipe';
      END IF;
      IF target_role = 'admin' THEN
        RAISE EXCEPTION 'Impossible d''affecter un admin';
      END IF;
      IF target_team IS NOT NULL THEN
        RAISE EXCEPTION 'Un manager ne peut affecter que des utilisateurs sans equipe';
      END IF;

      UPDATE public.profiles p
      SET team_id = actor_team
      WHERE p.id = p_user_id
        AND p.team_id IS NULL
      RETURNING p.id INTO updated_user_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Acces reserve aux admins et managers';
  END IF;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'Aucune modification appliquee';
  END IF;

  RETURN updated_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_user_team_v2(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_user_team_v2(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_team_v2(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
