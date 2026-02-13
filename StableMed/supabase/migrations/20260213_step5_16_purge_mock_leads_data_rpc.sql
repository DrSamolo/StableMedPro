-- =============================================================================
-- STEP 5.16 - Purge mock/perf leads data (admin RPC)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_mock_leads_data(
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_comments INTEGER := 0;
  deleted_leads INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF COALESCE(p_confirmation, '') <> 'PURGE_MOCK_LEADS' THEN
    RAISE EXCEPTION 'Confirmation invalide (attendu: PURGE_MOCK_LEADS)';
  END IF;

  WITH mock_leads AS (
    SELECT l.id
    FROM public.leads l
    WHERE (l.email IS NOT NULL AND l.email ILIKE '%@example.test')
       OR (l.first_name IS NOT NULL AND l.first_name ILIKE 'Lead%')
       OR (l.last_name IS NOT NULL AND l.last_name ILIKE 'User%')
       OR (l.name IS NOT NULL AND l.name ~* '^Lead[0-9a-z]+\\d*\\s+User\\d+$')
       OR (l.client_reference IS NOT NULL AND l.client_reference ~ '^REF-[0-9a-z]+-[0-9]+$')
  )
  DELETE FROM public.comments c
  USING mock_leads ml
  WHERE c.lead_id = ml.id;
  GET DIAGNOSTICS deleted_comments = ROW_COUNT;

  WITH mock_leads AS (
    SELECT l.id
    FROM public.leads l
    WHERE (l.email IS NOT NULL AND l.email ILIKE '%@example.test')
       OR (l.first_name IS NOT NULL AND l.first_name ILIKE 'Lead%')
       OR (l.last_name IS NOT NULL AND l.last_name ILIKE 'User%')
       OR (l.name IS NOT NULL AND l.name ~* '^Lead[0-9a-z]+\\d*\\s+User\\d+$')
       OR (l.client_reference IS NOT NULL AND l.client_reference ~ '^REF-[0-9a-z]+-[0-9]+$')
  )
  DELETE FROM public.leads l
  USING mock_leads ml
  WHERE l.id = ml.id;
  GET DIAGNOSTICS deleted_leads = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_mock_leads', deleted_leads,
    'deleted_related_comments', deleted_comments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_mock_leads_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_mock_leads_data(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_mock_leads_data(TEXT) TO service_role;

COMMIT;

