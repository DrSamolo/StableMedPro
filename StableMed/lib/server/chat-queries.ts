import { z } from "zod";

import { createSupabaseServerActionClient } from "@/lib/supabase/server-action-client";
import {
  CreateConversationInputSchema,
  ConversationSchema,
  ConversationParticipantSchema,
  ConversationSummarySchema,
  GetConversationParticipantsInputSchema,
  GetMessagesInputSchema,
  MessageSchema,
  MentionParticipantSchema,
  SendMessageInputSchema,
  type ConversationSummary,
  type Message,
  type MentionParticipant,
} from "@/schemas/chat-conversations";

const ConversationIdSchema = z.string().uuid();

async function getAuthenticatedChatUser() {
  const supabase = await createSupabaseServerActionClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, user, error };
}

export async function requireAuthenticatedChatUser() {
  const { supabase, user, error } = await getAuthenticatedChatUser();

  if (error || !user) {
    throw new Error("Utilisateur non authentifie");
  }

  return { supabase, user };
}

export async function getConversationsServer(): Promise<ConversationSummary[]> {
  const { supabase, user } = await getAuthenticatedChatUser();
  if (!user) {
    return [];
  }

  const { data, error } = await supabase.rpc("get_chat_conversation_summaries", {
    p_limit: 200,
    p_before: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    conversation_id: string;
    conversation_type: "dm" | "group";
    conversation_name: string | null;
    conversation_description: string | null;
    conversation_created_by: string;
    conversation_created_at: string;
    conversation_updated_at: string;
    participants_count: number | null;
    unread_count: number | null;
    last_message_at: string | null;
    last_message_preview: string | null;
  }>;

  return rows.map((row) =>
    ConversationSummarySchema.parse({
      conversation: ConversationSchema.parse({
        id: row.conversation_id,
        type: row.conversation_type,
        name: row.conversation_name,
        description: row.conversation_description,
        created_by: row.conversation_created_by,
        created_at: row.conversation_created_at,
        updated_at: row.conversation_updated_at,
      }),
      participants_count: Number(row.participants_count ?? 0),
      unread_count: Number(row.unread_count ?? 0),
      last_message_at: row.last_message_at,
      last_message_preview: row.last_message_preview,
    }),
  );
}

export async function getMessagesServer(input: z.input<typeof GetMessagesInputSchema>): Promise<Message[]> {
  const parsed = GetMessagesInputSchema.parse(input);
  const { supabase, user } = await getAuthenticatedChatUser();
  if (!user) {
    return [];
  }
  const conversationId = ConversationIdSchema.parse(parsed.conversationId);

  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,sender_id,content,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(parsed.limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => MessageSchema.parse(row));
}

function normalizedMentionFromProfile(profile: { full_name: string | null; email: string | null }) {
  const normalizedFullName = profile.full_name
    ? profile.full_name.trim().toLowerCase().replace(/[^a-zA-Z0-9_.-]/g, "")
    : "";

  if (normalizedFullName.length > 0) {
    return normalizedFullName;
  }

  const emailAlias = profile.email ? profile.email.trim().toLowerCase().split("@")[0] ?? "" : "";
  if (/^[a-z0-9_.-]+$/.test(emailAlias) && emailAlias.length > 0) {
    return emailAlias;
  }

  return null;
}

export async function getConversationParticipantsServer(
  input: z.input<typeof GetConversationParticipantsInputSchema>,
): Promise<MentionParticipant[]> {
  const parsed = GetConversationParticipantsInputSchema.parse(input);
  const { supabase, user } = await getAuthenticatedChatUser();
  if (!user) {
    return [];
  }
  const conversationId = ConversationIdSchema.parse(parsed.conversationId);

  const { data: participantRows, error: participantsError } = await supabase
    .from("conversation_participants")
    .select("conversation_id,user_id,last_read_at,joined_at")
    .eq("conversation_id", conversationId);

  if (participantsError) {
    throw new Error(participantsError.message);
  }

  const participants = (participantRows ?? []).map((row) => ConversationParticipantSchema.parse(row));
  if (participants.length === 0) {
    return [];
  }

  const participantIds = participants.map((participant) => participant.user_id);
  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id,full_name,email,avatar_url")
    .in("id", participantIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const byUserId = new Map(
    (profileRows ?? []).map((profile) => [
      profile.id,
      {
        full_name: profile.full_name,
        email: profile.email,
        avatar_url: profile.avatar_url,
      },
    ]),
  );

  const suggestions = participants
    .map((participant) => {
      const profile = byUserId.get(participant.user_id) ?? {
        full_name: null,
        email: null,
        avatar_url: null,
      };
      const mentionValue = normalizedMentionFromProfile(profile);

      if (!mentionValue) {
        return null;
      }

      const displayName =
        profile.full_name?.trim() ||
        profile.email?.trim().split("@")[0] ||
        `Utilisateur ${participant.user_id.slice(0, 8)}`;

      return MentionParticipantSchema.parse({
        user_id: participant.user_id,
        display_name: displayName,
        mention_value: mentionValue,
        avatar_url: profile.avatar_url,
      });
    })
    .filter((item): item is MentionParticipant => item !== null);

  return suggestions.sort((a, b) => a.display_name.localeCompare(b.display_name, "fr"));
}

export async function sendMessageServer(input: z.input<typeof SendMessageInputSchema>): Promise<Message> {
  const parsed = SendMessageInputSchema.parse(input);
  const { supabase, user } = await requireAuthenticatedChatUser();

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: parsed.conversationId,
      sender_id: user.id,
      content: parsed.content,
    })
    .select("id,conversation_id,sender_id,content,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return MessageSchema.parse(data);
}

export async function createConversationServer(
  input: z.input<typeof CreateConversationInputSchema>,
) {
  const parsed = CreateConversationInputSchema.parse(input);
  const { supabase, user } = await requireAuthenticatedChatUser();

  const { data: conversationData, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      type: "group",
      name: parsed.name,
      description: parsed.description ?? null,
      created_by: user.id,
    })
    .select("id,type,name,description,created_by,created_at,updated_at")
    .single();

  if (conversationError) {
    throw new Error(conversationError.message);
  }

  const conversation = ConversationSchema.parse(conversationData);

  const { error: participantError } = await supabase
    .from("conversation_participants")
    .insert({
      conversation_id: conversation.id,
      user_id: user.id,
    });

  if (participantError) {
    await supabase.from("conversations").delete().eq("id", conversation.id);
    throw new Error(participantError.message);
  }

  return conversation;
}
