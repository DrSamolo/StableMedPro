-- =============================================================================
-- STEP 3.4 - Chat RPC: create conversation with self participant
-- =============================================================================
-- Goal:
-- 1) Provide a single authenticated entrypoint to create a conversation.
-- 2) Ensure creator is immediately inserted as participant.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_conversation_with_self_participant(
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  new_conversation_id UUID;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Le nom de conversation doit contenir au moins 2 caracteres';
  END IF;

  INSERT INTO public.conversations (type, name, description, created_by)
  VALUES (
    'group'::public.conversation_type,
    trim(p_name),
    NULLIF(trim(coalesce(p_description, '')), ''),
    actor_id
  )
  RETURNING id INTO new_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (new_conversation_id, actor_id)
  ON CONFLICT DO NOTHING;

  RETURN new_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_conversation_with_self_participant(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_self_participant(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_self_participant(TEXT, TEXT) TO service_role;

COMMIT;
