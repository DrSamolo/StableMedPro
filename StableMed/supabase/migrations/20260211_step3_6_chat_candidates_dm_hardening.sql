-- =============================================================================
-- STEP 3.6 - Chat hardening: candidates fallback + required participants + DM RPC
-- =============================================================================

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
  WITH me AS (
    SELECT
      auth.uid() AS actor_id,
      (
        SELECT p.team_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
        LIMIT 1
      ) AS actor_team_id,
      public.is_admin(auth.uid()) AS actor_is_admin
  ),
  profile_candidates AS (
    SELECT
      p.id AS user_id,
      p.full_name,
      p.email,
      p.avatar_url
    FROM public.profiles p
    CROSS JOIN me
    WHERE p.id <> me.actor_id
      AND (
        me.actor_is_admin
        OR p.team_id IS NOT DISTINCT FROM me.actor_team_id
      )
  ),
  auth_only_candidates AS (
    SELECT
      u.id AS user_id,
      (u.raw_user_meta_data ->> 'full_name')::text AS full_name,
      u.email::text AS email,
      (u.raw_user_meta_data ->> 'avatar_url')::text AS avatar_url
    FROM auth.users u
    CROSS JOIN me
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
      AND u.id <> me.actor_id
      AND (me.actor_is_admin OR me.actor_team_id IS NULL)
  )
  SELECT user_id, full_name, email, avatar_url
  FROM (
    SELECT * FROM profile_candidates
    UNION ALL
    SELECT * FROM auth_only_candidates
  ) AS candidates
  ORDER BY COALESCE(NULLIF(trim(full_name), ''), email, user_id::text);
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
  SELECT
    cp.user_id AS user_id,
    COALESCE(p.full_name, (u.raw_user_meta_data ->> 'full_name')::text) AS full_name,
    COALESCE(p.email, u.email::text) AS email,
    COALESCE(p.avatar_url, (u.raw_user_meta_data ->> 'avatar_url')::text) AS avatar_url
  FROM public.conversation_participants cp
  LEFT JOIN public.profiles p ON p.id = cp.user_id
  LEFT JOIN auth.users u ON u.id = cp.user_id
  WHERE cp.conversation_id = p_conversation_id
    AND EXISTS (
      SELECT 1
      FROM public.conversation_participants me
      WHERE me.conversation_id = p_conversation_id
        AND me.user_id = auth.uid()
    )
  ORDER BY COALESCE(
    NULLIF(trim(COALESCE(p.full_name, (u.raw_user_meta_data ->> 'full_name')::text)), ''),
    COALESCE(p.email, u.email::text),
    cp.user_id::text
  );
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
  selected_count INTEGER;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Le nom de conversation doit contenir au moins 2 caracteres';
  END IF;

  selected_count := COALESCE(array_length(p_participant_ids, 1), 0);
  IF selected_count = 0 THEN
    RAISE EXCEPTION 'Selectionnez au moins un participant';
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
    WHERE pid IS NULL
      OR pid = actor_id
      OR NOT (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = pid
            AND p.team_id IS NOT DISTINCT FROM actor_team_id
        )
        OR (
          actor_team_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM auth.users u
            WHERE u.id = pid
          )
        )
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

CREATE OR REPLACE FUNCTION public.create_or_get_dm_conversation(
  p_target_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_team_id UUID;
  existing_conversation_id UUID;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Utilisateur cible invalide';
  END IF;

  SELECT me.team_id
  INTO actor_team_id
  FROM public.profiles me
  WHERE me.id = actor_id
  LIMIT 1;

  IF NOT public.is_admin(actor_id) THEN
    IF NOT (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_target_user_id
          AND p.team_id IS NOT DISTINCT FROM actor_team_id
      )
      OR (
        actor_team_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM auth.users u
          WHERE u.id = p_target_user_id
        )
      )
    ) THEN
      RAISE EXCEPTION 'Utilisateur cible invalide pour votre equipe';
    END IF;
  END IF;

  SELECT c.id
  INTO existing_conversation_id
  FROM public.conversations c
  INNER JOIN public.conversation_participants cp_actor
    ON cp_actor.conversation_id = c.id
   AND cp_actor.user_id = actor_id
  INNER JOIN public.conversation_participants cp_target
    ON cp_target.conversation_id = c.id
   AND cp_target.user_id = p_target_user_id
  WHERE c.type = 'dm'::public.conversation_type
    AND (
      SELECT COUNT(*)
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = c.id
    ) = 2
  LIMIT 1;

  IF existing_conversation_id IS NOT NULL THEN
    RETURN existing_conversation_id;
  END IF;

  INSERT INTO public.conversations (type, name, description, created_by)
  VALUES ('dm'::public.conversation_type, NULL, NULL, actor_id)
  RETURNING id INTO existing_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (existing_conversation_id, actor_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (existing_conversation_id, p_target_user_id)
  ON CONFLICT DO NOTHING;

  RETURN existing_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_get_dm_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_get_dm_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_dm_conversation(UUID) TO service_role;

COMMIT;
