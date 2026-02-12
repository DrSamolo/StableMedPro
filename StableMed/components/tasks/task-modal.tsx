"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, Loader2, Search } from "lucide-react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { SlideOver } from "@/components/Common";
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
  low: "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300",
  medium: "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
  high: "border-amber-100 bg-amber-50 text-amber-700 hover:border-amber-200",
  critical: "border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200",
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
    <SlideOver
      isOpen={isOpen}
      onClose={closeModal}
      title={initialTask ? "Modifier la tache" : "Nouvelle tache"}
      maxWidth="xl"
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <label className="ui-field-label">Titre</label>
            <input
              autoFocus
              {...form.register("title")}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900"
              placeholder="Ex: Relancer ce prospect..."
            />
            {form.formState.errors.title ? (
              <p className="text-xs text-rose-600">{form.formState.errors.title.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="ui-field-label">Description</label>
            <textarea
              {...form.register("description")}
              rows={2}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900"
              placeholder="Contexte et prochaine action..."
            />
          </div>

          <div className="space-y-2">
            <label className="ui-field-label">Lead associe</label>
            <div className="rounded-md border border-zinc-200 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={16} />
                <input
                  value={leadSearch}
                  onChange={(event) => setLeadSearch(event.target.value)}
                  placeholder="Rechercher un lead..."
                  className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1">
                {loadingLeads ? <p className="px-2 py-2 text-xs text-zinc-500">Chargement...</p> : null}
                {leadOptions.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => form.setValue("lead_id", lead.id, { shouldDirty: true })}
                    className={cn(
                      "flex w-full items-start justify-between rounded-md px-2 py-1.5 text-left transition",
                      selectedLeadId === lead.id ? "bg-zinc-100" : "hover:bg-zinc-50",
                    )}
                  >
                    <span className="text-sm font-medium text-zinc-800">{lead.name ?? "Lead sans nom"}</span>
                    <span className="text-xs text-zinc-500">{lead.client_reference ?? "Sans societe"}</span>
                  </button>
                ))}
              </div>
              {selectedLead ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Selection: <span className="font-medium text-zinc-800">{selectedLead.name}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="ui-field-label">
                Date et heure
              </label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute right-3 top-2.5 text-zinc-500" size={16} />
                <input
                  type="datetime-local"
                  {...form.register("due_at_local")}
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 pr-10 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="ui-field-label">Statut</label>
              <select
                {...form.register("status")}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-zinc-900"
              >
                <option value="todo">A faire</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminee</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="ui-field-label">Priorite</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {(Object.keys(priorityStyles) as Array<keyof typeof priorityStyles>).map((priority) => {
                const checked = selectedPriority === priority;
                return (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => form.setValue("priority", priority, { shouldDirty: true })}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-medium capitalize transition",
                      priorityStyles[priority],
                      checked ? "ring-1 ring-zinc-700" : "",
                    )}
                  >
                    {priority}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saveTaskMutation.isPending}
              className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saveTaskMutation.isPending ? <Loader2 className="mr-2 animate-spin" size={14} /> : null}
              {initialTask ? "Enregistrer" : "Creer la tache"}
            </button>
          </div>
      </form>
    </SlideOver>
  );
}
