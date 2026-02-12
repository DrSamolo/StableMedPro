"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { DailyBriefing } from "@/components/tasks/daily-briefing";
import { EditableTask, TaskModal } from "@/components/tasks/task-modal";
import { SlideOver } from "@/components/Common";
import { useSectionPerf } from "@/lib/perf/use-section-perf";
import { cn } from "@/lib/utils/cn";
import { supabase } from "@/lib/supabase";

type TaskWithLead = EditableTask & {
  leads?: { id: string; name: string | null; client_reference: string | null } | null;
};

type ViewMode = "list" | "calendar";

const priorityPillClass: Record<TaskWithLead["priority"], string> = {
  low: "bg-zinc-100 text-zinc-700",
  medium: "bg-slate-100 text-slate-700",
  high: "bg-amber-50 text-amber-700",
  critical: "bg-rose-50 text-rose-700",
};

const priorityAccentClass: Record<TaskWithLead["priority"], string> = {
  low: "border-l-zinc-300",
  medium: "border-l-slate-300",
  high: "border-l-amber-300",
  critical: "border-l-rose-300",
};

const priorityDotClass: Record<TaskWithLead["priority"], string> = {
  low: "bg-zinc-400",
  medium: "bg-slate-400",
  high: "bg-amber-400",
  critical: "bg-rose-400",
};

function startOfTomorrow(date = new Date()) {
  return addDays(startOfDay(date), 1);
}

function groupTasks(tasks: TaskWithLead[]) {
  const today = startOfDay(new Date());
  const tomorrow = startOfTomorrow(today);

  const overdue: TaskWithLead[] = [];
  const todayTasks: TaskWithLead[] = [];
  const tomorrowTasks: TaskWithLead[] = [];

  for (const task of tasks) {
    if (task.status === "done") continue;
    if (!task.due_at) continue;

    const dueDate = parseISO(task.due_at);
    if (Number.isNaN(dueDate.getTime())) continue;

    if (dueDate < today) {
      overdue.push(task);
      continue;
    }
    if (isSameDay(dueDate, today)) {
      todayTasks.push(task);
      continue;
    }
    if (isSameDay(dueDate, tomorrow)) {
      tomorrowTasks.push(task);
    }
  }

  return { overdue, today: todayTasks, tomorrow: tomorrowTasks };
}

function DraggableTask({ task, onOpen }: { task: TaskWithLead; onOpen: (task: TaskWithLead) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: task,
  });

  return (
    <button
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      onClick={() => onOpen(task)}
      className={cn(
        "w-full rounded-md border border-zinc-200 border-l-4 bg-white px-1.5 py-1 text-left shadow-sm transition hover:border-zinc-300 motion-soft-hover motion-soft-press",
        priorityAccentClass[task.priority],
        isDragging ? "opacity-60" : "",
      )}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", priorityDotClass[task.priority])} />
        <p className="truncate text-xs font-medium text-zinc-900">{task.title}</p>
      </div>
    </button>
  );
}

function DroppableDay({
  day,
  tasks,
  isCurrentMonth,
  onOpenTask,
  onOpenDay,
}: {
  day: Date;
  tasks: TaskWithLead[];
  isCurrentMonth: boolean;
  onOpenTask: (task: TaskWithLead) => void;
  onOpenDay: (day: Date, tasks: TaskWithLead[]) => void;
}) {
  const droppableId = `day-${format(day, "yyyy-MM-dd")}`;
  const { isOver, setNodeRef } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-24 rounded-md border p-1.5 md:h-28 md:p-2 lg:h-32 motion-fade-up",
        isCurrentMonth ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50",
        isOver ? "ring-2 ring-zinc-900" : "",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDay(day, tasks)}
        className={cn(
          "mb-1.5 text-xs font-medium transition hover:text-zinc-900",
          isCurrentMonth ? "text-zinc-700" : "text-zinc-500",
        )}
      >
        {format(day, "d")}
      </button>
      <div className="h-[calc(100%-1.3rem)] space-y-1 overflow-y-auto pr-0.5">
        {tasks.slice(0, 2).map((task) => (
          <DraggableTask key={task.id} task={task} onOpen={onOpenTask} />
        ))}
        {tasks.length > 2 ? (
          <button
            type="button"
            onClick={() => onOpenDay(day, tasks)}
            className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 motion-soft-hover motion-soft-press"
          >
            +{tasks.length - 2} plus
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggleDone,
  onOpenTask,
}: {
  task: TaskWithLead;
  onToggleDone: (task: TaskWithLead, checked: boolean) => void;
  onOpenTask: (task: TaskWithLead) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 motion-fade-up">
      <input
        type="checkbox"
        checked={task.status === "done"}
        onChange={(event) => onToggleDone(task, event.target.checked)}
        className="h-4 w-4 rounded border-zinc-300"
      />
      <button onClick={() => onOpenTask(task)} className="truncate text-left text-sm font-medium text-zinc-800">
        {task.title}
      </button>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", priorityPillClass[task.priority])}>
        {task.priority}
      </span>
      {task.lead_id ? (
        <Link href={`/leads/${task.lead_id}`} className="text-xs text-zinc-500 hover:text-zinc-900">
          {task.leads?.name ?? "Lead"}
        </Link>
      ) : (
        <span className="text-xs text-zinc-400">Aucun lead</span>
      )}
    </div>
  );
}

