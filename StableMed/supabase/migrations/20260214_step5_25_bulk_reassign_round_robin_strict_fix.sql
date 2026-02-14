-- =============================================================================
-- STEP 5.25 - Strict deterministic round-robin for bulk lead reassignment
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
  normalized_target_user_ids UUID[];
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

  -- Preserve caller order and drop duplicates for deterministic cycling.
  SELECT ARRAY_AGG(x.user_id ORDER BY x.first_ord)
  INTO normalized_target_user_ids
  FROM (
    SELECT t.user_id, MIN(t.ord)::INT AS first_ord
    FROM unnest(p_target_user_ids) WITH ORDINALITY AS t(user_id, ord)
    GROUP BY t.user_id
  ) x;

  IF COALESCE(array_length(normalized_target_user_ids, 1), 0) = 0 THEN
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
    WHERE p.id = ANY(normalized_target_user_ids)
      AND (p.team_id IS NULL OR p.team_id <> actor_team);

    IF invalid_targets > 0 THEN
      RAISE EXCEPTION 'Vous ne pouvez assigner que des membres de votre equipe';
    END IF;
  END IF;

  WITH lead_input AS (
    SELECT t.lead_id, MIN(t.ord)::INT AS first_ord
    FROM unnest(p_lead_ids) WITH ORDINALITY AS t(lead_id, ord)
    GROUP BY t.lead_id
  ),
  ordered_leads AS (
    SELECT li.lead_id, ROW_NUMBER() OVER (ORDER BY li.first_ord) AS seq
    FROM lead_input li
  ),
  assignments AS (
    SELECT
      ol.lead_id,
      normalized_target_user_ids[((ol.seq - 1) % array_length(normalized_target_user_ids, 1)) + 1] AS user_id
    FROM ordered_leads ol
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
