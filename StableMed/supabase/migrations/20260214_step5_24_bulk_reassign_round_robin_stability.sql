-- =============================================================================
-- STEP 5.24 - Stabilize bulk round-robin reassignment ordering
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
    SELECT lead_id, MIN(ord)::INT AS rn
    FROM unnest(p_lead_ids) WITH ORDINALITY AS t(lead_id, ord)
    GROUP BY lead_id
  ),
  target_users AS (
    SELECT user_id, MIN(ord)::INT AS rn
    FROM unnest(p_target_user_ids) WITH ORDINALITY AS t(user_id, ord)
    GROUP BY user_id
  ),
  target_count AS (
    SELECT COUNT(*)::INT AS cnt FROM target_users
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

COMMIT;
