-- STEP 5.38 - Fix visibilité représentant sur leads gagnés
-- Le représentant doit voir les leads liés à des opportunités "won"
-- de ses organismes, même si le status du lead n'est pas "won".

BEGIN;

CREATE OR REPLACE FUNCTION public.can_representant_access_lead(
  p_actor_id UUID,
  p_lead_id UUID
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
    WHERE d.lead_id = p_lead_id
      AND lower(trim(COALESCE(d.stage, ''))) = 'won'
      AND public.can_representant_access_deal(p_actor_id, d.id)
  )
$$;

REVOKE ALL ON FUNCTION public.can_representant_access_lead(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_representant_access_lead(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_representant_access_lead(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
