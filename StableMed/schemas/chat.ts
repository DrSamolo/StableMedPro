import { z } from "zod";

export const ChatChannelTypeSchema = z.enum(["team", "lead"]);

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const NullableTrimmedNonEmptyStringSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().min(1).max(160).nullable(),
);
const NullableUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().url().nullable(),
);

export const ChatChannelSchema = z
  .object({
    id: z.string().uuid(),
    team_id: z.string().uuid(),
    type: ChatChannelTypeSchema.default("team"),
    name: z.string().trim().min(1).max(120),
    slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
    created_by: z.string().uuid().nullable(),
    archived_at: IsoDateTimeSchema.nullable(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
  })
  .strict();

export const ChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    channel_id: z.string().uuid(),
    sender_id: z.string().uuid(),
    sender_name: z.string().trim().min(1).max(160),
    sender_avatar_url: NullableUrlSchema.optional(),
    body: z.string().trim().min(1).max(4000),
    metadata: z.record(z.unknown()),
    edited_at: IsoDateTimeSchema.nullable(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
  })
  .strict();

export const CreateChatChannelInputSchema = z
  .object({
    team_id: z.string().uuid(),
    created_by: z.string().uuid(),
    name: z.string().trim().min(2).max(120),
    type: ChatChannelTypeSchema.default("team"),
  })
  .strict();

export const CreateChatMessageInputSchema = z
  .object({
    channel_id: z.string().uuid(),
    sender_id: z.string().uuid(),
    sender_name: z.string().trim().min(1).max(160),
    sender_avatar_url: NullableUrlSchema.optional(),
    body: z.string().trim().min(1).max(4000),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const ChatActorSchema = z
  .object({
    id: z.string().uuid(),
    team_id: z.string().uuid().nullable(),
    display_name: NullableTrimmedNonEmptyStringSchema,
    avatar_url: NullableUrlSchema,
  })
  .strict();

export type ChatChannel = z.infer<typeof ChatChannelSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type CreateChatChannelInput = z.infer<typeof CreateChatChannelInputSchema>;
export type CreateChatMessageInput = z.infer<typeof CreateChatMessageInputSchema>;
export type ChatActor = z.infer<typeof ChatActorSchema>;
