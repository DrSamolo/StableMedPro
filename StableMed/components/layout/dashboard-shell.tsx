"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  CheckSquare,
  Kanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";

import { Avatar, BrandLockup, BrandMark } from "@/components/Common";
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
  { href: "/dashboard/tasks", label: "Tâches", icon: CheckSquare },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/dashboard/catalog", label: "Catalogue", icon: ShoppingBag },
  { href: "/dashboard/settings", label: "Paramètres", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile, loading, signOut } = useAuth();
  const userId = profile?.id ?? null;
  const [chatUnreadRpcAvailable, setChatUnreadRpcAvailable] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
    const savedState = window.localStorage.getItem("stablemed.sidebar.collapsed");
    if (savedState === "1") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("stablemed.sidebar.collapsed", isSidebarCollapsed ? "1" : "0");
  }, [isSidebarCollapsed]);

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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4">
          <div className="motion-fade-up">
            <BrandMark className="h-11 w-11 animate-[spin_1.15s_linear_infinite] shadow-card" />
          </div>
          <p className="text-sm text-secondary">Chargement de votre espace...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background font-sans text-primary selection:bg-gray-200 motion-page-enter">
      <PerfObserver />
      <aside
        className={cn(
          "fixed left-0 top-0 z-20 flex h-screen flex-col border-r border-border bg-surface motion-slide-in-right transition-[width] duration-300 ease-sweet",
          isSidebarCollapsed ? "w-[74px]" : "w-64",
        )}
      >
        <div
          className={cn("mb-6 flex h-16 items-center", isSidebarCollapsed ? "justify-center px-2" : "px-6")}
          data-stagger-item="0"
        >
          <BrandLockup compact={isSidebarCollapsed} />
        </div>

        <nav className={cn("flex-1 space-y-1", isSidebarCollapsed ? "px-2" : "px-3")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "ui-focus group flex w-full items-center rounded-md py-2.5 text-sm font-medium transition-all motion-soft-hover motion-soft-press",
                  isSidebarCollapsed ? "justify-center px-2" : "px-3",
                  isActive
                    ? "border border-zinc-200 bg-zinc-100 text-primary"
                    : "text-secondary hover:bg-zinc-50 hover:text-primary",
                )}
                data-stagger-item="1"
              >
                <Icon
                  size={20}
                  strokeWidth={1.5}
                  className={cn(
                    "shrink-0 transition-colors",
                    isSidebarCollapsed ? "mr-0" : "mr-3",
                    isActive ? "text-primary" : "text-zinc-400 group-hover:text-primary",
                  )}
                />
                {!isSidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
                {item.href === "/dashboard/chat" && hasChatUnread ? (
                  <span
                    className={cn(
                      "inline-flex h-2 w-2 rounded-full bg-zinc-500/80",
                      isSidebarCollapsed ? "absolute right-2 top-2" : "ml-auto",
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={cn("border-t border-border", isSidebarCollapsed ? "p-2" : "p-3")}>
          <button
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            className={cn(
              "ui-focus mb-1 flex w-full items-center rounded-md py-2 text-sm text-secondary transition-colors hover:bg-zinc-50 hover:text-primary",
              isSidebarCollapsed ? "justify-center px-1" : "px-2",
            )}
            aria-label={isSidebarCollapsed ? "Agrandir la barre latérale" : "Réduire la barre latérale"}
          >
            <PanelLeftClose
              size={18}
              strokeWidth={1.5}
              className={cn("transition-transform duration-300 ease-sweet", isSidebarCollapsed ? "rotate-180" : "")}
            />
            {!isSidebarCollapsed ? <span className="ml-3">Réduire</span> : null}
          </button>
          <button
            onClick={() => {
              void signOut().then(() => router.replace("/login"));
            }}
            className={cn(
              "ui-focus flex w-full items-center rounded-md py-2 text-sm text-secondary transition-colors hover:bg-rose-50 hover:text-rose-700",
              isSidebarCollapsed ? "justify-center px-1" : "px-2",
            )}
          >
            <LogOut size={18} strokeWidth={1.5} className={cn(isSidebarCollapsed ? "mr-0" : "mr-3")} />
            {!isSidebarCollapsed ? <span>Déconnexion</span> : null}
          </button>
        </div>
      </aside>

      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300 ease-sweet",
          isSidebarCollapsed ? "ml-[74px]" : "ml-64",
        )}
      >
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/60 px-8 backdrop-blur-sm motion-fade-up">
          <div className="flex min-w-0 flex-1 items-center gap-3" data-stagger-item="1">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Rechercher... (⌘K)"
                className="h-10 w-full rounded-md border border-white/35 bg-white/10 pl-10 pr-10 text-sm text-zinc-700 placeholder:text-zinc-500 outline-none backdrop-blur-xl transition hover:bg-white/15 focus:border-white/45 focus:bg-white/20 focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.18)] motion-soft-hover"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-white/40 bg-white/15 px-1.5 py-0.5 text-[11px] text-zinc-500 backdrop-blur-xl">
                ⌘K
              </span>
            </div>
          </div>
          <NotificationBell />
          <div className="h-7 w-px bg-border" />
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="ui-focus flex items-center gap-3 rounded transition-opacity hover:opacity-80"
            data-stagger-item="2"
          >
            <div className="text-right">
              <p className="text-sm font-medium text-primary">{profileLabel}</p>
              <p className="text-xs text-secondary">En ligne</p>
            </div>
            <Avatar name={profile?.full_name || profile?.email || "User"} src={profile?.avatar_url} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7 xl:p-9 motion-fade-up">{children}</div>
      </main>
    </div>
  );
}
