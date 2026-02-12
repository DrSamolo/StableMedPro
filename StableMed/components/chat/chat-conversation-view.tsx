"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Trash2 } from "lucide-react";

import { Avatar, Modal } from "@/components/Common";
import { ChatInput } from "@/components/chat/chat-input";
import { MentionText } from "@/components/chat/mention-text";
import { useChat } from "@/hooks/use-chat";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils/cn";
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const messagesScrollerRef = useRef<HTMLDivElement | null>(null);
  const messagesBottomRef = useRef<HTMLDivElement | null>(null);
  const previousMessagesCountRef = useRef(0);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages],
  );
  const participantByUserId = useMemo(() => {
    const map = new Map<string, MentionParticipant>();
    mentionParticipants.forEach((participant) => {
      map.set(participant.user_id, participant);
    });
    return map;
  }, [mentionParticipants]);

  useEffect(() => {
    previousMessagesCountRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    const scroller = messagesScrollerRef.current;
    if (!scroller || sortedMessages.length === 0) return;

    const previousCount = previousMessagesCountRef.current;
    const latestMessage = sortedMessages[sortedMessages.length - 1];
    const latestIsOwn = latestMessage?.sender_id === actor.id;
    const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const isNearBottom = distanceToBottom < 96;
    const hasNewMessage = sortedMessages.length > previousCount;
    const shouldSnapToBottom = previousCount === 0 || (hasNewMessage && (isNearBottom || latestIsOwn));

    if (shouldSnapToBottom) {
      messagesBottomRef.current?.scrollIntoView({
        behavior: latestIsOwn && previousCount > 0 ? "smooth" : "auto",
        block: "end",
      });
    }

    previousMessagesCountRef.current = sortedMessages.length;
  }, [actor.id, sortedMessages]);

  function deleteConversation() {
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
    <section className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-subtle motion-fade-up md:h-[calc(100vh-9rem)] md:max-h-[calc(100vh-9rem)]">
      <header className="border-b border-zinc-200 bg-white px-5 py-3.5 motion-fade-up">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-6 text-zinc-900">{title}</h2>
          {canDelete ? (
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(true)}
              disabled={isDeleting}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 motion-soft-hover motion-soft-press"
              aria-label="Supprimer la conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500">Suppression reservee au createur/admin</span>
          )}
        </div>
        {deleteError ? <p className="text-xs text-rose-600">{deleteError}</p> : null}
      </header>

      <div ref={messagesScrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50/70 px-3 py-3.5 sm:px-5 sm:py-4">
        {messagesQuery.hasNextPage ? (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => void messagesQuery.fetchNextPage()}
              disabled={messagesQuery.isFetchingNextPage}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 motion-soft-hover motion-soft-press"
            >
              {messagesQuery.isFetchingNextPage ? "Chargement..." : "Afficher les messages precedents"}
            </button>
          </div>
        ) : null}

        {sortedMessages.map((message, idx) => {
          const isOwnMessage = message.sender_id === actor.id;
          const messageAuthor = participantByUserId.get(message.sender_id);
          const displayName = isOwnMessage
            ? actor.display_name ?? "Vous"
            : messageAuthor?.display_name ?? `Utilisateur ${message.sender_id.slice(0, 8)}`;
          const avatarSrc = isOwnMessage ? actor.avatar_url : messageAuthor?.avatar_url;
          return (
            <div
              key={message.id}
              className={cn("flex w-full items-end gap-2 motion-fade-up", isOwnMessage ? "justify-end" : "justify-start")}
              style={{ animationDelay: `${Math.min(idx * 20, 220)}ms` }}
            >
              {!isOwnMessage ? <Avatar name={displayName} src={avatarSrc} size="sm" /> : null}
              <article
                className={cn(
                  "max-w-[84%] rounded-md border px-3.5 py-2.5 sm:max-w-[78%]",
                  isOwnMessage ? "border-zinc-300 bg-white shadow-subtle" : "border-zinc-200 bg-zinc-100/70",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="truncate text-[12px] font-semibold leading-5 text-zinc-900">
                    {isOwnMessage ? "Vous" : displayName}
                  </p>
                  <time className="text-[11px] tabular-nums text-zinc-600">{formatTime(message.created_at)}</time>
                </div>
                <MentionText content={message.content} />
              </article>
              {isOwnMessage ? <Avatar name={displayName} src={avatarSrc} size="sm" /> : null}
            </div>
        )})}

        {!messagesQuery.isLoading && sortedMessages.length === 0 ? (
          <div className="ui-state-box ui-state-empty flex h-full min-h-[200px] items-center justify-center rounded-md">
            <div className="text-center">
              <div className="mb-2 inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
                <span className="ui-state-title">Aucun message</span>
              </div>
              <p className="ui-state-text">Envoyez le premier message pour démarrer la conversation.</p>
            </div>
          </div>
        ) : null}
        <div ref={messagesBottomRef} />
      </div>

      <ChatInput
        participants={mentionParticipants.filter((participant) => participant.user_id !== actor.id)}
        isSending={sendMessageMutation.isPending}
        onSend={async (content) => {
          await sendMessageMutation.mutateAsync(content);
        }}
        errorMessage={sendMessageMutation.error instanceof Error ? sendMessageMutation.error.message : null}
      />

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-md rounded-md bg-surface p-6">
          <div className="mb-5 border-b border-zinc-200 pb-3">
            <h3 className="text-lg font-medium text-primary">Supprimer la conversation</h3>
            <p className="mt-1 text-sm text-secondary">
              Cette action est irréversible. Voulez-vous continuer ?
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="ui-btn ui-btn-secondary"
              disabled={isDeleting}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => {
                setIsDeleteConfirmOpen(false);
                deleteConversation();
              }}
              className="ui-btn ui-btn-primary"
              disabled={isDeleting}
            >
              Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
