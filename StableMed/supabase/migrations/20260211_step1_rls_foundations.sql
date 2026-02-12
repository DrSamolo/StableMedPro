-- =============================================================================
-- STEP 1.1 - Security Foundations: RLS hardening
-- =============================================================================
-- Goals:
-- 1) Enable RLS on every table in public schema.
-- 2) Restrict profile reads to self (admin exception for backoffice use).
-- 3) Ensure only admins can modify profile roles.
-- 4) Replace overly permissive authenticated-all policies.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: central admin check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = user_id
      AND p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Global RLS activation for all current public tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT c.relname AS table_name
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl.table_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Drop existing public policies so we can recreate strict policies
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- TEAMS
-- ---------------------------------------------------------------------------
CREATE POLICY teams_select_authenticated ON public.teams
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY teams_admin_manage ON public.teams
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- PROFILES
-- Users can read their own profile.
-- Managers can read profiles in their own team.
-- Admin can read all profiles for administration.
-- ---------------------------------------------------------------------------
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = profiles.team_id
    )
  );

CREATE POLICY profiles_insert_self_or_admin ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id OR public.is_admin(auth.uid()));

CREATE POLICY profiles_update_self_or_admin ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = id OR public.is_admin(auth.uid()));

CREATE POLICY profiles_delete_admin_only ON public.profiles
  FOR DELETE
  USING (public.is_admin(auth.uid()));

-- Enforce that role changes are admin-only, even on self-updates.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.role() <> 'service_role' AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only admins can modify roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_enforce_role_update ON public.profiles;
CREATE TRIGGER trg_profiles_enforce_role_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_role_update();

-- ---------------------------------------------------------------------------
-- LEADS
-- ---------------------------------------------------------------------------
CREATE POLICY leads_select_scoped ON public.leads
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles lead_owner ON lead_owner.id = leads.user_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = lead_owner.team_id
    )
  );

CREATE POLICY leads_insert_scoped ON public.leads
  FOR INSERT
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles lead_owner ON lead_owner.id = leads.user_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = lead_owner.team_id
    )
  );

CREATE POLICY leads_update_scoped ON public.leads
  FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles lead_owner ON lead_owner.id = leads.user_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = lead_owner.team_id
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles lead_owner ON lead_owner.id = leads.user_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = lead_owner.team_id
    )
  );

CREATE POLICY leads_delete_admin_only ON public.leads
  FOR DELETE
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- DEALS
-- ---------------------------------------------------------------------------
CREATE POLICY deals_select_scoped ON public.deals
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles deal_owner ON deal_owner.id = deals.owner_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = deal_owner.team_id
    )
  );

CREATE POLICY deals_insert_scoped ON public.deals
  FOR INSERT
  WITH CHECK (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles deal_owner ON deal_owner.id = deals.owner_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = deal_owner.team_id
    )
  );

CREATE POLICY deals_update_scoped ON public.deals
  FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles deal_owner ON deal_owner.id = deals.owner_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = deal_owner.team_id
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles manager_actor
      INNER JOIN public.profiles deal_owner ON deal_owner.id = deals.owner_id
      WHERE manager_actor.id = auth.uid()
        AND manager_actor.role = 'manager'
        AND manager_actor.team_id IS NOT NULL
        AND manager_actor.team_id = deal_owner.team_id
    )
  );

CREATE POLICY deals_delete_admin_only ON public.deals
  FOR DELETE
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- TRAININGS
-- ---------------------------------------------------------------------------
CREATE POLICY trainings_select_authenticated ON public.trainings
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY trainings_admin_manage ON public.trainings
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- DEAL_TRAININGS (scope by parent deal access)
-- ---------------------------------------------------------------------------
CREATE POLICY deal_trainings_select_scoped ON public.deal_trainings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_trainings.deal_id
        AND (
          public.is_admin(auth.uid())
          OR d.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles deal_owner ON deal_owner.id = d.owner_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = deal_owner.team_id
          )
        )
    )
  );

CREATE POLICY deal_trainings_manage_scoped ON public.deal_trainings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_trainings.deal_id
        AND (
          public.is_admin(auth.uid())
          OR d.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles deal_owner ON deal_owner.id = d.owner_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = deal_owner.team_id
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_trainings.deal_id
        AND (
          public.is_admin(auth.uid())
          OR d.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.profiles manager_actor
            INNER JOIN public.profiles deal_owner ON deal_owner.id = d.owner_id
            WHERE manager_actor.id = auth.uid()
              AND manager_actor.role = 'manager'
              AND manager_actor.team_id IS NOT NULL
              AND manager_actor.team_id = deal_owner.team_id
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- COMMENTS
-- ---------------------------------------------------------------------------
CREATE POLICY comments_select_scoped ON public.comments
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = comments.lead_id
        AND (
          l.user_id = auth.uid()
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

CREATE POLICY comments_insert_scoped ON public.comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.leads l
        WHERE l.id = comments.lead_id
          AND (
            l.user_id = auth.uid()
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
  );

CREATE POLICY comments_update_scoped ON public.comments
  FOR UPDATE
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR user_id = auth.uid());

CREATE POLICY comments_delete_scoped ON public.comments
  FOR DELETE
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ROLE_PERMISSIONS
-- ---------------------------------------------------------------------------
CREATE POLICY role_permissions_select_authenticated ON public.role_permissions
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY role_permissions_admin_manage ON public.role_permissions
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- INVITATIONS
-- ---------------------------------------------------------------------------
CREATE POLICY invitations_public_by_token ON public.invitations
  FOR SELECT
  USING (true);

CREATE POLICY invitations_admin_manager_manage ON public.invitations
  FOR ALL
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'
    )
  );

-- ---------------------------------------------------------------------------
-- APP_SETTINGS
-- ---------------------------------------------------------------------------
CREATE POLICY app_settings_select_authenticated ON public.app_settings
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY app_settings_admin_manage ON public.app_settings
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
