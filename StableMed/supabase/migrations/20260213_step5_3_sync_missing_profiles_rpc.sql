-- =============================================================================
-- STEP 5.3 - Admin RPC to sync missing profiles from auth.users
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_missing_profiles_from_auth()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  WITH missing_users AS (
    SELECT
      u.id,
      u.email,
      COALESCE(
        NULLIF(trim((u.raw_user_meta_data ->> 'full_name')::text), ''),
        split_part(COALESCE(u.email, ''), '@', 1),
        'Utilisateur'
      ) AS full_name
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  ),
  inserted AS (
    INSERT INTO public.profiles (id, email, full_name, role)
    SELECT
      m.id,
      m.email,
      m.full_name,
      'commercial'
    FROM missing_users m
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_missing_profiles_from_auth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_missing_profiles_from_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_missing_profiles_from_auth() TO service_role;

COMMIT;

