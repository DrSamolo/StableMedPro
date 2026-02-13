-- =============================================================================
-- STEP 5.10 - Consume invitation token RPC (invitee-safe)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_invitation_token(
  p_token UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  invitation_id UUID;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token invitation invalide';
  END IF;

  UPDATE public.invitations i
  SET used_at = timezone('utc'::text, now())
  WHERE i.token = p_token
    AND i.used_at IS NULL
  RETURNING i.id INTO invitation_id;

  IF invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;

  RETURN invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_invitation_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_invitation_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invitation_token(UUID) TO service_role;

COMMIT;
