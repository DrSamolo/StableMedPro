"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerActionClient } from "@/lib/supabase/server-action-client";
import { TaskPrioritySchema, TaskStatusSchema } from "@/schemas/tasks";

const mutableTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  priority: TaskPrioritySchema.default("medium"),
  status: TaskStatusSchema.default("todo"),
});

const taskStatusUpdateSchema = z.object({
  taskId: z.string().uuid(),
  isDone: z.boolean(),
});

const moveTaskDueDateSchema = z.object({
  taskId: z.string().uuid(),
  dueAtIso: z.string().datetime({ offset: true }),
});

export async function createTask(input: z.input<typeof mutableTaskSchema>) {
  const parsedInput = mutableTaskSchema.parse(input);
  const supabase = await createSupabaseServerActionClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Utilisateur non authentifie");
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title: parsedInput.title,
      description: parsedInput.description ?? null,
      lead_id: parsedInput.lead_id ?? null,
      priority: parsedInput.priority,
      status: parsedInput.status,
      due_at: parsedInput.due_at ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/tasks");
  return data;
}

export async function updateTask(taskId: string, input: Partial<z.input<typeof mutableTaskSchema>>) {
  const parsedTaskId = z.string().uuid().parse(taskId);
  const parsedInput = mutableTaskSchema.partial().parse(input);
  const supabase = await createSupabaseServerActionClient();

  if (Object.keys(parsedInput).length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(parsedInput)
    .eq("id", parsedTaskId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/tasks");
  return data;
}

export async function updateTaskStatus(input: z.input<typeof taskStatusUpdateSchema>) {
  const parsedInput = taskStatusUpdateSchema.parse(input);
  const supabase = await createSupabaseServerActionClient();

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: parsedInput.isDone ? "done" : "todo",
    })
    .eq("id", parsedInput.taskId)
    .select("id,status")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/tasks");
  return data;
}

export async function moveTaskDueDate(input: z.input<typeof moveTaskDueDateSchema>) {
  const parsedInput = moveTaskDueDateSchema.parse(input);
  const supabase = await createSupabaseServerActionClient();

  const { data, error } = await supabase
    .from("tasks")
    .update({
      due_at: parsedInput.dueAtIso,
    })
    .eq("id", parsedInput.taskId)
    .select("id,due_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/tasks");
  return data;
}
