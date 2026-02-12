-- =============================================================================
-- STEP 1.3 - Profile role guardrails for server-side auth middleware
-- =============================================================================
-- Goals:
-- 1) Normalize existing profile roles to lowercase.
-- 2) Enforce allowed roles to keep middleware checks deterministic.

BEGIN;

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

COMMIT;
