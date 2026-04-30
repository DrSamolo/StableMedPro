-- STEP 5.39 - Stabilisation visibilité représentant (backfill + fallback d'accès)
-- Objectif:
-- 1) Combler les deals "won" sans liaison deal_trainings à partir de lead_trainings (non destructif).
-- 2) Durcir la logique d'accès représentant pour éviter les trous de visibilité si deal_trainings est incomplet.

BEGIN;

-- ---------------------------------------------------------------------------
-- Backfill non destructif: lier les deals gagnés à leurs trainings du lead
-- quand deal_trainings est vide ou partiel.
-- ---------------------------------------------------------------------------
INSERT INTO public.deal_trainings (deal_id, training_id)
SELECT DISTINCT d.id, lt.training_id
FROM public.deals d
INNER JOIN public.lead_trainings lt
  ON lt.lead_id = d.lead_id
LEFT JOIN public.deal_trainings existing
  ON existing.deal_id = d.id
 AND existing.training_id = lt.training_id
WHERE lower(trim(COALESCE(d.stage, ''))) = 'won'
  AND d.lead_id IS NOT NULL
  AND existing.deal_id IS NULL;

-- ---------------------------------------------------------------------------
-- Fallback d'accès représentant:
-- - priorité aux trainings liés directement au deal
-- - fallback via trainings du lead lié au deal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_representant_access_deal(
  p_actor_id UUID,
  p_deal_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deals d
    WHERE d.id = p_deal_id
      AND lower(trim(COALESCE(d.stage, ''))) = 'won'
      AND (
        EXISTS (
          SELECT 1
          FROM public.deal_trainings dt
          INNER JOIN public.trainings t ON t.id = dt.training_id
          WHERE dt.deal_id = d.id
            AND public.has_representant_organization_access(p_actor_id, t.organization)
        )
        OR EXISTS (
          SELECT 1
          FROM public.lead_trainings lt
          INNER JOIN public.trainings t ON t.id = lt.training_id
          WHERE d.lead_id IS NOT NULL
            AND lt.lead_id = d.lead_id
            AND public.has_representant_organization_access(p_actor_id, t.organization)
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_representant_access_deal(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_representant_access_deal(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_representant_access_deal(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

