-- =============================================================================
-- STEP 5.26 - Atomic invitation signup finalization (role/team + consume)
-- =============================================================================

BEGIN;

-- Allow invitation finalization function to update role safely.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_setting('app.allow_invitation_role_sync', true) = 'on' THEN
      RETURN NEW;
    END IF;

    IF auth.role() <> 'service_role' AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only admins can modify roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_invitation_signup(
  p_token UUID,
  p_full_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_email TEXT;
  invitation_row public.invitations%ROWTYPE;
  normalized_role TEXT;
  invitation_id UUID;
  effective_full_name TEXT;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token invitation invalide';
  END IF;

  SELECT u.email
  INTO actor_email
  FROM auth.users u
  WHERE u.id = actor_id;

  IF actor_email IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  SELECT i.*
  INTO invitation_row
  FROM public.invitations i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;

  IF lower(trim(actor_email)) <> lower(trim(invitation_row.email)) THEN
    RAISE EXCEPTION 'Cette invitation ne correspond pas a votre email';
  END IF;

  normalized_role := lower(trim(COALESCE(invitation_row.role, 'commercial')));
  IF normalized_role NOT IN ('admin', 'manager', 'commercial') THEN
    normalized_role := 'commercial';
  END IF;

  effective_full_name := NULLIF(trim(COALESCE(p_full_name, '')), '');

  PERFORM set_config('app.allow_invitation_role_sync', 'on', true);

  INSERT INTO public.profiles (id, email, full_name, role, team_id)
  VALUES (
    actor_id,
    invitation_row.email,
    COALESCE(
      effective_full_name,
      split_part(COALESCE(invitation_row.email, ''), '@', 1),
      'Utilisateur'
    ),
    normalized_role,
    invitation_row.team_id
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(effective_full_name, public.profiles.full_name, EXCLUDED.full_name),
    role = normalized_role,
    team_id = invitation_row.team_id;

  UPDATE public.invitations i
  SET used_at = timezone('utc'::text, now())
  WHERE i.id = invitation_row.id
  RETURNING i.id INTO invitation_id;

  IF invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;

  RETURN invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) TO service_role;

COMMIT;
