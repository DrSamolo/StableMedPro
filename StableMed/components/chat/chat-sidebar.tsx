"use client";

import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";

import { CreateConversationButton } from "@/components/chat/create-conversation-button";
import { CreateDmButton } from "@/components/chat/create-dm-button";
import { useAuth } from "@/contexts/AuthContext";
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
  const { profile } = useAuth();
  const { conversations, conversationsQuery } = useChat(null, { initialConversations });
  const canCreateGroupConversation = profile?.role === "admin" || profile?.role === "manager";
  const groupConversations = conversations.filter((summary) => summary.conversation.type === "group");
  const dmConversations = conversations.filter((summary) => summary.conversation.type === "dm");

  return (
    <aside className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] flex-col overflow-hidden rounded-md border border-zinc-200 bg-white p-3 shadow-subtle motion-fade-up md:h-[calc(100vh-9rem)] md:max-h-[calc(100vh-9rem)]">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-[15px] font-semibold leading-6 text-zinc-900">Conversations</h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">
          <Users className="h-3.5 w-3.5" /> chat
        </span>
      </div>

      <div className={cn("mb-4 gap-2", canCreateGroupConversation ? "grid grid-cols-2" : "grid grid-cols-1")}>
        <CreateDmButton />
        {canCreateGroupConversation ? <CreateConversationButton /> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50/60 p-2">
        {groupConversations.length > 0 ? <p className="px-1 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">Channels</p> : null}
        {groupConversations.map((summary) => {
          const conversation = summary.conversation;
          const isActive = activeConversationId === conversation.id;

          return (
            <div key={conversation.id}>
              <Link
                href={`/dashboard/chat/${conversation.id}`}
                className={cn(
                  "relative block w-full rounded-md border px-3 py-2.5 text-left transition motion-soft-hover motion-soft-press motion-fade-up",
                  isActive
                    ? "border-zinc-300 bg-white text-zinc-900 shadow-subtle"
                    : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-100/80",
                )}
              >
                {isActive ? <span className="absolute left-0 top-2 h-[calc(100%-1rem)] w-0.5 rounded-r bg-zinc-700" /> : null}
                {summary.unread_count > 0 ? (
                  <span className="absolute right-3 top-[0.68rem] inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-zinc-300 bg-zinc-200 px-1 text-[9px] font-semibold text-zinc-700">
                    {formatUnreadCount(summary.unread_count)}
                  </span>
                ) : null}
                <div className="mb-1 pr-6">
                  <p className={cn("truncate text-sm font-medium leading-5", isActive ? "text-zinc-900" : "text-zinc-800")}>
                    {labelForConversation(conversation.type, conversation.name)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-[12px]", isActive ? "text-zinc-700" : "text-zinc-600")}>
                    {summary.last_message_preview ?? "Aucun message"}
                  </p>
                  <span className={cn("shrink-0 text-[11px] tabular-nums", isActive ? "text-zinc-700" : "text-zinc-600")}>
                    {formatTime(summary.last_message_at)}
                  </span>
                </div>
              </Link>
            </div>
          );
        })}

        {dmConversations.length > 0 ? <p className="px-1 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">Direct Messages</p> : null}
        {dmConversations.map((summary) => {
          const conversation = summary.conversation;
          const isActive = activeConversationId === conversation.id;

          return (
            <div key={conversation.id}>
              <Link
                href={`/dashboard/chat/${conversation.id}`}
                className={cn(
                  "relative block w-full rounded-md border px-3 py-2.5 text-left transition motion-soft-hover motion-soft-press motion-fade-up",
                  isActive
                    ? "border-zinc-300 bg-white text-zinc-900 shadow-subtle"
                    : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-100/80",
                )}
              >
                {isActive ? <span className="absolute left-0 top-2 h-[calc(100%-1rem)] w-0.5 rounded-r bg-zinc-700" /> : null}
                {summary.unread_count > 0 ? (
                  <span className="absolute right-3 top-[0.68rem] inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-zinc-300 bg-zinc-200 px-1 text-[9px] font-semibold text-zinc-700">
                    {formatUnreadCount(summary.unread_count)}
                  </span>
                ) : null}
                <div className="mb-1 pr-6">
                  <p className={cn("truncate text-sm font-medium leading-5", isActive ? "text-zinc-900" : "text-zinc-800")}>
                    {labelForConversation(conversation.type, conversation.name)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-[12px]", isActive ? "text-zinc-700" : "text-zinc-600")}>
                    {summary.last_message_preview ?? "Aucun message"}
                  </p>
                  <span className={cn("shrink-0 text-[11px] tabular-nums", isActive ? "text-zinc-700" : "text-zinc-600")}>
                    {formatTime(summary.last_message_at)}
                  </span>
                </div>
              </Link>
            </div>
          );
        })}

        {conversations.length === 0 ? (
          <div className="ui-state-box ui-state-empty rounded-md border-dashed p-4 text-center">
            <div className="mb-2 inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="ui-state-title">Aucune conversation</span>
            </div>
            <p className="ui-state-text">Crée une conversation pour commencer.</p>
          </div>
        ) : null}

        {conversationsQuery.hasNextPage ? (
          <button
            type="button"
            onClick={() => void conversationsQuery.fetchNextPage()}
            disabled={conversationsQuery.isFetchingNextPage}
            className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 motion-soft-hover motion-soft-press"
          >
            {conversationsQuery.isFetchingNextPage ? "Chargement..." : "Charger plus"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
