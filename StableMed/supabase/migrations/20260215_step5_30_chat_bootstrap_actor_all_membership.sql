-- =============================================================================
-- STEP 5.30 - Chat bootstrap: ensure actor membership in @all on demand
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_actor_all_chat_membership(
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  all_chat_id UUID;
  system_user_id UUID;
BEGIN
  actor_id := COALESCE(p_actor_id, auth.uid());

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = actor_id
  ) THEN
    RAISE EXCEPTION 'Profil introuvable';
  END IF;

  SELECT c.id
  INTO all_chat_id
  FROM public.conversations c
  WHERE c.type = 'group'::public.conversation_type
    AND lower(trim(COALESCE(c.name, ''))) = '@all'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF all_chat_id IS NULL THEN
    SELECT p.id
    INTO system_user_id
    FROM public.profiles p
    ORDER BY p.id
    LIMIT 1;

    IF system_user_id IS NULL THEN
      SELECT u.id
      INTO system_user_id
      FROM auth.users u
      ORDER BY u.id
      LIMIT 1;
    END IF;

    IF system_user_id IS NULL THEN
      RAISE EXCEPTION 'Impossible de creer le canal @all sans utilisateur systeme';
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
  VALUES (all_chat_id, actor_id)
  ON CONFLICT DO NOTHING;

  RETURN all_chat_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_actor_all_chat_membership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_actor_all_chat_membership(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_actor_all_chat_membership(UUID) TO service_role;

COMMIT;
