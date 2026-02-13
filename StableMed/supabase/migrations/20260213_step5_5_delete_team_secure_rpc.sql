-- =============================================================================
-- STEP 5.5 - Secure team deletion RPC (admin-only)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_team_secure(
  p_team_id UUID,
  p_reassign_team_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  moved_profiles INTEGER := 0;
  moved_invitations INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'Equipe cible invalide';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id) THEN
    RAISE EXCEPTION 'Equipe introuvable';
  END IF;

  IF p_reassign_team_id IS NOT NULL THEN
    IF p_reassign_team_id = p_team_id THEN
      RAISE EXCEPTION 'La reassignment doit pointer vers une autre equipe';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_reassign_team_id) THEN
      RAISE EXCEPTION 'Equipe de reassignment introuvable';
    END IF;
  END IF;

  UPDATE public.profiles p
  SET team_id = p_reassign_team_id
  WHERE p.team_id = p_team_id;
  GET DIAGNOSTICS moved_profiles = ROW_COUNT;

  UPDATE public.invitations i
  SET team_id = p_reassign_team_id
  WHERE i.team_id = p_team_id
    AND i.used_at IS NULL;
  GET DIAGNOSTICS moved_invitations = ROW_COUNT;

  -- chat_channels(team_id) is configured with ON DELETE CASCADE.
  DELETE FROM public.teams t
  WHERE t.id = p_team_id;

  RETURN jsonb_build_object(
    'deleted_team_id', p_team_id,
    'reassigned_team_id', p_reassign_team_id,
    'moved_profiles', moved_profiles,
    'moved_invitations', moved_invitations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_team_secure(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_team_secure(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_team_secure(UUID, UUID) TO service_role;

COMMIT;