export function TasksDashboard() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [monthCursor, setMonthCursor] = useState<Date>(new Date());
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskWithLead | null>(null);
  const [dayPreview, setDayPreview] = useState<{ day: Date; tasks: TaskWithLead[] } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { data: userName } = useQuery({
    queryKey: ["profile-name"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.user_metadata?.full_name ?? user?.email ?? null;
    },
    staleTime: 60_000,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,description,lead_id,due_at,priority,status,created_at,updated_at, leads:lead_id (id,name,client_reference)")
        .order("due_at", { ascending: true, nullsFirst: false });

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as Array<
        TaskWithLead & { leads?: TaskWithLead["leads"] | TaskWithLead["leads"][] | null }
      >;

      return rows.map((row) => {
        const maybeLead = Array.isArray(row.leads) ? row.leads[0] ?? null : row.leads ?? null;
        return {
          ...row,
          leads: maybeLead,
        };
      });
    },
    staleTime: 30_000,
  });

  const taskErrorMessage =
    tasksQuery.error instanceof Error ? tasksQuery.error.message : "Erreur inconnue";
  useSectionPerf("tasks", tasksQuery.isLoading);

  const toggleDoneMutation = useMutation({
    mutationFn: async ({ taskId, isDone }: { taskId: string; isDone: boolean }) => {
      const { data, error } = await supabase
        .from("tasks")
        .update({ status: isDone ? "done" : "todo" })
        .eq("id", taskId)
        .select("id,status")
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onMutate: async (variables: { taskId: string; isDone: boolean }) => {
      const { taskId, isDone } = variables;
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previous = queryClient.getQueryData<TaskWithLead[]>(["tasks"]) ?? [];
      queryClient.setQueryData<TaskWithLead[]>(["tasks"], (current = []) =>
        current.map((task) => (task.id === taskId ? { ...task, status: isDone ? "done" : "todo" } : task)),
      );
      return { previous };
    },
    onError: (
      _error: unknown,
      _variables: { taskId: string; isDone: boolean },
      context: { previous: TaskWithLead[] } | undefined,
    ) => {
      if (context?.previous) queryClient.setQueryData(["tasks"], context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const moveTaskMutation = useMutation({
    mutationFn: async ({ taskId, dueAtIso }: { taskId: string; dueAtIso: string }) => {
      const { data, error } = await supabase
        .from("tasks")
        .update({ due_at: dueAtIso })
        .eq("id", taskId)
        .select("id,due_at")
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onMutate: async (variables: { taskId: string; dueAtIso: string }) => {
      const { taskId, dueAtIso } = variables;
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previous = queryClient.getQueryData<TaskWithLead[]>(["tasks"]) ?? [];
      queryClient.setQueryData<TaskWithLead[]>(["tasks"], (current = []) =>
        current.map((task) => (task.id === taskId ? { ...task, due_at: dueAtIso } : task)),
      );
      return { previous };
    },
    onError: (
      _error: unknown,
      _variables: { taskId: string; dueAtIso: string },
      context: { previous: TaskWithLead[] } | undefined,
    ) => {
      if (context?.previous) queryClient.setQueryData(["tasks"], context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const groupedTasks = useMemo(() => groupTasks(tasksQuery.data ?? []), [tasksQuery.data]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(monthCursor);
    const monthEnd = endOfMonth(monthCursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const days: Date[] = [];
    let current = gridStart;
    while (current <= gridEnd) {
      days.push(current);
      current = addDays(current, 1);
    }
    return days;
  }, [monthCursor]);

  const onOpenTask = (task: TaskWithLead) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = event.active.data.current as TaskWithLead | undefined;
    const overId = event.over?.id;
    if (!task || typeof overId !== "string" || !overId.startsWith("day-")) return;

    const dayString = overId.slice(4);
    const dueDate = new Date(`${dayString}T09:00:00`);
    if (Number.isNaN(dueDate.getTime())) return;

    moveTaskMutation.mutate({
      taskId: task.id,
      dueAtIso: dueDate.toISOString(),
    });
  };

  return (
    <div className="ui-page px-3 py-5 md:px-6 md:py-6">
      <DailyBriefing userName={typeof userName === "string" ? userName : null} />

      <div className="ui-page-shell">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-zinc-400">Workspace</p>
            <h1 className="text-2xl font-semibold text-zinc-900">Tâches</h1>
            <p className="text-sm text-zinc-500">Planifiez les prochaines actions et relances.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setIsTaskModalOpen(true);
            }}
            className="ui-btn ui-btn-primary"
          >
            <Plus size={14} className="mr-2" />
            Nouvelle tâche
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
          <button
            className={cn(
              "ui-focus rounded-md px-3 py-1.5 text-sm font-medium transition",
              viewMode === "list" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100",
            )}
            onClick={() => setViewMode("list")}
          >
            Liste
          </button>
          <button
            className={cn(
              "ui-focus rounded-md px-3 py-1.5 text-sm font-medium transition",
              viewMode === "calendar" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100",
            )}
            onClick={() => setViewMode("calendar")}
          >
            Calendrier
          </button>
        </div>

        {tasksQuery.isLoading ? (
          <div className="ui-state-box ui-state-loading p-10 text-center text-sm">
            <div className="ui-state-stack">
              <p className="ui-state-title">Chargement des tâches...</p>
              <p className="ui-state-text">Synchronisation de votre planning.</p>
            </div>
          </div>
        ) : null}

        {tasksQuery.isError ? (
          <div className="ui-state-box ui-state-error text-sm">
            <p className="ui-state-title">Impossible de charger les tâches.</p>
            <p className="ui-state-text text-rose-600/90">{taskErrorMessage}</p>
          </div>
        ) : null}

        {!tasksQuery.isLoading && !tasksQuery.isError && viewMode === "list" ? (
          <div className="space-y-6">
            {([
              ["En retard", groupedTasks.overdue],
              ["Aujourd'hui", groupedTasks.today],
              ["Demain", groupedTasks.tomorrow],
            ] as const).map(([title, tasks]) => (
              <section key={title}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
                <div className="space-y-2">
                  {tasks.length === 0 ? (
                    <div className="ui-state-box ui-state-empty border-dashed px-4 py-5 text-sm">
                      <div className="ui-state-stack">
                        <p className="ui-state-title">Aucune tâche</p>
                        <p className="ui-state-text">Ajoutez une action pour cette section.</p>
                      </div>
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onOpenTask={onOpenTask}
                        onToggleDone={(currentTask, checked) =>
                          toggleDoneMutation.mutate({ taskId: currentTask.id, isDone: checked })
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {!tasksQuery.isLoading && !tasksQuery.isError && viewMode === "calendar" ? (
          <div className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonthCursor((previous) => subMonths(previous, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700">
                <CalendarDays size={16} />
                {format(monthCursor, "MMMM yyyy")}
              </div>
              <button
                type="button"
                onClick={() => setMonthCursor((previous) => addMonths(previous, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[640px]">
                  <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
                      <p key={day}>{day}</p>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {calendarDays.map((day) => {
                      const dayTasks = (tasksQuery.data ?? []).filter((task: TaskWithLead) => {
                        if (!task.due_at || task.status === "done") return false;
                        const dueDate = parseISO(task.due_at);
                        if (Number.isNaN(dueDate.getTime())) return false;
                        return isWithinInterval(dueDate, {
                          start: startOfDay(day),
                          end: addDays(startOfDay(day), 1),
                        });
                      });

                      return (
                        <DroppableDay
                          key={day.toISOString()}
                          day={day}
                          tasks={dayTasks}
                          onOpenTask={onOpenTask}
                          onOpenDay={(selectedDay, selectedDayTasks) =>
                            setDayPreview({ day: selectedDay, tasks: selectedDayTasks })
                          }
                          isCurrentMonth={day.getMonth() === monthCursor.getMonth()}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </DndContext>
          </div>
        ) : null}
      </div>

      <TaskModal
        open={isTaskModalOpen || (editingTask ? true : undefined)}
        initialTask={editingTask}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setIsTaskModalOpen(false);
            setEditingTask(null);
          }
        }}
      />

      <SlideOver
        isOpen={Boolean(dayPreview)}
        onClose={() => setDayPreview(null)}
        title={dayPreview ? `Tâches - ${format(dayPreview.day, "dd MMM yyyy")}` : "Tâches"}
      >
        <div className="space-y-2">
          {!dayPreview || dayPreview.tasks.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune tâche pour ce jour.</p>
          ) : (
            dayPreview.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  setDayPreview(null);
                  onOpenTask(task);
                }}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", priorityDotClass[task.priority])} />
                  <p className="text-sm font-medium text-zinc-900">{task.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{task.leads?.name ?? "Aucun lead lié"}</p>
              </button>
            ))
          )}
        </div>
      </SlideOver>
    </div>
  );
}
