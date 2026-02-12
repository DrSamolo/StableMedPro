"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isBefore, startOfDay } from "date-fns";
import { AlertTriangle, X } from "lucide-react";

import { supabase } from "@/lib/supabase";

type BriefingTask = {
  id: string;
  title: string;
  due_at: string | null;
  priority: "low" | "medium" | "high" | "critical";
};

const BRIEFING_STORAGE_KEY = "stablemed.daily_briefing_seen_at";

export function DailyBriefing({ userName }: { userName?: string | null }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<BriefingTask[]>([]);

  useEffect(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const lastSeen = window.localStorage.getItem(BRIEFING_STORAGE_KEY);
    if (lastSeen === today) return;

    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,due_at,priority,status")
        .in("status", ["todo", "in_progress"])
        .order("due_at", { ascending: true })
        .limit(20);

      if (!active || error || !data) return;

      const todayStart = startOfDay(new Date());
      const urgentTasks = (data as BriefingTask[]).filter((task) => {
        const isCritical = task.priority === "critical";
        const isOverdue =
          task.due_at != null &&
          isBefore(new Date(task.due_at), todayStart) &&
          !Number.isNaN(new Date(task.due_at).getTime());
        return isCritical || isOverdue;
      });

      if (urgentTasks.length === 0) return;
      setTasks(urgentTasks.slice(0, 3));
      setOpen(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  const greeting = useMemo(() => {
    if (userName && userName.trim().length > 0) return `Bonjour ${userName}`;
    return "Bonjour";
  }, [userName]);

  const closeBriefing = () => {
    window.localStorage.setItem(BRIEFING_STORAGE_KEY, format(new Date(), "yyyy-MM-dd"));
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm motion-page-enter">
      <div className="w-full max-w-lg rounded-md border border-zinc-200 bg-white p-6 shadow-card motion-scale-in">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              {greeting}, voici vos {tasks.length} urgences pour aujourd&apos;hui.
            </p>
            <p className="mt-1 text-sm text-zinc-500">Focus sur les actions critiques et en retard.</p>
          </div>
          <button
            type="button"
            onClick={closeBriefing}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 motion-soft-hover motion-soft-press"
            aria-label="Fermer le briefing"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-md border border-zinc-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <p className="text-sm font-medium text-zinc-800">{task.title}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={closeBriefing}
          className="mt-5 inline-flex rounded-sm bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 motion-soft-hover motion-soft-press"
        >
          Demarrer
        </button>
      </div>
    </div>
  );
}
