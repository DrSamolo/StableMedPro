-- =============================================================================
-- STEP 5.13 - Chat access matrix + @all default visibility + add participants RPC
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.can_initiate_chat_with(
  p_target_user_id UUID,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  actor_team_id UUID;
  target_role TEXT;
  target_team_id UUID;
BEGIN
  IF p_actor_id IS NULL OR p_target_user_id IS NULL OR p_target_user_id = p_actor_id THEN
    RETURN FALSE;
  END IF;

  IF public.is_admin(p_actor_id) THEN
    RETURN EXISTS (SELECT 1 FROM public.profiles tp WHERE tp.id = p_target_user_id);
  END IF;

  SELECT p.role, p.team_id
  INTO actor_role, actor_team_id
  FROM public.profiles p
  WHERE p.id = p_actor_id
  LIMIT 1;

  SELECT p.role, p.team_id
  INTO target_role, target_team_id
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  LIMIT 1;

  IF actor_role IS NULL OR target_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_role = 'commercial' THEN
    RETURN (
      target_role = 'admin'
      OR (target_team_id IS NOT NULL AND target_team_id = actor_team_id)
    );
  END IF;

  IF actor_role = 'manager' THEN
    RETURN (
      target_role = 'admin'
      OR target_role = 'manager'
      OR (target_role = 'commercial' AND target_team_id IS NOT NULL AND target_team_id = actor_team_id)
    );
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_initiate_chat_with(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_initiate_chat_with(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_initiate_chat_with(UUID, UUID) TO service_role;

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
    AND public.can_initiate_chat_with(p.id, auth.uid())
  ORDER BY COALESCE(NULLIF(trim(p.full_name), ''), p.email, p.id::text);
$$;

REVOKE ALL ON FUNCTION public.get_chat_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_candidates() TO service_role;

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
  actor_role TEXT;
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

  SELECT p.role
  INTO actor_role
  FROM public.profiles p
  WHERE p.id = actor_id
  LIMIT 1;

  IF NOT public.is_admin(actor_id) AND actor_role <> 'manager' THEN
    RAISE EXCEPTION 'Creation de groupe reservee aux managers et admins';
  END IF;

  selected_count := COALESCE(array_length(p_participant_ids, 1), 0);
  IF selected_count = 0 THEN
    RAISE EXCEPTION 'Selectionnez au moins un participant';
  END IF;

  IF NOT public.is_admin(actor_id) THEN
    SELECT COUNT(*)
    INTO invalid_count
    FROM unnest(COALESCE(p_participant_ids, ARRAY[]::UUID[])) AS pid
    WHERE pid IS NULL
      OR pid = actor_id
      OR NOT public.can_initiate_chat_with(pid, actor_id);

    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'Participants invalides pour votre role';
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
  existing_conversation_id UUID;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Utilisateur cible invalide';
  END IF;

  IF NOT public.can_initiate_chat_with(p_target_user_id, actor_id) THEN
    RAISE EXCEPTION 'Utilisateur cible invalide pour votre role';
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

CREATE OR REPLACE FUNCTION public.add_participants_to_group_conversation(
  p_conversation_id UUID,
  p_participant_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
  conversation_type public.conversation_type;
  inserted_count INTEGER := 0;
  invalid_count INTEGER;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Conversation invalide';
  END IF;

  IF COALESCE(array_length(p_participant_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selectionnez au moins un participant';
  END IF;

  SELECT c.type
  INTO conversation_type
  FROM public.conversations c
  WHERE c.id = p_conversation_id
  LIMIT 1;

  IF conversation_type IS NULL THEN
    RAISE EXCEPTION 'Conversation introuvable';
  END IF;

  IF conversation_type <> 'group'::public.conversation_type THEN
    RAISE EXCEPTION 'Ajout de membre autorise uniquement dans une conversation de groupe';
  END IF;

  IF NOT public.can_manage_conversation(p_conversation_id, actor_id) AND NOT public.is_admin(actor_id) THEN
    RAISE EXCEPTION 'Action reservee au createur de la conversation ou a un admin';
  END IF;

  SELECT p.role INTO actor_role
  FROM public.profiles p
  WHERE p.id = actor_id
  LIMIT 1;

  IF NOT public.is_admin(actor_id) THEN
    IF actor_role <> 'manager' THEN
      RAISE EXCEPTION 'Action reservee aux managers et admins';
    END IF;

    SELECT COUNT(*)
    INTO invalid_count
    FROM unnest(COALESCE(p_participant_ids, ARRAY[]::UUID[])) AS pid
    WHERE pid IS NULL
      OR pid = actor_id
      OR NOT public.can_initiate_chat_with(pid, actor_id);

    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'Participants invalides pour votre role';
    END IF;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT DISTINCT p_conversation_id, pid
  FROM unnest(COALESCE(p_participant_ids, ARRAY[]::UUID[])) AS pid
  WHERE pid IS NOT NULL
    AND pid <> actor_id
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.add_participants_to_group_conversation(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_participants_to_group_conversation(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_participants_to_group_conversation(UUID, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_all_chat_visible_to_everyone()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  all_chat_id UUID;
  system_user_id UUID;
BEGIN
  SELECT c.id
  INTO all_chat_id
  FROM public.conversations c
  WHERE c.type = 'group'::public.conversation_type
    AND lower(trim(COALESCE(c.name, ''))) = '@all'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF all_chat_id IS NULL THEN
    SELECT p.id INTO system_user_id
    FROM public.profiles p
    ORDER BY p.id
    LIMIT 1;

    IF system_user_id IS NULL THEN
      SELECT u.id INTO system_user_id
      FROM auth.users u
      ORDER BY u.id
      LIMIT 1;
    END IF;

    IF system_user_id IS NULL THEN
      RETURN;
    END IF;

    INSERT INTO public.conversations (type, name, description, created_by)
    VALUES (
      'group'::public.conversation_type,
      '@all',
      'Canal systeme visible pour toute l''organisation',
      system_user_id
    )
    RETURNING id INTO all_chat_id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT all_chat_id, p.id
  FROM public.profiles p
  WHERE p.id IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_all_chat_visible_to_everyone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_all_chat_visible_to_everyone() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_all_chat_visible_to_everyone() TO service_role;

CREATE OR REPLACE FUNCTION public.on_profile_created_join_all_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  all_chat_id UUID;
BEGIN
  SELECT c.id
  INTO all_chat_id
  FROM public.conversations c
  WHERE c.type = 'group'::public.conversation_type
    AND lower(trim(COALESCE(c.name, ''))) = '@all'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF all_chat_id IS NOT NULL AND NEW.id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (all_chat_id, NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_join_all_chat ON public.profiles;
CREATE TRIGGER trg_profiles_join_all_chat
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.on_profile_created_join_all_chat();

SELECT public.ensure_all_chat_visible_to_everyone();

COMMIT;

