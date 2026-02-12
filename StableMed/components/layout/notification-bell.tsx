"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils/cn";

type NotificationItem = {
  id: string;
  user_id: string;
  type: "task_reminder" | "lead_update" | "system" | "mention";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const userId = profile?.id ?? null;

  const unreadCountQuery = useQuery({
    queryKey: ["header-notifications-unread-count", userId],
    queryFn: async () => {
      if (!userId) return 0;

      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("type", "eq", "message")
        .eq("is_read", false);

      if (error) {
        throw new Error(error.message);
      }

      return Number(count ?? 0);
    },
    enabled: Boolean(userId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const notificationsQuery = useQuery({
    queryKey: ["header-notifications", userId, isOpen],
    queryFn: async () => {
      if (!userId) return [] as NotificationItem[];

      const { data, error } = await supabase
        .from("notifications")
        .select("id,user_id,type,title,message,is_read,created_at")
        .eq("user_id", userId)
        .not("type", "eq", "message")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as NotificationItem[];
    },
    enabled: Boolean(userId) && isOpen,
    staleTime: 30_000,
    refetchOnMount: false,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = useMemo(() => {
    if (typeof unreadCountQuery.data === "number") {
      return unreadCountQuery.data;
    }
    return notifications.filter((item) => !item.is_read).length;
  }, [notifications, unreadCountQuery.data]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`header-notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["header-notifications-unread-count", userId] });
          if (isOpen) {
            await queryClient.invalidateQueries({ queryKey: ["header-notifications", userId] });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isOpen, queryClient, userId]);

  async function markAllAsRead() {
    if (!userId) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .not("type", "eq", "message")
      .eq("is_read", false);

    if (error) {
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["header-notifications-unread-count", userId] });
    await queryClient.invalidateQueries({ queryKey: ["header-notifications", userId] });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent bg-transparent text-zinc-500 transition hover:bg-white hover:text-zinc-900"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 inline-flex h-1.5 w-1.5 rounded-full bg-zinc-500" />
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-12 z-40 w-[22rem] rounded-md border border-zinc-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
            <p className="text-sm font-semibold text-zinc-900">Notifications</p>
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 transition hover:text-zinc-900"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tout lire
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {notificationsQuery.isLoading ? (
              <div className="ui-state-box ui-state-loading py-4 text-center">
                <div className="ui-state-stack">
                  <p className="ui-state-title">Chargement...</p>
                  <p className="ui-state-text">Récupération des notifications.</p>
                </div>
              </div>
            ) : notifications.length === 0 ? (
              <div className="ui-state-box ui-state-empty py-4 text-center">
                <div className="ui-state-stack">
                  <p className="ui-state-title">Aucune notification</p>
                  <p className="ui-state-text">Les prochaines alertes apparaîtront ici.</p>
                </div>
              </div>
            ) : (
              notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={cn(
                    "rounded-lg border px-2.5 py-2",
                    notification.is_read ? "border-zinc-100 bg-white" : "border-zinc-200 bg-zinc-50/80",
                  )}
                >
                  <p className="text-xs font-semibold text-zinc-800">{notification.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">{notification.message}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{formatNotificationTime(notification.created_at)}</p>
                </article>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
