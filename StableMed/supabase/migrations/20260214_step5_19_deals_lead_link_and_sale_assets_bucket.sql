-- =============================================================================
-- STEP 5.19 - Deals <-> Leads link + storage bucket for sale evidence assets
-- =============================================================================

BEGIN;

-- Ensure deals can be linked to a lead.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS lead_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deals_lead_id_fkey'
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_lead_id_fkey
      FOREIGN KEY (lead_id)
      REFERENCES public.leads(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON public.deals(lead_id);

-- Storage bucket for audio/photo evidence captured during won-sale workflow.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sale-assets', 'sale-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload/read/update/delete their own sale assets.
DROP POLICY IF EXISTS sale_assets_read ON storage.objects;
CREATE POLICY sale_assets_read
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'sale-assets');

DROP POLICY IF EXISTS sale_assets_insert ON storage.objects;
CREATE POLICY sale_assets_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'sale-assets'
  AND auth.uid() IS NOT NULL
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS sale_assets_update ON storage.objects;
CREATE POLICY sale_assets_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'sale-assets'
  AND auth.uid() IS NOT NULL
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'sale-assets'
  AND auth.uid() IS NOT NULL
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS sale_assets_delete ON storage.objects;
CREATE POLICY sale_assets_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'sale-assets'
  AND auth.uid() IS NOT NULL
  AND split_part(name, '/', 1) = auth.uid()::text
);

COMMIT;
