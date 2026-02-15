-- =============================================================================
-- STEP 5.31 - Reassert profiles.role normalization and guardrails
-- =============================================================================

BEGIN;

-- Normalize legacy/corrupt role values so existing RLS policies keep working.
UPDATE public.profiles
SET role = lower(trim(role))
WHERE role IS NOT NULL
  AND role <> lower(trim(role));

UPDATE public.profiles
SET role = 'commercial'
WHERE role IS NULL
   OR role NOT IN ('admin', 'manager', 'commercial');

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'commercial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_role_allowed'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_allowed
      CHECK (role IN ('admin', 'manager', 'commercial'));
  END IF;
END $$;

-- Keep future writes normalized even if an API path sends mixed-case values.
CREATE OR REPLACE FUNCTION public.normalize_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.role := lower(trim(COALESCE(NEW.role, 'commercial')));
  IF NEW.role NOT IN ('admin', 'manager', 'commercial') THEN
    NEW.role := 'commercial';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_normalize_role ON public.profiles;
CREATE TRIGGER trg_profiles_normalize_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_profile_role();

COMMIT;
