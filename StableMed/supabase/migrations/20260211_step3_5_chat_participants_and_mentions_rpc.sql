-- =============================================================================
-- STEP 3.5 - Chat RPCs: participants picker + mention candidates
-- =============================================================================
-- Goals:
-- 1) List chat candidates without weakening global profiles RLS.
-- 2) Create group conversations with explicit participants selection.
-- 3) Provide mention candidates for conversation members.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_chat_candidates()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS user_id, p.full_name, p.email, p.avatar_url
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND (
      public.is_admin(auth.uid())
      OR (
        p.team_id IS NOT NULL
        AND p.team_id = (
          SELECT me.team_id
          FROM public.profiles me
          WHERE me.id = auth.uid()
          LIMIT 1
        )
      )
    )
  ORDER BY COALESCE(NULLIF(trim(p.full_name), ''), p.email, p.id::text);
$$;

REVOKE ALL ON FUNCTION public.get_chat_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.get_conversation_mention_candidates(
  p_conversation_id UUID
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS user_id, p.full_name, p.email, p.avatar_url
  FROM public.conversation_participants cp
  INNER JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.conversation_id = p_conversation_id
    AND EXISTS (
      SELECT 1
      FROM public.conversation_participants me
      WHERE me.conversation_id = p_conversation_id
        AND me.user_id = auth.uid()
    )
  ORDER BY COALESCE(NULLIF(trim(p.full_name), ''), p.email, p.id::text);
$$;

REVOKE ALL ON FUNCTION public.get_conversation_mention_candidates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversation_mention_candidates(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_mention_candidates(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_group_conversation_with_participants(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_participant_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_team_id UUID;
  new_conversation_id UUID;
  invalid_count INTEGER;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Le nom de conversation doit contenir au moins 2 caracteres';
  END IF;

  SELECT me.team_id
  INTO actor_team_id
  FROM public.profiles me
  WHERE me.id = actor_id
  LIMIT 1;

  IF NOT public.is_admin(actor_id) THEN
    SELECT COUNT(*)
    INTO invalid_count
    FROM unnest(COALESCE(p_participant_ids, ARRAY[]::UUID[])) AS pid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = pid
        AND p.team_id IS NOT NULL
        AND p.team_id = actor_team_id
    );

    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'Participants invalides pour votre equipe';
    END IF;
  END IF;

  INSERT INTO public.conversations (type, name, description, created_by)
  VALUES (
    'group'::public.conversation_type,
    trim(p_name),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    actor_id
  )
  RETURNING id INTO new_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_conversation_id, actor_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT DISTINCT new_conversation_id, pid
  FROM unnest(COALESCE(p_participant_ids, ARRAY[]::UUID[])) AS pid
  WHERE pid IS NOT NULL
    AND pid <> actor_id
  ON CONFLICT DO NOTHING;

  RETURN new_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_conversation_with_participants(TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_group_conversation_with_participants(TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_conversation_with_participants(TEXT, TEXT, UUID[]) TO service_role;

COMMIT;
