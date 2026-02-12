"use client";

import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";

import { CreateConversationButton } from "@/components/chat/create-conversation-button";
import { CreateDmButton } from "@/components/chat/create-dm-button";
import { useChat } from "@/hooks/use-chat";
import { cn } from "@/lib/utils/cn";
import type { ConversationSummary } from "@/schemas/chat-conversations";

type ChatSidebarProps = {
  activeConversationId?: string | null;
  initialConversations?: ConversationSummary[];
};

function labelForConversation(type: "dm" | "group", name: string | null) {
  if (type === "group") return name ?? "Groupe";
  return name ?? "DM";
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatUnreadCount(value: number) {
  if (value <= 0) return "";
  if (value > 9) return "9+";
  return String(value);
}

export function ChatSidebar({ activeConversationId = null, initialConversations }: ChatSidebarProps) {
  const { conversations, conversationsQuery } = useChat(null, { initialConversations });
  const groupConversations = conversations.filter((summary) => summary.conversation.type === "group");
  const dmConversations = conversations.filter((summary) => summary.conversation.type === "dm");

  return (
    <aside className="flex h-full min-h-[calc(100vh-9rem)] flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">Conversations</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
          <Users className="h-3.5 w-3.5" /> chat
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <CreateDmButton />
        <CreateConversationButton />
      </div>

      <div className="space-y-1 overflow-y-auto">
        {groupConversations.length > 0 ? <p className="px-1 pb-1 pt-1 text-[11px] font-medium text-zinc-400">Channels</p> : null}
        {groupConversations.map((summary) => {
          const conversation = summary.conversation;
          const isActive = activeConversationId === conversation.id;

          return (
            <div key={conversation.id}>
              <Link
                href={`/dashboard/chat/${conversation.id}`}
                className={cn(
                  "relative block w-full rounded-lg border px-3 py-2 text-left transition",
                  isActive
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                {summary.unread_count > 0 ? (
                  <span className="absolute right-3 top-[0.62rem] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black px-1 text-[8px] font-semibold text-white">
                    {formatUnreadCount(summary.unread_count)}
                  </span>
                ) : null}
                <div className="mb-1 pr-6">
                  <p className={cn("truncate text-sm font-medium", isActive ? "text-white" : "text-zinc-800")}>
                    {labelForConversation(conversation.type, conversation.name)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-xs", isActive ? "text-zinc-300" : "text-zinc-500")}>
                    {summary.last_message_preview ?? "Aucun message"}
                  </p>
                  <span className={cn("shrink-0 text-[10px]", isActive ? "text-zinc-300" : "text-zinc-500")}>
                    {formatTime(summary.last_message_at)}
                  </span>
                </div>
              </Link>
            </div>
          );
        })}

        {dmConversations.length > 0 ? <p className="px-1 pb-1 pt-3 text-[11px] font-medium text-zinc-400">Direct Messages</p> : null}
        {dmConversations.map((summary) => {
          const conversation = summary.conversation;
          const isActive = activeConversationId === conversation.id;

          return (
            <div key={conversation.id}>
              <Link
                href={`/dashboard/chat/${conversation.id}`}
                className={cn(
                  "relative block w-full rounded-lg border px-3 py-2 text-left transition",
                  isActive
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:border-zinc-300",
                )}
              >
                {summary.unread_count > 0 ? (
                  <span className="absolute right-3 top-[0.62rem] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black px-1 text-[8px] font-semibold text-white">
                    {formatUnreadCount(summary.unread_count)}
                  </span>
                ) : null}
                <div className="mb-1 pr-6">
                  <p className={cn("truncate text-sm font-medium", isActive ? "text-white" : "text-zinc-800")}>
                    {labelForConversation(conversation.type, conversation.name)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-xs", isActive ? "text-zinc-300" : "text-zinc-500")}>
                    {summary.last_message_preview ?? "Aucun message"}
                  </p>
                  <span className={cn("shrink-0 text-[10px]", isActive ? "text-zinc-300" : "text-zinc-500")}>
                    {formatTime(summary.last_message_at)}
                  </span>
                </div>
              </Link>
            </div>
          );
        })}

        {conversations.length === 0 ? (
          <div className="ui-state-box ui-state-empty rounded-lg border-dashed p-4 text-center text-sm">
            <div className="mb-2 inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Aucune conversation
            </div>
            <p className="text-xs text-zinc-400">Crée une conversation pour commencer.</p>
          </div>
        ) : null}

        {conversationsQuery.hasNextPage ? (
          <button
            type="button"
            onClick={() => void conversationsQuery.fetchNextPage()}
            disabled={conversationsQuery.isFetchingNextPage}
            className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {conversationsQuery.isFetchingNextPage ? "Chargement..." : "Charger plus"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
