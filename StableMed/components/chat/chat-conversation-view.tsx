"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Trash2 } from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { MentionText } from "@/components/chat/mention-text";
import { useChat } from "@/hooks/use-chat";
import { supabase } from "@/lib/supabase";
import type { ChatActor } from "@/schemas/chat";
import type { MentionParticipant, Message } from "@/schemas/chat-conversations";

type ChatConversationViewProps = {
  actor: ChatActor;
  conversationId: string;
  initialMessages: Message[];
  mentionParticipants: MentionParticipant[];
  title: string;
  canDelete: boolean;
};

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function ChatConversationView({
  actor,
  conversationId,
  initialMessages,
  mentionParticipants,
  title,
  canDelete,
}: ChatConversationViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { messages, messagesQuery, sendMessageMutation } = useChat(conversationId, {
    initialMessages,
    messagesLimit: 100,
    disableConversationsQuery: true,
  });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages],
  );

  function deleteConversation() {
    if (!window.confirm("Supprimer cette conversation ? Cette action est irreversible.")) {
      return;
    }

    setDeleteError(null);
    startDeleteTransition(async () => {
      const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
      if (error) {
        if (error.code === "42501") {
          setDeleteError("Suppression non autorisee: seuls le createur ou un admin peuvent supprimer.");
        } else {
          setDeleteError(error.message);
        }
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["chat-v2-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat-v2-messages"] });
      router.push("/dashboard/chat");
    });
  }

  return (
    <section className="flex h-full min-h-[calc(100vh-9rem)] flex-col rounded-2xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {canDelete ? (
            <button
              type="button"
              onClick={deleteConversation}
              disabled={isDeleting}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Supprimer la conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-[11px] text-zinc-400">Suppression reservee au createur/admin</span>
          )}
        </div>
        {deleteError ? <p className="text-xs text-rose-600">{deleteError}</p> : null}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messagesQuery.hasNextPage ? (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => void messagesQuery.fetchNextPage()}
              disabled={messagesQuery.isFetchingNextPage}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {messagesQuery.isFetchingNextPage ? "Chargement..." : "Afficher les messages precedents"}
            </button>
          </div>
        ) : null}

        {sortedMessages.map((message) => (
          <article key={message.id} className="rounded-xl border border-zinc-200 px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-zinc-800">
                {message.sender_id === actor.id ? "Vous" : `Utilisateur ${message.sender_id.slice(0, 8)}`}
              </p>
              <time className="text-[11px] text-zinc-500">{formatTime(message.created_at)}</time>
            </div>
            <MentionText content={message.content} />
          </article>
        ))}

        {!messagesQuery.isLoading && sortedMessages.length === 0 ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-zinc-500">
            <div className="inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Aucun message.
            </div>
          </div>
        ) : null}
      </div>

      <ChatInput
        participants={mentionParticipants.filter((participant) => participant.user_id !== actor.id)}
        isSending={sendMessageMutation.isPending}
        onSend={async (content) => {
          await sendMessageMutation.mutateAsync(content);
        }}
        errorMessage={sendMessageMutation.error instanceof Error ? sendMessageMutation.error.message : null}
      />
    </section>
  );
}
