-- =============================================================================
-- STEP 5.8 - Refresh @all sales announcement wording
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_sale_announcement_to_all_chat(
  p_lead_name TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'EUR'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_name TEXT;
  all_chat_id UUID;
  normalized_lead_name TEXT;
  normalized_currency TEXT;
  message_body TEXT;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  normalized_lead_name := NULLIF(trim(COALESCE(p_lead_name, '')), '');
  IF normalized_lead_name IS NULL THEN
    RAISE EXCEPTION 'Nom du lead invalide';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Montant de vente invalide';
  END IF;

  normalized_currency := upper(NULLIF(trim(COALESCE(p_currency, '')), ''));
  IF normalized_currency IS NULL THEN
    normalized_currency := 'EUR';
  END IF;

  SELECT COALESCE(
    NULLIF(trim(p.full_name), ''),
    NULLIF(split_part(COALESCE(p.email, ''), '@', 1), '')
  )
  INTO actor_name
  FROM public.profiles p
  WHERE p.id = actor_id
  LIMIT 1;

  IF actor_name IS NULL THEN
    SELECT NULLIF(split_part(COALESCE(u.email, ''), '@', 1), '')
    INTO actor_name
    FROM auth.users u
    WHERE u.id = actor_id
    LIMIT 1;
  END IF;

  actor_name := COALESCE(actor_name, 'Un commercial');

  SELECT c.id
  INTO all_chat_id
  FROM public.conversations c
  WHERE c.type = 'group'::public.conversation_type
    AND lower(trim(COALESCE(c.name, ''))) = '@all'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF all_chat_id IS NULL THEN
    INSERT INTO public.conversations (type, name, description, created_by)
    VALUES (
      'group'::public.conversation_type,
      '@all',
      'Canal systeme pour les annonces de vente',
      actor_id
    )
    RETURNING id INTO all_chat_id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT all_chat_id, users.user_id
  FROM (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.id IS NOT NULL
    UNION
    SELECT actor_id AS user_id
  ) AS users
  ON CONFLICT DO NOTHING;

  message_body := format(
    '🔥 @all Nouveau deal signe : %s vient de conclure %s pour %s %s. Bravo !',
    actor_name,
    normalized_lead_name,
    trim(to_char(p_amount, 'FM999999999999990D00')),
    normalized_currency
  );

  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (all_chat_id, actor_id, left(message_body, 4000));

  RETURN all_chat_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_sale_announcement_to_all_chat(TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_sale_announcement_to_all_chat(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_sale_announcement_to_all_chat(TEXT, NUMERIC, TEXT) TO service_role;

COMMIT;
