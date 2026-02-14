-- =============================================================================
-- STEP 5.21 - Require proof_url for won-sale information capture
-- =============================================================================

BEGIN;

ALTER TABLE public.deal_win_details
  DROP CONSTRAINT IF EXISTS deal_win_details_proof_url_required;

ALTER TABLE public.deal_win_details
  ADD CONSTRAINT deal_win_details_proof_url_required
  CHECK (proof_url IS NOT NULL AND btrim(proof_url) <> '')
  NOT VALID;

COMMIT;
