-- =============================================================================
-- STEP 5.37 - Role representant + scope organismes + RLS metier
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Roles: allow representant everywhere role constraints/normalization apply.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  invalid_roles TEXT[];
BEGIN
  SELECT array_agg(DISTINCT lower(trim(role)) ORDER BY lower(trim(role)))
  INTO invalid_roles
  FROM public.profiles
  WHERE role IS NOT NULL
    AND btrim(role) <> ''
    AND lower(trim(role)) NOT IN ('admin', 'manager', 'commercial', 'representant');

  IF invalid_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration stoppee: roles existants non reconnus dans public.profiles: %',
      array_to_string(invalid_roles, ', ');
  END IF;
END $$;

UPDATE public.profiles
SET role = lower(trim(role))
WHERE role IS NOT NULL
  AND role <> lower(trim(role));

UPDATE public.profiles
SET role = 'commercial'
WHERE role IS NULL
   OR btrim(role) = '';

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'commercial';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_allowed;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_allowed
  CHECK (role IN ('admin', 'manager', 'commercial', 'representant'));

CREATE OR REPLACE FUNCTION public.normalize_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.role := lower(trim(COALESCE(NEW.role, 'commercial')));
  IF NEW.role NOT IN ('admin', 'manager', 'commercial', 'representant') THEN
    NEW.role := 'commercial';
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Invitations: persist representative organization scopes during signup.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS organization_scopes TEXT[];

