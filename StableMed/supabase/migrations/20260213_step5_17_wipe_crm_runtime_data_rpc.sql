-- =============================================================================
-- STEP 5.17 - Wipe CRM runtime data (admin RPC, keep structure/users/permissions)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wipe_crm_runtime_data(
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_audit_logs INTEGER := 0;
  deleted_notifications INTEGER := 0;
  deleted_comments INTEGER := 0;
  deleted_lead_trainings INTEGER := 0;
  deleted_leads INTEGER := 0;
  deleted_deal_trainings INTEGER := 0;
  deleted_deals INTEGER := 0;
  deleted_tasks INTEGER := 0;
  deleted_invitations INTEGER := 0;
  deleted_messages INTEGER := 0;
  deleted_conversation_participants INTEGER := 0;
  deleted_conversations INTEGER := 0;
  deleted_chat_messages INTEGER := 0;
  deleted_chat_channels INTEGER := 0;
  deleted_trainings INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF COALESCE(p_confirmation, '') <> 'WIPE_CRM_RUNTIME_DATA' THEN
    RAISE EXCEPTION 'Confirmation invalide (attendu: WIPE_CRM_RUNTIME_DATA)';
  END IF;

  -- Keep schema, auth users, profiles, teams, role permissions and app settings intact.
  -- Only purge operational/business data.

  DELETE FROM public.audit_logs;
  GET DIAGNOSTICS deleted_audit_logs = ROW_COUNT;

  DELETE FROM public.notifications;
  GET DIAGNOSTICS deleted_notifications = ROW_COUNT;

  DELETE FROM public.comments;
  GET DIAGNOSTICS deleted_comments = ROW_COUNT;

  DELETE FROM public.lead_trainings;
  GET DIAGNOSTICS deleted_lead_trainings = ROW_COUNT;

  DELETE FROM public.leads;
  GET DIAGNOSTICS deleted_leads = ROW_COUNT;

  DELETE FROM public.deal_trainings;
  GET DIAGNOSTICS deleted_deal_trainings = ROW_COUNT;

  DELETE FROM public.deals;
  GET DIAGNOSTICS deleted_deals = ROW_COUNT;

  DELETE FROM public.tasks;
  GET DIAGNOSTICS deleted_tasks = ROW_COUNT;

  DELETE FROM public.invitations;
  GET DIAGNOSTICS deleted_invitations = ROW_COUNT;

  DELETE FROM public.messages;
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  DELETE FROM public.conversation_participants;
  GET DIAGNOSTICS deleted_conversation_participants = ROW_COUNT;

  DELETE FROM public.conversations;
  GET DIAGNOSTICS deleted_conversations = ROW_COUNT;

  DELETE FROM public.chat_messages;
  GET DIAGNOSTICS deleted_chat_messages = ROW_COUNT;

  DELETE FROM public.chat_channels;
  GET DIAGNOSTICS deleted_chat_channels = ROW_COUNT;

  DELETE FROM public.trainings;
  GET DIAGNOSTICS deleted_trainings = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_audit_logs', deleted_audit_logs,
    'deleted_notifications', deleted_notifications,
    'deleted_comments', deleted_comments,
    'deleted_lead_trainings', deleted_lead_trainings,
    'deleted_leads', deleted_leads,
    'deleted_deal_trainings', deleted_deal_trainings,
    'deleted_deals', deleted_deals,
    'deleted_tasks', deleted_tasks,
    'deleted_invitations', deleted_invitations,
    'deleted_messages', deleted_messages,
    'deleted_conversation_participants', deleted_conversation_participants,
    'deleted_conversations', deleted_conversations,
    'deleted_chat_messages', deleted_chat_messages,
    'deleted_chat_channels', deleted_chat_channels,
    'deleted_trainings', deleted_trainings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wipe_crm_runtime_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wipe_crm_runtime_data(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_crm_runtime_data(TEXT) TO service_role;

COMMIT;

