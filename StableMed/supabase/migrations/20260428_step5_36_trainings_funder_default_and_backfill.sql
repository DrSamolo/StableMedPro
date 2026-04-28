-- STEP 5.36 - Financeur par defaut + backfill pour classement catalogue

ALTER TABLE public.trainings
  ALTER COLUMN funder SET DEFAULT 'DPC';

UPDATE public.trainings
SET funder = 'DPC'
WHERE funder IS NULL OR btrim(funder) = '';