CREATE OR REPLACE FUNCTION public.get_invitation_signup_context(
  p_token UUID
)
RETURNS TABLE (
  email TEXT,
  role TEXT,
  team_id UUID,
  expires_at TIMESTAMPTZ,
  organization_scopes TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token invitation invalide';
  END IF;

  RETURN QUERY
  SELECT i.email, i.role, i.team_id, i.expires_at, i.organization_scopes
  FROM public.invitations i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Representative scopes table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_organization_scopes (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profile_organization_scopes_pk PRIMARY KEY (profile_id, organization),
  CONSTRAINT profile_organization_scopes_org_not_blank CHECK (btrim(organization) <> '')
);

CREATE INDEX IF NOT EXISTS idx_profile_org_scopes_profile
  ON public.profile_organization_scopes(profile_id);

CREATE INDEX IF NOT EXISTS idx_profile_org_scopes_org
  ON public.profile_organization_scopes(organization);

ALTER TABLE public.profile_organization_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_organization_scopes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_organization_scopes_select_scoped ON public.profile_organization_scopes;
CREATE POLICY profile_organization_scopes_select_scoped ON public.profile_organization_scopes
  FOR SELECT
  USING (
    auth.uid() = profile_id
    OR public.is_admin(auth.uid())
    OR public.is_manager_same_team(auth.uid(), profile_id)
  );

DROP POLICY IF EXISTS profile_organization_scopes_manage_admin ON public.profile_organization_scopes;
CREATE POLICY profile_organization_scopes_manage_admin ON public.profile_organization_scopes
  FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.set_profile_organization_scopes(
  p_profile_id UUID,
  p_organizations TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profil cible requis';
  END IF;

  DELETE FROM public.profile_organization_scopes
  WHERE profile_id = p_profile_id;

  IF COALESCE(array_length(p_organizations, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.profile_organization_scopes (profile_id, organization)
  SELECT p_profile_id, org.cleaned
  FROM (
    SELECT DISTINCT btrim(value) AS cleaned
    FROM unnest(p_organizations) AS value
    WHERE btrim(COALESCE(value, '')) <> ''
  ) AS org;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_organization_scopes(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_organization_scopes(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_organization_scopes(UUID, TEXT[]) TO service_role;

-- -----------------------------------------------------------------------------
-- Access helpers for representative role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_representant(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_profile_role(p_user_id) = 'representant'
$$;

CREATE OR REPLACE FUNCTION public.has_representant_organization_access(
  p_actor_id UUID,
  p_organization TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_organization_scopes s
    WHERE s.profile_id = p_actor_id
      AND lower(btrim(s.organization)) = lower(btrim(COALESCE(p_organization, '')))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_representant_access_deal(
  p_actor_id UUID,
  p_deal_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deals d
    INNER JOIN public.deal_trainings dt ON dt.deal_id = d.id
    INNER JOIN public.trainings t ON t.id = dt.training_id
    WHERE d.id = p_deal_id
      AND lower(trim(COALESCE(d.stage, ''))) = 'won'
      AND public.has_representant_organization_access(p_actor_id, t.organization)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_representant_access_lead(
  p_actor_id UUID,
  p_lead_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    INNER JOIN public.deals d ON d.lead_id = l.id
    WHERE l.id = p_lead_id
      AND lower(trim(COALESCE(l.status, ''))) = 'won'
      AND public.can_representant_access_deal(p_actor_id, d.id)
  )
$$;

REVOKE ALL ON FUNCTION public.is_representant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_representant(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_representant(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.has_representant_organization_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_representant_organization_access(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_representant_organization_access(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.can_representant_access_deal(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_representant_access_deal(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_representant_access_deal(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.can_representant_access_lead(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_representant_access_lead(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_representant_access_lead(UUID, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- Invitation finalize: when representant, persist selected organizations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_invitation_signup(
  p_token UUID,
  p_full_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_email TEXT;
  invitation_row public.invitations%ROWTYPE;
  normalized_role TEXT;
  invitation_id UUID;
  effective_full_name TEXT;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token invitation invalide';
  END IF;

  SELECT u.email
  INTO actor_email
  FROM auth.users u
  WHERE u.id = actor_id;

  IF actor_email IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  SELECT i.*
  INTO invitation_row
  FROM public.invitations i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;

  IF lower(trim(actor_email)) <> lower(trim(invitation_row.email)) THEN
    RAISE EXCEPTION 'Cette invitation ne correspond pas a votre email';
  END IF;

  normalized_role := lower(trim(COALESCE(invitation_row.role, 'commercial')));
  IF normalized_role NOT IN ('admin', 'manager', 'commercial', 'representant') THEN
    normalized_role := 'commercial';
  END IF;

  effective_full_name := NULLIF(trim(COALESCE(p_full_name, '')), '');

  PERFORM set_config('app.allow_invitation_role_sync', 'on', true);

  INSERT INTO public.profiles (id, email, full_name, role, team_id)
  VALUES (
    actor_id,
    invitation_row.email,
    COALESCE(
      effective_full_name,
      split_part(COALESCE(invitation_row.email, ''), '@', 1),
      'Utilisateur'
    ),
    normalized_role,
    invitation_row.team_id
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(effective_full_name, public.profiles.full_name, EXCLUDED.full_name),
    role = CASE
      WHEN public.profiles.role = 'commercial' THEN normalized_role
      ELSE public.profiles.role
    END,
    team_id = COALESCE(public.profiles.team_id, invitation_row.team_id);

  DELETE FROM public.profile_organization_scopes
  WHERE profile_id = actor_id;

  IF normalized_role = 'representant' THEN
    INSERT INTO public.profile_organization_scopes (profile_id, organization)
    SELECT actor_id, org.cleaned
    FROM (
      SELECT DISTINCT btrim(value) AS cleaned
      FROM unnest(COALESCE(invitation_row.organization_scopes, ARRAY[]::TEXT[])) AS value
      WHERE btrim(COALESCE(value, '')) <> ''
    ) AS org;
  END IF;

  UPDATE public.invitations i
  SET used_at = timezone('utc'::text, now())
  WHERE i.id = invitation_row.id
  RETURNING i.id INTO invitation_id;

  IF invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation introuvable, déjà utilisée ou expirée';
  END IF;

  RETURN invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_invitation_signup(UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- Role permissions bootstrap for representant.
-- -----------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, permissions)
VALUES (
  'representant',
  '{"can_manage_team": false, "can_delete_leads": false, "can_export_data": false, "can_manage_roles": false, "can_manage_catalog": false}'::jsonb
)
ON CONFLICT (role) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS: representative can only read scoped won leads/deals and scoped trainings.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin(auth.uid())
    OR (
      public.get_profile_role(auth.uid()) = 'manager'
      AND public.get_profile_team_id(auth.uid()) IS NOT NULL
      AND team_id IS NOT DISTINCT FROM public.get_profile_team_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS trainings_select_authenticated ON public.trainings;
CREATE POLICY trainings_select_authenticated ON public.trainings
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      NOT public.is_representant(auth.uid())
      OR public.has_representant_organization_access(auth.uid(), organization)
    )
  );

DROP POLICY IF EXISTS leads_select_scoped ON public.leads;
CREATE POLICY leads_select_scoped ON public.leads
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR (
      NOT public.is_representant(auth.uid())
      AND (
        user_id = auth.uid()
        OR public.is_manager_same_team(auth.uid(), user_id)
      )
    )
    OR (
      public.is_representant(auth.uid())
      AND public.can_representant_access_lead(auth.uid(), id)
    )
  );

DROP POLICY IF EXISTS leads_insert_scoped ON public.leads;
CREATE POLICY leads_insert_scoped ON public.leads
  FOR INSERT
  WITH CHECK (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR user_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), user_id)
    )
  );

DROP POLICY IF EXISTS leads_update_scoped ON public.leads;
CREATE POLICY leads_update_scoped ON public.leads
  FOR UPDATE
  USING (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR user_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), user_id)
    )
  )
  WITH CHECK (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR user_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), user_id)
    )
  );

DROP POLICY IF EXISTS deals_select_scoped ON public.deals;
CREATE POLICY deals_select_scoped ON public.deals
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR (
      NOT public.is_representant(auth.uid())
      AND (
        owner_id = auth.uid()
        OR public.is_manager_same_team(auth.uid(), owner_id)
      )
    )
    OR (
      public.is_representant(auth.uid())
      AND public.can_representant_access_deal(auth.uid(), id)
    )
  );

DROP POLICY IF EXISTS deals_insert_scoped ON public.deals;
CREATE POLICY deals_insert_scoped ON public.deals
  FOR INSERT
  WITH CHECK (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR owner_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), owner_id)
    )
  );

DROP POLICY IF EXISTS deals_update_scoped ON public.deals;
CREATE POLICY deals_update_scoped ON public.deals
  FOR UPDATE
  USING (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR owner_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), owner_id)
    )
  )
  WITH CHECK (
    NOT public.is_representant(auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR owner_id = auth.uid()
      OR public.is_manager_same_team(auth.uid(), owner_id)
    )
  );

DROP POLICY IF EXISTS deal_trainings_select_scoped ON public.deal_trainings;
CREATE POLICY deal_trainings_select_scoped ON public.deal_trainings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = deal_trainings.deal_id
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
          OR (
            NOT public.is_representant(auth.uid())
            AND (
              l.user_id = auth.uid()
              OR public.is_manager_same_team(auth.uid(), l.user_id)
            )
          )
          OR (
            public.is_representant(auth.uid())
            AND public.can_representant_access_lead(auth.uid(), l.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS comments_select_scoped ON public.comments;
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
          (
            NOT public.is_representant(auth.uid())
            AND (
              l.user_id = auth.uid()
              OR public.is_manager_same_team(auth.uid(), l.user_id)
            )
          )
          OR (
            public.is_representant(auth.uid())
            AND public.can_representant_access_lead(auth.uid(), l.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS comments_insert_scoped ON public.comments;
CREATE POLICY comments_insert_scoped ON public.comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = comments.lead_id
        AND (
          public.is_admin(auth.uid())
          OR (
            NOT public.is_representant(auth.uid())
            AND (
              l.user_id = auth.uid()
              OR public.is_manager_same_team(auth.uid(), l.user_id)
            )
          )
          OR (
            public.is_representant(auth.uid())
            AND public.can_representant_access_lead(auth.uid(), l.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS comments_update_scoped ON public.comments;
CREATE POLICY comments_update_scoped ON public.comments
  FOR UPDATE
  USING (
    public.is_admin(auth.uid())
    OR (
      NOT public.is_representant(auth.uid())
      AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      NOT public.is_representant(auth.uid())
      AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS comments_delete_scoped ON public.comments;
CREATE POLICY comments_delete_scoped ON public.comments
  FOR DELETE
  USING (
    public.is_admin(auth.uid())
    OR (
      NOT public.is_representant(auth.uid())
      AND user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
