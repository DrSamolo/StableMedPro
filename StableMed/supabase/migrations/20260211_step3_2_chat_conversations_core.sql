-- =============================================================================
-- STEP 3.2 - Chat Core (Conversations + Participants + Messages)
-- =============================================================================
-- Goals:
-- 1) Introduce PRD-aligned entities: conversations, conversation_participants, messages.
-- 2) Enforce strict participant-based RLS (zero-trust in Postgres).
-- 3) Add mention + message notifications on message insert.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_type') THEN
    CREATE TYPE public.conversation_type AS ENUM ('dm', 'group');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'notification_type'
         AND e.enumlabel = 'mention'
     ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'mention';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'notification_type'
         AND e.enumlabel = 'message'
     ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'message';
  END IF;
END $$;

-- Important: enum values must be committed before they can be referenced.
COMMIT;

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS reference_id UUID;

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.conversation_type NOT NULL,
  name TEXT,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT conversations_group_name_required CHECK (
    (type = 'group' AND name IS NOT NULL AND length(trim(name)) > 0)
    OR (type = 'dm')
  )
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT messages_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT messages_content_max_length CHECK (length(content) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON public.conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_last_read
  ON public.conversation_participants(user_id, last_read_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON public.messages(sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_reference
  ON public.notifications(user_id, type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_chat_ref
  ON public.notifications(user_id, type, reference_id)
  WHERE type IN ('mention'::public.notification_type, 'message'::public.notification_type)
    AND reference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(
  target_conversation_id UUID,
  target_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = target_conversation_id
      AND cp.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_conversation(
  target_conversation_id UUID,
  actor_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = target_conversation_id
      AND (c.created_by = actor_id OR public.is_admin(actor_id))
  );
$$;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select_if_participant ON public.conversations;
CREATE POLICY conversations_select_if_participant ON public.conversations
  FOR SELECT
  USING (public.is_conversation_participant(id, auth.uid()));

DROP POLICY IF EXISTS conversations_insert_creator_only ON public.conversations;
CREATE POLICY conversations_insert_creator_only ON public.conversations
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS conversations_update_creator_or_admin ON public.conversations;
CREATE POLICY conversations_update_creator_or_admin ON public.conversations
  FOR UPDATE
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS conversations_delete_creator_or_admin ON public.conversations;
CREATE POLICY conversations_delete_creator_or_admin ON public.conversations
  FOR DELETE
  USING (created_by = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS conversation_participants_select_scoped ON public.conversation_participants;
CREATE POLICY conversation_participants_select_scoped ON public.conversation_participants
  FOR SELECT
  USING (
    public.is_conversation_participant(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_participants_insert_manage ON public.conversation_participants;
CREATE POLICY conversation_participants_insert_manage ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.can_manage_conversation(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_participants_update_self_or_manage ON public.conversation_participants;
CREATE POLICY conversation_participants_update_self_or_manage ON public.conversation_participants
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.can_manage_conversation(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.can_manage_conversation(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS conversation_participants_delete_self_or_manage ON public.conversation_participants;
CREATE POLICY conversation_participants_delete_self_or_manage ON public.conversation_participants
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.can_manage_conversation(conversation_id, auth.uid())
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS messages_select_if_participant ON public.messages;
CREATE POLICY messages_select_if_participant ON public.messages
  FOR SELECT
  USING (public.is_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS messages_insert_if_participant_sender ON public.messages;
CREATE POLICY messages_insert_if_participant_sender ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS messages_update_sender_or_admin ON public.messages;
CREATE POLICY messages_update_sender_or_admin ON public.messages
  FOR UPDATE
  USING (sender_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (sender_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS messages_delete_sender_or_admin ON public.messages;
CREATE POLICY messages_delete_sender_or_admin ON public.messages
  FOR DELETE
  USING (sender_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.on_message_created_notify_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mention_token TEXT;
  participant_row RECORD;
  normalized_full_name TEXT;
  normalized_email_alias TEXT;
BEGIN
  -- Ensure sender has read marker refreshed.
  UPDATE public.conversation_participants cp
  SET last_read_at = timezone('utc'::text, now())
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.user_id = NEW.sender_id;

  -- Notify all other participants for unread badge/message feed.
  INSERT INTO public.notifications (user_id, type, title, message, metadata, is_read, reference_id)
  SELECT
    cp.user_id,
    'message'::public.notification_type,
    'Nouveau message',
    'Nouveau message recu dans une conversation.',
    jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id),
    false,
    NEW.id
  FROM public.conversation_participants cp
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.user_id <> NEW.sender_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = cp.user_id
        AND n.type = 'message'::public.notification_type
        AND n.reference_id = NEW.id
    );

  -- Mention notifications based on @token.
  FOR mention_token IN
    SELECT DISTINCT lower((regexp_matches(NEW.content, '@([a-zA-Z0-9_.-]+)', 'g'))[1])
  LOOP
    FOR participant_row IN
      SELECT p.id AS user_id, p.full_name, p.email
      FROM public.profiles p
      INNER JOIN public.conversation_participants cp ON cp.user_id = p.id
      WHERE cp.conversation_id = NEW.conversation_id
        AND p.id <> NEW.sender_id
    LOOP
      normalized_full_name := lower(regexp_replace(coalesce(participant_row.full_name, ''), '[^a-zA-Z0-9_.-]', '', 'g'));
      normalized_email_alias := lower(split_part(coalesce(participant_row.email, ''), '@', 1));

      IF mention_token = normalized_full_name OR mention_token = normalized_email_alias THEN
        INSERT INTO public.notifications (user_id, type, title, message, metadata, is_read, reference_id)
        VALUES (
          participant_row.user_id,
          'mention'::public.notification_type,
          'Vous avez ete mentionne',
          'Un message vous mentionne dans une conversation.',
          jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id, 'mention', mention_token),
          false,
          NEW.id
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_notify_mentions ON public.messages;
CREATE TRIGGER trg_messages_notify_mentions
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.on_message_created_notify_mentions();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'conversation_participants'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
  END IF;
END $$;

COMMIT;
