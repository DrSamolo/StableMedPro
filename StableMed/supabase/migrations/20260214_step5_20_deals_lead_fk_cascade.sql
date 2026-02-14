-- =============================================================================
-- STEP 5.20 - Ensure deals.lead_id cascades on lead deletion (one-way)
-- =============================================================================

BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS lead_id UUID;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_lead_id_fkey;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_lead_id_fkey
  FOREIGN KEY (lead_id)
  REFERENCES public.leads(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON public.deals(lead_id);

COMMIT;
