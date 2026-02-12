import { z } from "zod";

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const TaskStatusSchema = z.enum(["todo", "in_progress", "done"]);

const DueAtSchema = z
  .union([z.string().min(1, "La date d'echeance est invalide"), z.date()])
  .pipe(z.coerce.date())
  .nullable()
  .optional()
  .refine((value) => value == null || !Number.isNaN(value.getTime()), {
    message: "due_at doit etre une date ISO valide ou un objet Date",
  });

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    lead_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1, "Le titre est requis").max(200),
    description: z.string().max(5000).nullable().optional(),
    priority: TaskPrioritySchema.default("medium"),
    status: TaskStatusSchema.default("todo"),
    due_at: DueAtSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
  })
  .strict();

export const CreateTaskInputSchema = z
  .object({
    user_id: z.string().uuid(),
    lead_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1, "Le titre est requis").max(200),
    description: z.string().max(5000).nullable().optional(),
    priority: TaskPrioritySchema.default("medium"),
    status: TaskStatusSchema.default("todo"),
    due_at: DueAtSchema,
  })
  .strict();

export const UpdateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    status: TaskStatusSchema.optional(),
    due_at: DueAtSchema,
    lead_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Au moins un champ doit etre fourni pour la mise a jour",
  });

export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
