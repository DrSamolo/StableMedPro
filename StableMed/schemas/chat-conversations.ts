import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ConversationTypeSchema = z.enum(["dm", "group"]);

export const ConversationSchema = z
  .object({
    id: z.string().uuid(),
    type: ConversationTypeSchema,
    name: z.string().trim().min(1).max(120).nullable(),
    description: z.string().max(2000).nullable(),
    created_by: z.string().uuid(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
  })
  .strict();

export const ConversationParticipantSchema = z
  .object({
    conversation_id: z.string().uuid(),
    user_id: z.string().uuid(),
    last_read_at: IsoDateTimeSchema.nullable(),
    joined_at: IsoDateTimeSchema,
  })
  .strict();

export const MessageSchema = z
  .object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    sender_id: z.string().uuid(),
    content: z.string().trim().min(1).max(4000),
    created_at: IsoDateTimeSchema,
  })
  .strict();

export const MentionParticipantSchema = z
  .object({
    user_id: z.string().uuid(),
    display_name: z.string().trim().min(1).max(160),
    mention_value: z.string().trim().min(1).max(80).regex(/^[a-z0-9_.-]+$/),
    avatar_url: z.string().trim().min(1).max(2048).nullable(),
  })
  .strict();

export const ChatCandidateSchema = z
  .object({
    user_id: z.string().uuid(),
    full_name: z.string().nullable(),
    email: z.string().email().nullable(),
    avatar_url: z.string().trim().min(1).max(2048).nullable(),
  })
  .strict();

export const ConversationSummarySchema = z
  .object({
    conversation: ConversationSchema,
    participants_count: z.number().int().nonnegative(),
    unread_count: z.number().int().nonnegative(),
    last_message_at: IsoDateTimeSchema.nullable(),
    last_message_preview: z.string().nullable(),
  })
  .strict();

export const GetMessagesInputSchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.number().int().positive().max(500).default(100),
});

export const GetConversationParticipantsInputSchema = z.object({
  conversationId: z.string().uuid(),
});

export const SendMessageInputSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
});

export const CreateConversationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type MentionParticipant = z.infer<typeof MentionParticipantSchema>;
export type ChatCandidate = z.infer<typeof ChatCandidateSchema>;
