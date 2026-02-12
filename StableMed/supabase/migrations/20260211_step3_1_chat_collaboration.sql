-- =============================================================================
-- STEP 3.1 - Chat & Collaboration (Realtime)
-- =============================================================================
-- Goals:
-- 1) Introduce secure team-scoped channels and messages.
-- 2) Enforce zero-trust access with RLS policies only.
-- 3) Prepare realtime publication for chat tables.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_channel_type') THEN
    CREATE TYPE public.chat_channel_type AS ENUM ('team', 'lead');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.user_team_id(user_id UUID DEFAULT auth.uid())
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.team_id
  FROM public.profiles p
  WHERE p.id = user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_access_team(target_team_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    target_team_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.is_admin(auth.uid())
      OR target_team_id = public.user_team_id(auth.uid())
    )
  );
$$;

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  type public.chat_channel_type NOT NULL DEFAULT 'team',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chat_channels_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT chat_channels_slug_valid CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  CONSTRAINT chat_channels_unique_team_slug UNIQUE (team_id, slug)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_avatar_url TEXT,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chat_messages_body_not_blank CHECK (length(trim(body)) > 0),
  CONSTRAINT chat_messages_body_max_length CHECK (length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_chat_channels_team_archived_created
  ON public.chat_channels(team_id, archived_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON public.chat_messages(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_created
  ON public.chat_messages(sender_id, created_at DESC);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_channels_select_team ON public.chat_channels;
CREATE POLICY chat_channels_select_team ON public.chat_channels
  FOR SELECT
  USING (public.can_access_team(team_id));

DROP POLICY IF EXISTS chat_channels_insert_team_member ON public.chat_channels;
CREATE POLICY chat_channels_insert_team_member ON public.chat_channels
  FOR INSERT
  WITH CHECK (
    public.can_access_team(team_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS chat_channels_update_creator_or_admin ON public.chat_channels;
CREATE POLICY chat_channels_update_creator_or_admin ON public.chat_channels
  FOR UPDATE
  USING (
    public.can_access_team(team_id)
    AND (public.is_admin(auth.uid()) OR created_by = auth.uid())
  )
  WITH CHECK (
    public.can_access_team(team_id)
    AND (public.is_admin(auth.uid()) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS chat_channels_delete_creator_or_admin ON public.chat_channels;
CREATE POLICY chat_channels_delete_creator_or_admin ON public.chat_channels
  FOR DELETE
  USING (
    public.can_access_team(team_id)
    AND (public.is_admin(auth.uid()) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS chat_messages_select_channel_member ON public.chat_messages;
CREATE POLICY chat_messages_select_channel_member ON public.chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_channels c
      WHERE c.id = chat_messages.channel_id
        AND public.can_access_team(c.team_id)
    )
  );

DROP POLICY IF EXISTS chat_messages_insert_channel_member ON public.chat_messages;
CREATE POLICY chat_messages_insert_channel_member ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_channels c
      WHERE c.id = chat_messages.channel_id
        AND public.can_access_team(c.team_id)
    )
  );

DROP POLICY IF EXISTS chat_messages_update_sender_or_admin ON public.chat_messages;
CREATE POLICY chat_messages_update_sender_or_admin ON public.chat_messages
  FOR UPDATE
  USING (
    sender_id = auth.uid()
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    sender_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS chat_messages_delete_sender_or_admin ON public.chat_messages;
CREATE POLICY chat_messages_delete_sender_or_admin ON public.chat_messages
  FOR DELETE
  USING (
    sender_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_chat_channels_updated_at ON public.chat_channels;
CREATE TRIGGER trg_chat_channels_updated_at
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_chat_messages_updated_at ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

INSERT INTO public.chat_channels (team_id, type, name, slug, created_by)
SELECT t.id, 'team'::public.chat_channel_type, 'General', 'general', NULL
FROM public.teams t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.chat_channels c
  WHERE c.team_id = t.id
    AND c.slug = 'general'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chat_channels'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channels;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END $$;

COMMIT;
