"use server";

import { z } from "zod";

import {
  createConversationServer,
  getConversationParticipantsServer,
  getConversationsServer,
  getMessagesServer,
  sendMessageServer,
} from "@/lib/server/chat-queries";
import {
  type Conversation,
  type ConversationSummary,
  type MentionParticipant,
  type Message,
  CreateConversationInputSchema,
  GetConversationParticipantsInputSchema,
  GetMessagesInputSchema,
  SendMessageInputSchema,
} from "@/schemas/chat-conversations";

export async function getConversations(): Promise<ConversationSummary[]> {
  return getConversationsServer();
}

export async function getMessages(input: z.input<typeof GetMessagesInputSchema>): Promise<Message[]> {
  return getMessagesServer(input);
}

export async function getConversationParticipants(
  input: z.input<typeof GetConversationParticipantsInputSchema>,
): Promise<MentionParticipant[]> {
  return getConversationParticipantsServer(input);
}

export async function sendMessage(input: z.input<typeof SendMessageInputSchema>): Promise<Message> {
  return sendMessageServer(input);
}

export async function createConversation(
  input: z.input<typeof CreateConversationInputSchema>,
): Promise<Conversation> {
  return createConversationServer(input);
}
