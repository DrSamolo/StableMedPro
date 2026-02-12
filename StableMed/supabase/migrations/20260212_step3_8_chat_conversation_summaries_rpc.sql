-- =============================================================================
-- STEP 3.8 - Chat performance: aggregated conversation summaries RPC
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_chat_conversation_summaries(
  p_limit INTEGER DEFAULT 100,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  conversation_type public.conversation_type,
  conversation_name TEXT,
  conversation_description TEXT,
  conversation_created_by UUID,
  conversation_created_at TIMESTAMPTZ,
  conversation_updated_at TIMESTAMPTZ,
  participants_count INTEGER,
  unread_count INTEGER,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  activity_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS actor_id
  ),
  scoped_conversations AS (
    SELECT
      c.id,
      c.type,
      c.name,
      c.description,
      c.created_by,
      c.created_at,
      c.updated_at
    FROM public.conversations c
    INNER JOIN public.conversation_participants cp_me
      ON cp_me.conversation_id = c.id
    CROSS JOIN me
    WHERE me.actor_id IS NOT NULL
      AND cp_me.user_id = me.actor_id
  ),
  my_reads AS (
    SELECT cp.conversation_id, cp.last_read_at
    FROM public.conversation_participants cp
    CROSS JOIN me
    WHERE cp.user_id = me.actor_id
  ),
  participants_by_conversation AS (
    SELECT cp.conversation_id, COUNT(*)::INTEGER AS participants_count
    FROM public.conversation_participants cp
    INNER JOIN scoped_conversations sc ON sc.id = cp.conversation_id
    GROUP BY cp.conversation_id
  ),
  last_message_by_conversation AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.created_at AS last_message_at,
      left(m.content, 120) AS last_message_preview
    FROM public.messages m
    INNER JOIN scoped_conversations sc ON sc.id = m.conversation_id
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_by_conversation AS (
    SELECT
      m.conversation_id,
      COUNT(*)::INTEGER AS unread_count
    FROM public.messages m
    INNER JOIN scoped_conversations sc ON sc.id = m.conversation_id
    INNER JOIN my_reads mr ON mr.conversation_id = m.conversation_id
    CROSS JOIN me
    WHERE m.sender_id <> me.actor_id
      AND m.created_at > COALESCE(mr.last_read_at, '1970-01-01T00:00:00.000Z'::timestamptz)
    GROUP BY m.conversation_id
  ),
  dm_display_names AS (
    SELECT
      sc.id AS conversation_id,
      COALESCE(
        NULLIF(trim(p.full_name), ''),
        NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''),
        NULLIF(trim((u.raw_user_meta_data ->> 'full_name')::text), ''),
        NULLIF(split_part(COALESCE(u.email::text, ''), '@', 1), '')
      ) AS display_name
    FROM scoped_conversations sc
    LEFT JOIN LATERAL (
      SELECT cp_other.user_id
      FROM public.conversation_participants cp_other
      CROSS JOIN me
      WHERE cp_other.conversation_id = sc.id
        AND cp_other.user_id <> me.actor_id
      LIMIT 1
    ) dm_other ON TRUE
    LEFT JOIN public.profiles p ON p.id = dm_other.user_id
    LEFT JOIN auth.users u ON u.id = dm_other.user_id
    WHERE sc.type = 'dm'::public.conversation_type
  ),
  assembled AS (
    SELECT
      sc.id AS conversation_id,
      sc.type AS conversation_type,
      CASE
        WHEN sc.type = 'dm'::public.conversation_type AND NULLIF(trim(COALESCE(sc.name, '')), '') IS NULL
          THEN COALESCE(dm.display_name, 'DM')
        ELSE sc.name
      END AS conversation_name,
      sc.description AS conversation_description,
      sc.created_by AS conversation_created_by,
      sc.created_at AS conversation_created_at,
      sc.updated_at AS conversation_updated_at,
      COALESCE(pc.participants_count, 0) AS participants_count,
      COALESCE(uc.unread_count, 0) AS unread_count,
      lm.last_message_at,
      lm.last_message_preview,
      COALESCE(lm.last_message_at, sc.updated_at) AS activity_at
    FROM scoped_conversations sc
    LEFT JOIN participants_by_conversation pc ON pc.conversation_id = sc.id
    LEFT JOIN unread_by_conversation uc ON uc.conversation_id = sc.id
    LEFT JOIN last_message_by_conversation lm ON lm.conversation_id = sc.id
    LEFT JOIN dm_display_names dm ON dm.conversation_id = sc.id
  )
  SELECT
    a.conversation_id,
    a.conversation_type,
    a.conversation_name,
    a.conversation_description,
    a.conversation_created_by,
    a.conversation_created_at,
    a.conversation_updated_at,
    a.participants_count,
    a.unread_count,
    a.last_message_at,
    a.last_message_preview,
    a.activity_at
  FROM assembled a
  WHERE p_before IS NULL OR a.activity_at < p_before
  ORDER BY a.activity_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

REVOKE ALL ON FUNCTION public.get_chat_conversation_summaries(INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_conversation_summaries(INTEGER, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_conversation_summaries(INTEGER, TIMESTAMPTZ) TO service_role;

COMMIT;
