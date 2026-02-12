import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { useNotification } from "../contexts/NotificationContext";
import { supabase } from "../lib/supabase";

type NotificationKind = "task_reminder" | "lead_update" | "system";

export interface UserNotification {
  id: string;
  user_id: string;
  type: NotificationKind;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

const MAX_NOTIFICATIONS = 25;

export function useNotifications() {
  const { user } = useAuth();
  const { addNotification } = useNotification();
  const userId = user?.id ?? null;
  const [latestNotifications, setLatestNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setLatestNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [notificationsRes, unreadRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_NOTIFICATIONS),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false),
    ]);

    if (!notificationsRes.error) {
      setLatestNotifications((notificationsRes.data ?? []) as UserNotification[]);
    }

    if (!unreadRes.error) {
      setUnreadCount(unreadRes.count ?? 0);
    }

    setLoading(false);
  }, [userId]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!userId) {
        return;
      }

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("is_read", false);

      if (error) {
        console.error("[useNotifications] markAsRead failed:", error.message);
        return;
      }

      setLatestNotifications((previous) =>
        previous.map((notification) =>
          notification.id === id ? { ...notification, is_read: true } : notification,
        ),
      );
      setUnreadCount((previous) => Math.max(0, previous - 1));
    },
    [userId],
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) {
      return;
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      console.error("[useNotifications] markAllAsRead failed:", error.message);
      return;
    }

    setLatestNotifications((previous) => previous.map((notification) => ({ ...notification, is_read: true })));
    setUnreadCount(0);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          const notification = payload.new as UserNotification;
          if (notification.user_id !== userId) {
            return;
          }

          setLatestNotifications((previous) => [notification, ...previous].slice(0, MAX_NOTIFICATIONS));
          if (!notification.is_read) {
            setUnreadCount((previous) => previous + 1);
          }

          addNotification("info", `Nouvelle notification : ${notification.title}`);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          const notification = payload.new as UserNotification;
          if (notification.user_id !== userId) {
            return;
          }

          setLatestNotifications((previous) =>
            previous.map((item) => (item.id === notification.id ? notification : item)),
          );

          const previousRow = payload.old as Partial<UserNotification>;
          if (previousRow.is_read === false && notification.is_read === true) {
            setUnreadCount((previous) => Math.max(0, previous - 1));
          } else if (previousRow.is_read === true && notification.is_read === false) {
            setUnreadCount((previous) => previous + 1);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [addNotification, userId]);

  return useMemo(
    () => ({
      latestNotifications,
      unreadCount,
      loading,
      refresh,
      markAsRead,
      markAllAsRead,
    }),
    [latestNotifications, unreadCount, loading, refresh, markAsRead, markAllAsRead],
  );
}
