-- =============================================================================
-- STEP 5.22 - Training hybrid format breakdown hours
-- =============================================================================

BEGIN;

ALTER TABLE public.trainings
  ADD COLUMN IF NOT EXISTS e_learning_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS epp_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS virtual_class_hours NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trainings_e_learning_hours_non_negative'
  ) THEN
    ALTER TABLE public.trainings
      ADD CONSTRAINT trainings_e_learning_hours_non_negative CHECK (e_learning_hours IS NULL OR e_learning_hours >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trainings_epp_hours_non_negative'
  ) THEN
    ALTER TABLE public.trainings
      ADD CONSTRAINT trainings_epp_hours_non_negative CHECK (epp_hours IS NULL OR epp_hours >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trainings_virtual_class_hours_non_negative'
  ) THEN
    ALTER TABLE public.trainings
      ADD CONSTRAINT trainings_virtual_class_hours_non_negative CHECK (virtual_class_hours IS NULL OR virtual_class_hours >= 0);
  END IF;
END $$;

COMMIT;
