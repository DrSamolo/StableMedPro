"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Trash2, UserPlus, X } from "lucide-react";

import { Avatar, Modal } from "@/components/Common";
import { ChatInput } from "@/components/chat/chat-input";
import { MentionText } from "@/components/chat/mention-text";
import { useChat } from "@/hooks/use-chat";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils/cn";
import type { ChatActor } from "@/schemas/chat";
import { ChatCandidateSchema, type ChatCandidate, type MentionParticipant, type Message } from "@/schemas/chat-conversations";

type ChatConversationViewProps = {
  actor: ChatActor;
  conversationId: string;
  initialMessages: Message[];
  mentionParticipants: MentionParticipant[];
  title: string;
  conversationType: "dm" | "group";
  canDelete: boolean;
  canManageMembers: boolean;
};

type ModalMember = {
  user_id: string;
  display_name: string;
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
  conversationType,
  canDelete,
  canManageMembers,
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
  const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
  const [membersSearch, setMembersSearch] = useState("");
  const [candidateMembers, setCandidateMembers] = useState<ChatCandidate[]>([]);
  const [modalMembers, setModalMembers] = useState<ModalMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [addMembersError, setAddMembersError] = useState<string | null>(null);
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isAddingMembers, startAddMembersTransition] = useTransition();
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
  const participantIds = useMemo(
    () => new Set(mentionParticipants.map((participant) => participant.user_id)),
    [mentionParticipants],
  );
  const currentMembers = useMemo(
    () =>
      mentionParticipants.filter(
        (participant) => participant.mention_value !== "all" && participant.mention_value !== "equipe",
      ),
    [mentionParticipants],
  );
  const effectiveMembers = useMemo(() => {
    if (!isAddMembersOpen) {
      return currentMembers.map((member) => ({
        user_id: member.user_id,
        display_name: member.display_name,
      }));
    }
    return modalMembers;
  }, [currentMembers, isAddMembersOpen, modalMembers]);
  const filteredCandidateMembers = useMemo(() => {
    const keyword = membersSearch.trim().toLowerCase();
    const effectiveMemberIds = new Set(effectiveMembers.map((member) => member.user_id));
    return candidateMembers
      .filter((candidate) => !effectiveMemberIds.has(candidate.user_id))
      .filter((candidate) => {
        if (!keyword) return true;
        const label = candidate.full_name?.trim() || candidate.email || candidate.user_id;
        return label.toLowerCase().includes(keyword) || (candidate.email ?? "").toLowerCase().includes(keyword);
      });
  }, [candidateMembers, effectiveMembers, membersSearch]);

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

  function closeAddMembersModal() {
    setIsAddMembersOpen(false);
    setMembersSearch("");
    setSelectedMemberIds([]);
    setAddMembersError(null);
    setRemoveMemberError(null);
    setRemovingMemberId(null);
    setModalMembers([]);
  }

  async function openAddMembersModal() {
    setAddMembersError(null);
    setRemoveMemberError(null);
    setModalMembers(
      currentMembers.map((member) => ({
        user_id: member.user_id,
        display_name: member.display_name,
      })),
    );
    setIsAddMembersOpen(true);
    const { data, error } = await supabase.rpc("get_chat_candidates");
    if (error) {
      setAddMembersError(error.message);
      return;
    }

    const parsed = (data ?? []).map((row: unknown) => ChatCandidateSchema.parse(row));
    setCandidateMembers(parsed);
  }

  function submitAddMembers() {
    if (selectedMemberIds.length === 0) {
      setAddMembersError("Selectionnez au moins un membre.");
      return;
    }

    setAddMembersError(null);
    startAddMembersTransition(async () => {
      const { error } = await supabase.rpc("add_participants_to_group_conversation", {
        p_conversation_id: conversationId,
        p_participant_ids: selectedMemberIds,
      });

      if (error) {
        setAddMembersError(error.message);
        return;
      }

      setModalMembers((previous) => {
        const map = new Map(previous.map((member) => [member.user_id, member]));
        selectedMemberIds.forEach((id) => {
          const candidate = candidateMembers.find((item) => item.user_id === id);
          if (!candidate) return;
          map.set(id, {
            user_id: id,
            display_name: candidate.full_name?.trim() || candidate.email || id.slice(0, 8),
          });
        });
        return Array.from(map.values());
      });
      setSelectedMemberIds([]);
      setMembersSearch("");
      setAddMembersError(null);
      await queryClient.invalidateQueries({ queryKey: ["chat-v2-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat-v2-messages"] });
      router.refresh();
    });
  }

  function removeMember(userId: string) {
    if (userId === actor.id) {
      setRemoveMemberError("Impossible de vous retirer de ce groupe depuis cette action.");
      return;
    }

    setRemoveMemberError(null);
    setRemovingMemberId(userId);

    startAddMembersTransition(async () => {
      const { error } = await supabase
        .from("conversation_participants")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("user_id", userId);

      if (error) {
        setRemoveMemberError(error.message);
        setRemovingMemberId(null);
        return;
      }

      setSelectedMemberIds((previous) => previous.filter((id) => id !== userId));
      setModalMembers((previous) => previous.filter((member) => member.user_id !== userId));
      setRemovingMemberId(null);
      await queryClient.invalidateQueries({ queryKey: ["chat-v2-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["chat-v2-messages"] });
      router.refresh();
    });
  }

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-subtle motion-fade-up md:h-[calc(100vh-9rem)] md:max-h-[calc(100vh-9rem)]">
      <header className="border-b border-zinc-200 bg-white px-5 py-3.5 motion-fade-up">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-6 text-zinc-900">{title}</h2>
          <div className="flex items-center gap-1">
            {conversationType === "group" && canManageMembers ? (
              <button
                type="button"
                onClick={() => void openAddMembersModal()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 motion-soft-hover motion-soft-press"
                aria-label="Ajouter des membres"
              >
                <UserPlus className="h-4 w-4" />
              </button>
            ) : null}
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

      <Modal isOpen={isAddMembersOpen} onClose={closeAddMembersModal}>
        <div className="w-full max-w-lg rounded-md bg-surface p-6">
          <div className="mb-5 flex items-center justify-between border-b border-zinc-200 pb-3">
            <div>
              <h3 className="text-lg font-medium text-primary">Ajouter des membres</h3>
              <p className="mt-1 text-sm text-secondary">Selectionnez les utilisateurs a ajouter dans ce groupe.</p>
            </div>
            <button
              type="button"
              onClick={closeAddMembersModal}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 motion-soft-hover motion-soft-press"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <input
            value={membersSearch}
            onChange={(event) => setMembersSearch(event.target.value)}
            placeholder="Rechercher un membre..."
            disabled={isAddingMembers}
            className="ui-input mb-3 h-9 px-3"
          />

          <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
              Membres actuels ({effectiveMembers.length})
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {effectiveMembers.map((participant) => (
                <button
                  key={participant.user_id}
                  type="button"
                  onClick={() => removeMember(participant.user_id)}
                  disabled={
                    !canManageMembers ||
                    isAddingMembers ||
                    participant.user_id === actor.id ||
                    removingMemberId === participant.user_id
                  }
                  className={cn(
                    "group inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700 transition",
                    canManageMembers ? "hover:bg-zinc-300" : "",
                      !canManageMembers || participant.user_id === actor.id
                        ? "cursor-default"
                        : "cursor-pointer motion-soft-hover motion-soft-press",
                  )}
                >
                  {participant.display_name}
                  {canManageMembers && participant.user_id !== actor.id ? (
                    <span className="text-zinc-500 transition group-hover:text-zinc-700">
                      {removingMemberId === participant.user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "×"}
                    </span>
                  ) : null}
                </button>
              ))}
              {effectiveMembers.length === 0 ? <span className="text-xs text-zinc-500">Aucun membre.</span> : null}
            </div>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
            {filteredCandidateMembers.map((candidate) => {
              const checked = selectedMemberIds.includes(candidate.user_id);
              const label = candidate.full_name?.trim() || candidate.email || candidate.user_id.slice(0, 8);
              return (
                <label
                  key={candidate.user_id}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-transparent bg-white px-2 py-1.5 text-xs hover:border-zinc-200 hover:bg-zinc-100"
                >
                  <span className="truncate text-zinc-700">{label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedMemberIds((previous) => {
                        if (event.target.checked) {
                          if (previous.includes(candidate.user_id)) return previous;
                          return [...previous, candidate.user_id];
                        }
                        return previous.filter((id) => id !== candidate.user_id);
                      });
                    }}
                    className="h-4 w-4 accent-zinc-700"
                  />
                </label>
              );
            })}
            {filteredCandidateMembers.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-500">Aucun utilisateur disponible.</p>
            ) : null}
          </div>

          {addMembersError ? <p className="mt-3 text-xs text-rose-600">{addMembersError}</p> : null}
          {removeMemberError ? <p className="mt-2 text-xs text-rose-600">{removeMemberError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAddMembersModal}
              className="ui-btn ui-btn-secondary"
              disabled={isAddingMembers}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submitAddMembers}
              className="ui-btn ui-btn-primary"
              disabled={isAddingMembers || selectedMemberIds.length === 0}
            >
              {isAddingMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Ajouter
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
