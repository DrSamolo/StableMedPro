"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckSquare,
  Kanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";

import { Avatar } from "@/components/Common";
import { PerfObserver } from "@/components/perf/perf-observer";
import { useAuth } from "@/contexts/AuthContext";
import { setCached } from "@/lib/perf/cache";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils/cn";

const NotificationBell = dynamic(
  () => import("@/components/layout/notification-bell").then((module) => module.NotificationBell),
  { ssr: false },
);

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/dashboard/catalog", label: "Catalogue", icon: ShoppingBag },
  { href: "/dashboard/settings", label: "Parametres", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile, loading, signOut } = useAuth();
  const userId = profile?.id ?? null;
  const [chatUnreadRpcAvailable, setChatUnreadRpcAvailable] = useState(true);

  const chatUnreadQuery = useQuery({
    queryKey: ["sidebar-chat-unread-dot", userId],
    queryFn: async () => {
      if (!userId) return 0;
      const { data, error } = await supabase.rpc("get_chat_unread_messages_total");

      if (error) {
        const code = (error as { code?: string }).code ?? "";
        const isMissingRpc =
          code === "PGRST202" ||
          code === "404" ||
          error.message.toLowerCase().includes("not found");
        if (isMissingRpc) {
          setChatUnreadRpcAvailable(false);
          return 0;
        }
        throw new Error(error.message);
      }

      return Number(data ?? 0);
    },
    enabled: Boolean(userId) && chatUnreadRpcAvailable,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const hasChatUnread = (chatUnreadQuery.data ?? 0) > 0;

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, router, session]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      NAV_ITEMS.forEach((item) => {
        router.prefetch(item.href);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [router, session]);

  useEffect(() => {
    if (!userId) return;

    const warm = async () => {
      const { data } = await supabase
        .from("trainings")
        .select(
          "id,title,target_audience,training_type,format,organization,price,image,status,reference,duration_total,funder,compensation,instructor_name",
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (!data) return;
      setCached(`catalog:list:${userId}`, data);
      setCached(
        `trainings:list:${userId}`,
        data
          .slice(0, 200)
          .map((item) => ({ id: item.id, title: item.title, price: item.price })),
      );
    };

    const timer = window.setTimeout(() => {
      void warm();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [userId]);

  const profileLabel = profile?.full_name?.trim()
    ? profile.full_name
    : profile?.email?.trim()
      ? profile.email.split("@")[0]
      : "Utilisateur";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-sm text-secondary">Chargement...</span>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background text-primary font-sans selection:bg-gray-200">
      <PerfObserver />
      <aside className="fixed left-0 top-0 z-20 flex h-screen w-64 flex-col border-r border-border bg-surface/95 backdrop-blur-sm">
        <div className="mb-6 flex h-16 items-center px-6">
          <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-zinc-900 to-zinc-700 shadow-sm">
            <div className="h-4 w-4 rounded-sm bg-white/90" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-primary">StableMed</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "ui-focus group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "border border-zinc-200 bg-white text-primary shadow-sm"
                    : "text-secondary hover:bg-gray-50 hover:text-primary",
                )}
              >
                <Icon
                  size={20}
                  strokeWidth={1.5}
                  className={cn(
                    "mr-3 shrink-0 transition-colors",
                    isActive ? "text-primary" : "text-gray-400 group-hover:text-primary",
                  )}
                />
                <span className="truncate">{item.label}</span>
                {item.href === "/dashboard/chat" && hasChatUnread ? (
                  <span className="ml-auto inline-flex h-2 w-2 rounded-full bg-sky-500/80" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <button
            onClick={() => {
              void signOut().then(() => router.replace("/login"));
            }}
            className="ui-focus flex w-full items-center rounded-lg px-2 py-2 text-sm text-secondary transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut size={20} strokeWidth={1.5} className="mr-3" />
            <span>Deconnexion</span>
          </button>
        </div>
      </aside>

      <main className="ml-64 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-end gap-3 border-b border-border bg-background/80 px-8 backdrop-blur-sm">
          <NotificationBell />
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="ui-focus flex items-center gap-3 rounded transition-opacity hover:opacity-80"
          >
            <div className="text-right">
              <p className="text-sm font-medium text-primary">{profileLabel}</p>
              <p className="text-xs text-secondary">En ligne</p>
            </div>
            <Avatar name={profile?.full_name || profile?.email || "User"} src={profile?.avatar_url} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
