-- =============================================================================
-- STEP 5.7 - Lead <-> Trainings association table + scoped RLS
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_trainings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT lead_trainings_unique_lead_training UNIQUE (lead_id, training_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_trainings_lead_id
  ON public.lead_trainings(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_trainings_training_id
  ON public.lead_trainings(training_id);

ALTER TABLE public.lead_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_trainings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_trainings_select_scoped ON public.lead_trainings;
CREATE POLICY lead_trainings_select_scoped ON public.lead_trainings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = lead_trainings.lead_id
        AND (
          public.is_admin(auth.uid())
          OR l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles lead_owner ON lead_owner.id = l.user_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = lead_owner.team_id
          )
        )
    )
  );

DROP POLICY IF EXISTS lead_trainings_manage_scoped ON public.lead_trainings;
CREATE POLICY lead_trainings_manage_scoped ON public.lead_trainings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = lead_trainings.lead_id
        AND (
          public.is_admin(auth.uid())
          OR l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles lead_owner ON lead_owner.id = l.user_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = lead_owner.team_id
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = lead_trainings.lead_id
        AND (
          public.is_admin(auth.uid())
          OR l.user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles lead_owner ON lead_owner.id = l.user_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = lead_owner.team_id
          )
        )
    )
  );

COMMIT;
