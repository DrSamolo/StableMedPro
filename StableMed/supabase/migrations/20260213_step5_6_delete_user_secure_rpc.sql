-- =============================================================================
-- STEP 5.6 - Secure user deletion RPC with reassignment (admin-only)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_user_secure(
  p_user_id UUID,
  p_reassign_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role TEXT;
  admin_count INTEGER := 0;
  moved_leads INTEGER := 0;
  moved_deals INTEGER := 0;
  moved_tasks INTEGER := 0;
  deleted_notifications INTEGER := 0;
  moved_comments INTEGER := 0;
  moved_invitations INTEGER := 0;
  cleared_manager_refs INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifie';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acces reserve aux admins';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur cible invalide';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Suppression de son propre compte interdite';
  END IF;

  SELECT p.role INTO target_role
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  IF p_reassign_user_id IS NOT NULL THEN
    IF p_reassign_user_id = p_user_id THEN
      RAISE EXCEPTION 'La reassignment doit pointer vers un autre utilisateur';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_reassign_user_id) THEN
      RAISE EXCEPTION 'Utilisateur de reassignment introuvable';
    END IF;
  END IF;

  IF target_role = 'admin' THEN
    SELECT COUNT(*) INTO admin_count
    FROM public.profiles p
    WHERE p.role = 'admin';

    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'Impossible de supprimer le dernier admin';
    END IF;
  END IF;

  UPDATE public.leads l
  SET user_id = p_reassign_user_id
  WHERE l.user_id = p_user_id;
  GET DIAGNOSTICS moved_leads = ROW_COUNT;

  UPDATE public.deals d
  SET owner_id = p_reassign_user_id
  WHERE d.owner_id = p_user_id;
  GET DIAGNOSTICS moved_deals = ROW_COUNT;

  UPDATE public.tasks t
  SET user_id = p_reassign_user_id
  WHERE t.user_id = p_user_id;
  GET DIAGNOSTICS moved_tasks = ROW_COUNT;

  DELETE FROM public.notifications n
  WHERE n.user_id = p_user_id;
  GET DIAGNOSTICS deleted_notifications = ROW_COUNT;

  UPDATE public.comments c
  SET user_id = p_reassign_user_id
  WHERE c.user_id = p_user_id;
  GET DIAGNOSTICS moved_comments = ROW_COUNT;

  UPDATE public.invitations i
  SET created_by = p_reassign_user_id
  WHERE i.created_by = p_user_id;
  GET DIAGNOSTICS moved_invitations = ROW_COUNT;

  UPDATE public.profiles p
  SET manager_id = p_reassign_user_id
  WHERE p.manager_id = p_user_id;
  GET DIAGNOSTICS cleared_manager_refs = ROW_COUNT;

  DELETE FROM auth.users u
  WHERE u.id = p_user_id;

  RETURN jsonb_build_object(
    'deleted_user_id', p_user_id,
    'reassigned_user_id', p_reassign_user_id,
    'moved_leads', moved_leads,
    'moved_deals', moved_deals,
    'moved_tasks', moved_tasks,
    'deleted_notifications', deleted_notifications,
    'moved_comments', moved_comments,
    'moved_invitations', moved_invitations,
    'updated_manager_refs', cleared_manager_refs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_secure(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_secure(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_secure(UUID, UUID) TO service_role;

COMMIT;
