-- =============================================================================
-- STEP 3.9 - Chat performance: unread total RPC (lightweight)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_chat_unread_messages_total()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS actor_id
  ),
  my_conversations AS (
    SELECT cp.conversation_id, cp.last_read_at
    FROM public.conversation_participants cp
    CROSS JOIN me
    WHERE me.actor_id IS NOT NULL
      AND cp.user_id = me.actor_id
  )
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM public.messages m
  INNER JOIN my_conversations mc ON mc.conversation_id = m.conversation_id
  CROSS JOIN me
  WHERE m.sender_id <> me.actor_id
    AND m.created_at > COALESCE(mc.last_read_at, '1970-01-01T00:00:00.000Z'::timestamptz);
$$;

REVOKE ALL ON FUNCTION public.get_chat_unread_messages_total() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_messages_total() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_messages_total() TO service_role;

COMMIT;
