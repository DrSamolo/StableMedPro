-- =============================================================================
-- STEP 5.18 - Capture des informations de vente gagnee (preuves + commentaires)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_win_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  session_label TEXT,
  first_connection_date DATE,
  first_connection_time TIME,
  first_connection_done BOOLEAN NOT NULL DEFAULT FALSE,
  recording_1_url TEXT,
  recording_1_file_ref TEXT,
  recording_2_url TEXT,
  recording_2_file_ref TEXT,
  proof_url TEXT,
  proof_file_ref TEXT,
  sale_comment TEXT,
  followup_comment TEXT,
  organization_comment TEXT,
  unsubscription_comment TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_deal_win_details_deal_id ON public.deal_win_details(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_win_details_created_at ON public.deal_win_details(created_at DESC);

ALTER TABLE public.deal_win_details ENABLE ROW LEVEL SECURITY;

-- Compatibility note:
-- some environments do not expose public.is_manager(uuid).
-- We therefore check manager role directly from public.profiles.

DROP POLICY IF EXISTS deal_win_details_select_scoped ON public.deal_win_details;
CREATE POLICY deal_win_details_select_scoped
ON public.deal_win_details
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.deals d
    WHERE d.id = deal_win_details.deal_id
      AND (
        public.is_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'manager'
        )
        OR d.owner_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS deal_win_details_insert_scoped ON public.deal_win_details;
CREATE POLICY deal_win_details_insert_scoped
ON public.deal_win_details
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.deals d
    WHERE d.id = deal_win_details.deal_id
      AND (
        public.is_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'manager'
        )
        OR d.owner_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS deal_win_details_update_scoped ON public.deal_win_details;
CREATE POLICY deal_win_details_update_scoped
ON public.deal_win_details
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'manager'
  )
)
WITH CHECK (
  created_by = auth.uid()
  OR public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'manager'
  )
);

DROP POLICY IF EXISTS deal_win_details_delete_scoped ON public.deal_win_details;
CREATE POLICY deal_win_details_delete_scoped
ON public.deal_win_details
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  OR public.is_admin(auth.uid())
);

COMMIT;
