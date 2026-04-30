-- STEP 5.40 - Visibilite representant sur details de vente gagnante
-- Objectif:
-- - Autoriser la lecture de public.deal_win_details pour les representants
--   lorsqu'ils ont acces au deal via can_representant_access_deal.

BEGIN;

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
        OR (
          NOT public.is_representant(auth.uid())
          AND (
            d.owner_id = auth.uid()
            OR public.is_manager_same_team(auth.uid(), d.owner_id)
          )
        )
        OR (
          public.is_representant(auth.uid())
          AND public.can_representant_access_deal(auth.uid(), d.id)
        )
      )
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
