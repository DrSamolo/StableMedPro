-- =============================================================================
-- STEP 5.2 - Profiles reliability: backfill missing rows + auth.users trigger
-- =============================================================================

BEGIN;

-- Backfill profiles for existing auth users that still do not have a profile row.
INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(trim((u.raw_user_meta_data ->> 'full_name')::text), ''),
    split_part(COALESCE(u.email, ''), '@', 1),
    'Utilisateur'
  ) AS full_name,
  'commercial'::text AS role
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- Ensure auth trigger exists so every new auth user gets a profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(trim((NEW.raw_user_meta_data ->> 'full_name')::text), ''),
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'Utilisateur'
    ),
    'commercial'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user();

COMMIT;

