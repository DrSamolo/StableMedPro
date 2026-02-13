-- =============================================================================
-- STEP 5.14 - Security + performance hardening (invitations + leads indexes)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- INVITATIONS: remove public read policy and expose only a constrained RPC
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS invitations_public_by_token ON public.invitations;

CREATE OR REPLACE FUNCTION public.get_invitation_signup_context(
  p_token UUID
)
RETURNS TABLE (
  email TEXT,
  role TEXT,
  team_id UUID,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token invitation invalide';
  END IF;

  RETURN QUERY
  SELECT i.email, i.role, i.team_id, i.expires_at
  FROM public.invitations i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_signup_context(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_signup_context(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_signup_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_signup_context(UUID) TO service_role;

-- Harden consume flow with explicit expiration check.
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
    AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()))
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

-- -----------------------------------------------------------------------------
-- LEADS: indexes for paginated listing and large-volume filtering
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token_unique ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_used_expires ON public.invitations(used_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_leads_created_at_desc ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status_created_at ON public.leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_user_status_created_at ON public.leads(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_profession_created_at ON public.leads(profession, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_specialty_created_at ON public.leads(specialty, created_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON public.leads USING gin (name gin_trgm_ops);

COMMIT;
