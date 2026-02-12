"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, Loader2, Search, X } from "lucide-react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { cn } from "@/lib/utils/cn";
import { supabase } from "@/lib/supabase";
import { TaskPrioritySchema, TaskStatusSchema } from "@/schemas/tasks";

type LeadOption = {
  id: string;
  name: string | null;
  client_reference: string | null;
};

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  lead_id: string | null;
  due_at: string | null;
  priority: z.infer<typeof TaskPrioritySchema>;
  status: z.infer<typeof TaskStatusSchema>;
};

const taskModalFormSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis").max(200),
  description: z.string().max(5000).optional(),
  lead_id: z.string().uuid().nullable().optional(),
  due_at_local: z.string().optional(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
});

type TaskModalFormValues = z.infer<typeof taskModalFormSchema>;

const priorityStyles: Record<z.infer<typeof TaskPrioritySchema>, string> = {
  low: "border-zinc-200 text-zinc-600 hover:border-zinc-300",
  medium: "border-blue-200 text-blue-700 hover:border-blue-300",
  high: "border-amber-200 text-amber-700 hover:border-amber-300",
  critical: "border-rose-200 text-rose-700 hover:border-rose-300",
};

function toLocalDateTimeInput(isoDate: string | null | undefined) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

function localInputToIso(localDateTime: string | undefined) {
  if (!localDateTime) return null;
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function TaskModal({
  open,
  onOpenChange,
  initialTask,
  initialLeadId,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialTask?: EditableTask | null;
  initialLeadId?: string | null;
}) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const actionFromUrl = searchParams.get("action");
  const leadIdFromUrl = searchParams.get("leadId");
  const urlControlledOpen = actionFromUrl === "create-task";
  const isOpen = open ?? urlControlledOpen;

  const form = useForm<TaskModalFormValues>({
    resolver: zodResolver(taskModalFormSchema),
    defaultValues: {
      title: initialTask?.title ?? "",
      description: initialTask?.description ?? "",
      lead_id: initialTask?.lead_id ?? initialLeadId ?? leadIdFromUrl ?? null,
      due_at_local: toLocalDateTimeInput(initialTask?.due_at),
      priority: initialTask?.priority ?? "medium",
      status: initialTask?.status ?? "todo",
    },
  });

  useEffect(() => {
    if (!isOpen) return;

    form.reset({
      title: initialTask?.title ?? "",
      description: initialTask?.description ?? "",
      lead_id: initialTask?.lead_id ?? initialLeadId ?? leadIdFromUrl ?? null,
      due_at_local: toLocalDateTimeInput(initialTask?.due_at),
      priority: initialTask?.priority ?? "medium",
      status: initialTask?.status ?? "todo",
    });
  }, [form, initialLeadId, initialTask, isOpen, leadIdFromUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const leadId = form.getValues("lead_id");
    if (!leadId) return;

    let active = true;
    void supabase
      .from("leads")
      .select("id,name,client_reference")
      .eq("id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setLeadOptions((previous) => {
          if (previous.some((lead) => lead.id === data.id)) return previous;
          return [data as LeadOption, ...previous];
        });
      });

    return () => {
      active = false;
    };
  }, [form, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const timeout = setTimeout(async () => {
      setLoadingLeads(true);
      const query = leadSearch.trim();
      const request = supabase
        .from("leads")
        .select("id,name,client_reference")
        .order("created_at", { ascending: false })
        .limit(8);

      const { data } =
        query.length > 0
          ? await request.or(`name.ilike.%${query}%,client_reference.ilike.%${query}%`)
          : await request;

      if (active) {
        setLeadOptions((data ?? []) as LeadOption[]);
        setLoadingLeads(false);
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [isOpen, leadSearch]);

  const closeModal = () => {
    onOpenChange?.(false);
    if (!urlControlledOpen) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    params.delete("leadId");
    params.delete("stage");
    const target = params.toString().length > 0 ? `${pathname}?${params.toString()}` : pathname;
    router.replace(target);
  };

  const saveTaskMutation = useMutation<unknown, Error, TaskModalFormValues>({
    mutationFn: async (values: TaskModalFormValues) => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Utilisateur non authentifie");
      }

      const payload = {
        user_id: user.id,
        title: values.title,
        description: values.description?.trim() || null,
        lead_id: values.lead_id ?? null,
        priority: values.priority,
        status: values.status,
        due_at: localInputToIso(values.due_at_local),
      };

      if (initialTask?.id) {
        const { data, error } = await supabase
          .from("tasks")
          .update({
            title: payload.title,
            description: payload.description,
            lead_id: payload.lead_id,
            priority: payload.priority,
            status: payload.status,
            due_at: payload.due_at,
          })
          .eq("id", initialTask.id)
          .select("*")
          .single();

        if (error) throw new Error(error.message);
        return data;
      }

      const { data, error } = await supabase.from("tasks").insert(payload).select("*").single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      closeModal();
    },
  });

  const onSubmit: SubmitHandler<TaskModalFormValues> = (values) => {
    saveTaskMutation.mutate(values);
  };

  const selectedLeadId = useWatch({ control: form.control, name: "lead_id" });
  const selectedPriority = useWatch({ control: form.control, name: "priority" });
  const selectedLead = useMemo(
    () => leadOptions.find((lead) => lead.id === selectedLeadId) ?? null,
    [leadOptions, selectedLeadId],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-900/35 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">New task</p>
            <h2 className="text-xl font-semibold text-zinc-900">
              {initialTask ? "Update next step" : "Capture next steps"}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Close task modal"
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5 px-6 py-6"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Title</label>
            <input
              autoFocus
              {...form.register("title")}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900"
              placeholder="Follow up with ..."
            />
            {form.formState.errors.title ? (
              <p className="text-xs text-rose-600">{form.formState.errors.title.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Description</label>
            <textarea
              {...form.register("description")}
              rows={4}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900"
              placeholder="Context and next action..."
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Related lead</label>
            <div className="rounded-xl border border-zinc-200 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
                <input
                  value={leadSearch}
                  onChange={(event) => setLeadSearch(event.target.value)}
                  placeholder="Search lead or company..."
                  className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {loadingLeads ? <p className="px-2 py-2 text-xs text-zinc-500">Loading leads...</p> : null}
                {leadOptions.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => form.setValue("lead_id", lead.id, { shouldDirty: true })}
                    className={cn(
                      "flex w-full items-start justify-between rounded-lg px-2 py-2 text-left transition",
                      selectedLeadId === lead.id ? "bg-zinc-100" : "hover:bg-zinc-50",
                    )}
                  >
                    <span className="text-sm font-medium text-zinc-800">{lead.name ?? "Lead sans nom"}</span>
                    <span className="text-xs text-zinc-500">{lead.client_reference ?? "No company"}</span>
                  </button>
                ))}
              </div>
              {selectedLead ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Selected: <span className="font-medium text-zinc-800">{selectedLead.name}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Due date & time
              </label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute right-3 top-2.5 text-zinc-500" size={16} />
                <input
                  type="datetime-local"
                  {...form.register("due_at_local")}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 pr-10 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</label>
              <select
                {...form.register("status")}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none transition focus:border-zinc-900"
              >
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Priority</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {(Object.keys(priorityStyles) as Array<keyof typeof priorityStyles>).map((priority) => {
                const checked = selectedPriority === priority;
                return (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => form.setValue("priority", priority, { shouldDirty: true })}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-medium capitalize transition",
                      priorityStyles[priority],
                      checked ? "ring-1 ring-zinc-900" : "bg-white",
                    )}
                  >
                    {priority}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveTaskMutation.isPending}
              className="inline-flex items-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saveTaskMutation.isPending ? <Loader2 className="mr-2 animate-spin" size={14} /> : null}
              {initialTask ? "Save changes" : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
