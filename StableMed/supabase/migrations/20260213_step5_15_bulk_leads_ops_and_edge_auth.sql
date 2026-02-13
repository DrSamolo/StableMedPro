-- =============================================================================
-- STEP 5.15 - Bulk leads ops RPC + edge-call auth hardening helpers
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_reassign_leads(
  p_lead_ids UUID[],
  p_target_user_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  actor_team UUID;
  updated_count INTEGER := 0;
  invalid_leads INTEGER := 0;
  invalid_targets INTEGER := 0;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  SELECT p.role, p.team_id
  INTO actor_role, actor_team
  FROM public.profiles p
  WHERE p.id = actor_id;

  IF actor_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Acces reserve aux admins et managers';
  END IF;

  IF COALESCE(array_length(p_lead_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Aucun lead fourni';
  END IF;

  IF COALESCE(array_length(p_target_user_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Aucune cible de reassignment';
  END IF;

  IF actor_role = 'manager' THEN
    SELECT COUNT(*)
    INTO invalid_leads
    FROM public.leads l
    LEFT JOIN public.profiles owner ON owner.id = l.user_id
    WHERE l.id = ANY(p_lead_ids)
      AND (owner.team_id IS NULL OR owner.team_id <> actor_team);

    IF invalid_leads > 0 THEN
      RAISE EXCEPTION 'Vous ne pouvez reassigner que les leads de votre equipe';
    END IF;

    SELECT COUNT(*)
    INTO invalid_targets
    FROM public.profiles p
    WHERE p.id = ANY(p_target_user_ids)
      AND (p.team_id IS NULL OR p.team_id <> actor_team);

    IF invalid_targets > 0 THEN
      RAISE EXCEPTION 'Vous ne pouvez assigner que des membres de votre equipe';
    END IF;
  END IF;

  WITH lead_list AS (
    SELECT unnest(p_lead_ids) AS lead_id, row_number() OVER () AS rn
  ),
  target_users AS (
    SELECT unnest(p_target_user_ids) AS user_id, row_number() OVER () AS rn
  ),
  target_count AS (
    SELECT COUNT(*) AS cnt FROM target_users
  ),
  assignments AS (
    SELECT l.lead_id, t.user_id
    FROM lead_list l
    CROSS JOIN target_count c
    JOIN target_users t ON t.rn = ((l.rn - 1) % c.cnt) + 1
  )
  UPDATE public.leads l
  SET user_id = a.user_id
  FROM assignments a
  WHERE l.id = a.lead_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_reassign_leads(UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_reassign_leads(UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_reassign_leads(UUID[], UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.bulk_delete_leads(
  p_lead_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  actor_team UUID;
  role_can_delete BOOLEAN := FALSE;
  invalid_leads INTEGER := 0;
  deleted_count INTEGER := 0;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  SELECT p.role, p.team_id
  INTO actor_role, actor_team
  FROM public.profiles p
  WHERE p.id = actor_id;

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable';
  END IF;

  SELECT COALESCE((rp.permissions->>'can_delete_leads')::BOOLEAN, FALSE)
  INTO role_can_delete
  FROM public.role_permissions rp
  WHERE rp.role = actor_role;

  IF actor_role <> 'admin' AND NOT role_can_delete THEN
    RAISE EXCEPTION 'Suppression non autorisee pour votre role';
  END IF;

  IF COALESCE(array_length(p_lead_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Aucun lead fourni';
  END IF;

  IF actor_role = 'manager' THEN
    SELECT COUNT(*)
    INTO invalid_leads
    FROM public.leads l
    LEFT JOIN public.profiles owner ON owner.id = l.user_id
    WHERE l.id = ANY(p_lead_ids)
      AND (owner.team_id IS NULL OR owner.team_id <> actor_team);

    IF invalid_leads > 0 THEN
      RAISE EXCEPTION 'Vous ne pouvez supprimer que les leads de votre equipe';
    END IF;
  END IF;

  DELETE FROM public.comments c
  WHERE c.lead_id = ANY(p_lead_ids);

  DELETE FROM public.leads l
  WHERE l.id = ANY(p_lead_ids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_delete_leads(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_delete_leads(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete_leads(UUID[]) TO service_role;

COMMIT;
