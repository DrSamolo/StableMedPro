"use client";

import { useEffect, useState, type ComponentType } from "react";

type DashboardComponent = ComponentType<Record<string, never>>;

export default function DashboardPage() {
  const [Dashboard, setDashboard] = useState<DashboardComponent | null>(null);

  useEffect(() => {
    let mounted = true;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const loadDashboard = () => {
      void import("@/components/dashboard/dashboard-page").then((module) => {
        if (mounted) {
          setDashboard(() => module.default as DashboardComponent);
        }
      });
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(loadDashboard, { timeout: 350 });
    } else {
      timeoutId = setTimeout(loadDashboard, 0);
    }

    return () => {
      mounted = false;
      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  if (!Dashboard) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-zinc-200 bg-white">
        <p className="text-sm text-zinc-500">Chargement du dashboard...</p>
      </div>
    );
  }

  return <Dashboard />;
}
