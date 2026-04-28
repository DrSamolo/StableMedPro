-- ==============================================================================
-- STABLEMED CRM - FULL SCHEMA (SUPABASE / POSTGRES)
-- ==============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- TEAMS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teams_select_authenticated" ON public.teams;
CREATE POLICY "teams_select_authenticated" ON public.teams
  FOR SELECT USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'commercial',
  manager_id UUID REFERENCES public.profiles(id),
  team_id UUID REFERENCES public.teams(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'email') THEN
    ALTER TABLE public.profiles ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'full_name') THEN
    ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'avatar_url') THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'role') THEN
    ALTER TABLE public.profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'commercial';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'manager_id') THEN
    ALTER TABLE public.profiles ADD COLUMN manager_id UUID REFERENCES public.profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'team_id') THEN
    ALTER TABLE public.profiles ADD COLUMN team_id UUID REFERENCES public.teams(id);
  END IF;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "teams_admin_manage" ON public.teams;
CREATE POLICY "teams_admin_manage" ON public.teams
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Trigger: create profile on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''), 'commercial')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ------------------------------------------------------------------------------
-- LEADS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id),
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  profession TEXT,
  client_reference TEXT,
  address TEXT,
  secure_info TEXT,
  specialty TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  is_pipeline BOOLEAN DEFAULT false,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  email TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'user_id') THEN
    ALTER TABLE public.leads ADD COLUMN user_id UUID REFERENCES public.profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'name') THEN
    ALTER TABLE public.leads ADD COLUMN name TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'status') THEN
    ALTER TABLE public.leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'is_pipeline') THEN
    ALTER TABLE public.leads ADD COLUMN is_pipeline BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'last_activity') THEN
    ALTER TABLE public.leads ADD COLUMN last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'email') THEN
    ALTER TABLE public.leads ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'phone') THEN
    ALTER TABLE public.leads ADD COLUMN phone TEXT;
  END IF;
END $$;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_authenticated_all" ON public.leads;
CREATE POLICY "leads_authenticated_all" ON public.leads
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- DEALS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  training TEXT,
  amount NUMERIC DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'new',
  probability INTEGER DEFAULT 20,
  owner_id UUID REFERENCES public.profiles(id),
  closed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'title') THEN
    ALTER TABLE public.deals ADD COLUMN title TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'training') THEN
    ALTER TABLE public.deals ADD COLUMN training TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'amount') THEN
    ALTER TABLE public.deals ADD COLUMN amount NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'stage') THEN
    ALTER TABLE public.deals ADD COLUMN stage TEXT NOT NULL DEFAULT 'new';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'probability') THEN
    ALTER TABLE public.deals ADD COLUMN probability INTEGER DEFAULT 20;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'owner_id') THEN
    ALTER TABLE public.deals ADD COLUMN owner_id UUID REFERENCES public.profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'closed_at') THEN
    ALTER TABLE public.deals ADD COLUMN closed_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_authenticated_all" ON public.deals;
CREATE POLICY "deals_authenticated_all" ON public.deals
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- TRAININGS (CATALOG)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trainings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  reference TEXT,
  organization TEXT,
  status TEXT DEFAULT 'Actif',
  training_type TEXT,
  target_audience TEXT,
  price NUMERIC DEFAULT 0,
  compensation NUMERIC DEFAULT 0,
  funder TEXT DEFAULT 'DPC',
  duration_total TEXT,
  format TEXT,
  instructor_name TEXT,
  instructor_bio TEXT,
  program_details TEXT,
  image TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'title') THEN
    ALTER TABLE public.trainings ADD COLUMN title TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'status') THEN
    ALTER TABLE public.trainings ADD COLUMN status TEXT DEFAULT 'Actif';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'price') THEN
    ALTER TABLE public.trainings ADD COLUMN price NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'compensation') THEN
    ALTER TABLE public.trainings ADD COLUMN compensation NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'format') THEN
    ALTER TABLE public.trainings ADD COLUMN format TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'program_details') THEN
    ALTER TABLE public.trainings ADD COLUMN program_details TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'funder') THEN
    ALTER TABLE public.trainings ADD COLUMN funder TEXT DEFAULT 'DPC';
  ELSE
    ALTER TABLE public.trainings ALTER COLUMN funder SET DEFAULT 'DPC';
  END IF;
END $$;

ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainings_authenticated_all" ON public.trainings;
CREATE POLICY "trainings_authenticated_all" ON public.trainings
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- DEAL <-> TRAININGS (MANY TO MANY)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_trainings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  training_id UUID REFERENCES public.trainings(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.deal_trainings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deal_trainings_authenticated_all" ON public.deal_trainings;
CREATE POLICY "deal_trainings_authenticated_all" ON public.deal_trainings
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- COMMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_authenticated_all" ON public.comments;
CREATE POLICY "comments_authenticated_all" ON public.comments
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- ROLE PERMISSIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON public.role_permissions;
CREATE POLICY "role_permissions_select_authenticated" ON public.role_permissions
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "role_permissions_admin_manage" ON public.role_permissions;
CREATE POLICY "role_permissions_admin_manage" ON public.role_permissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ------------------------------------------------------------------------------
-- INVITATIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'commercial',
  team_id UUID REFERENCES public.teams(id),
  organization_scopes TEXT[],
  token UUID DEFAULT uuid_generate_v4() NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days'),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_public_by_token" ON public.invitations;
CREATE POLICY "invitations_public_by_token" ON public.invitations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "invitations_admin_manager_manage" ON public.invitations;
CREATE POLICY "invitations_admin_manager_manage" ON public.invitations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- ------------------------------------------------------------------------------
-- PROFILE ORGANIZATION SCOPES (REPRESENTANTS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_organization_scopes (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT profile_organization_scopes_pk PRIMARY KEY (profile_id, organization)
);

ALTER TABLE public.profile_organization_scopes ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- APP SETTINGS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_authenticated" ON public.app_settings;
CREATE POLICY "app_settings_select_authenticated" ON public.app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "app_settings_admin_manage" ON public.app_settings;
CREATE POLICY "app_settings_admin_manage" ON public.app_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ------------------------------------------------------------------------------
-- RELOAD SCHEMA RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reload_schema()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reload_schema() TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- STORAGE BUCKET (AVATARS)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_deals_owner ON public.deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_profiles_team ON public.profiles(team_id);
CREATE INDEX IF NOT EXISTS idx_leads_user ON public.leads(user_id);
