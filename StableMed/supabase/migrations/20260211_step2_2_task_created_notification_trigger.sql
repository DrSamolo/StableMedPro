-- =============================================================================
-- STEP 2.2 - Automation: task-created notification trigger
-- =============================================================================
-- Goals:
-- 1) Notify assignee when a task is created (manual/interactive flows).
-- 2) Avoid duplicate notifications when inserts come from service_role jobs.

BEGIN;

CREATE OR REPLACE FUNCTION public.on_task_created_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Edge jobs run with service role and create their own specific notifications.
  -- Skip trigger-based insert in that context to avoid duplicates.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    metadata,
    is_read
  )
  VALUES (
    NEW.user_id,
    'task_reminder',
    'Nouvelle tache assignee',
    format('Une nouvelle tache a ete creee: %s', NEW.title),
    jsonb_build_object(
      'task_id', NEW.id,
      'lead_id', NEW.lead_id
    ),
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_notify_on_insert ON public.tasks;
CREATE TRIGGER trg_tasks_notify_on_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.on_task_created_notify();

COMMIT;
