"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ChatConversationView } from "@/components/chat/chat-conversation-view";
import { useAuth } from "@/contexts/AuthContext";
import { getCached, setCached } from "@/lib/perf/cache";
import { supabase } from "@/lib/supabase";
import { useSectionPerf } from "@/lib/perf/use-section-perf";
import { ChatActorSchema, type ChatActor } from "@/schemas/chat";
import {
  MessageSchema,
  MentionParticipantSchema,
  type MentionParticipant,
  type Message,
} from "@/schemas/chat-conversations";

type ChatConversationBootstrapProps = {
  conversationId: string;
};

type ConversationHeader = {
  type: "dm" | "group";
  name: string | null;
  created_by: string;
};

type MentionCandidateRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type ChatBootstrapSnapshot = {
  actor: ChatActor;
  title: string;
  initialMessages: Message[];
  canDelete: boolean;
};

const INITIAL_MESSAGES_LIMIT = 60;
const CHAT_BOOTSTRAP_CACHE_TTL_MS = 45_000;
const SPECIAL_MENTIONS: MentionParticipant[] = [
  MentionParticipantSchema.parse({
    user_id: "00000000-0000-0000-0000-000000000000",
    display_name: "Tous les participants",
    mention_value: "all",
    avatar_url: null,
  }),
  MentionParticipantSchema.parse({
    user_id: "00000000-0000-0000-0000-000000000001",
    display_name: "Equipe",
    mention_value: "equipe",
    avatar_url: null,
  }),
];

function conversationTitle(type: "dm" | "group", name: string | null) {
  if (type === "group") return name ?? "Groupe";
  return name ?? "DM";
}

export function ChatConversationBootstrap({ conversationId }: ChatConversationBootstrapProps) {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [actor, setActor] = useState<ChatActor | null>(null);
  const [title, setTitle] = useState<string>("Conversation");
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [mentionParticipants, setMentionParticipants] = useState<MentionParticipant[]>(SPECIAL_MENTIONS);
  const [canDelete, setCanDelete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useSectionPerf("chat", isLoading);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let isMounted = true;

    async function bootstrap() {
      if (!user) {
        if (isMounted) {
          setError("Utilisateur non authentifie");
          setIsLoading(false);
        }
        return;
      }

      const snapshotCacheKey = `chat:bootstrap:${conversationId}:${user.id}`;
      const cachedSnapshot = getCached<ChatBootstrapSnapshot>(snapshotCacheKey, CHAT_BOOTSTRAP_CACHE_TTL_MS);
      const liveActorOverride = ChatActorSchema.parse({
        id: user.id,
        team_id: profile?.team_id ?? cachedSnapshot?.actor.team_id ?? null,
        display_name:
          profile?.full_name ??
          (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null) ??
          user.email ??
          cachedSnapshot?.actor.display_name ??
          null,
        avatar_url:
          profile?.avatar_url ??
          (typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null) ??
          cachedSnapshot?.actor.avatar_url ??
          null,
      });

      if (cachedSnapshot && isMounted) {
        setActor(liveActorOverride);
        setTitle(cachedSnapshot.title);
        setInitialMessages(cachedSnapshot.initialMessages);
        setCanDelete(cachedSnapshot.canDelete);
        setMentionParticipants(SPECIAL_MENTIONS);
        setError(null);
        setIsLoading(false);
      }

      const [{ data: conversationData, error: conversationError }, { data: messagesData, error: messagesError }] =
        await Promise.all([
          supabase.from("conversations").select("id,type,name,created_by").eq("id", conversationId).maybeSingle(),
          supabase
            .from("messages")
            .select("id,conversation_id,sender_id,content,created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(INITIAL_MESSAGES_LIMIT),
        ]);

      if (conversationError) {
        throw new Error(conversationError.message);
      }
      if (messagesError) {
        throw new Error(messagesError.message);
      }

      if (!conversationData) {
        router.replace("/dashboard/chat");
        return;
      }

      const actorValue = liveActorOverride;

      const header = conversationData as ConversationHeader;
      const actorRole = profile?.role?.toLowerCase() ?? null;
      const canDeleteConversation = header.created_by === user.id || actorRole === "admin";
      const parsedMessages = (messagesData ?? [])
        .map((row) => MessageSchema.parse(row))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (!isMounted) return;

      setActor(actorValue);
      setTitle(conversationTitle(header.type, header.name));
      setInitialMessages(parsedMessages);
      setMentionParticipants(SPECIAL_MENTIONS);
      setCanDelete(canDeleteConversation);
      setError(null);
      setIsLoading(false);
      setCached(snapshotCacheKey, {
        actor: actorValue,
        title: conversationTitle(header.type, header.name),
        initialMessages: parsedMessages,
        canDelete: canDeleteConversation,
      });

      // Load mention candidates in background so messages render immediately.
      void (async () => {
        const { data: participantsData, error: participantsError } = await supabase.rpc(
          "get_conversation_mention_candidates",
          { p_conversation_id: conversationId },
        );

        if (participantsError || !isMounted) {
          return;
        }

        const mentionRows = (participantsData ?? []) as MentionCandidateRow[];
        const mentions = mentionRows
          .map((profile) => {
            const normalizedFullName = profile.full_name
              ? profile.full_name.trim().toLowerCase().replace(/[^a-zA-Z0-9_.-]/g, "")
              : "";
            const emailAlias = profile.email ? profile.email.trim().toLowerCase().split("@")[0] ?? "" : "";
            const mentionValue = normalizedFullName || emailAlias;

            if (!mentionValue) return null;

            return MentionParticipantSchema.parse({
              user_id: profile.user_id,
              display_name:
                profile.full_name?.trim() || emailAlias || `Utilisateur ${String(profile.user_id).slice(0, 8)}`,
              mention_value: mentionValue.toLowerCase(),
              avatar_url: profile.avatar_url ?? null,
            });
          })
          .filter((item: MentionParticipant | null): item is MentionParticipant => item !== null);

        setMentionParticipants([...mentions, ...SPECIAL_MENTIONS]);
      })();
    }

    bootstrap().catch((bootstrapError: unknown) => {
      if (!isMounted) return;
      setError(bootstrapError instanceof Error ? bootstrapError.message : "Erreur de chargement");
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [authLoading, conversationId, profile, router, user]);

  if (isLoading) {
    return (
      <section className="ui-state-box ui-state-loading motion-fade-up flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-md text-sm">
        <div className="text-center">
          <p className="ui-state-title">Chargement de la conversation...</p>
          <p className="ui-state-text">Récupération des messages et participants.</p>
        </div>
      </section>
    );
  }

  if (!actor || error) {
    return (
      <section className="ui-state-box ui-state-error motion-fade-up flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-md text-sm">
        <div className="text-center">
          <p className="ui-state-title">Conversation indisponible</p>
          <p className="ui-state-text">{error ?? "Impossible de charger la conversation."}</p>
        </div>
      </section>
    );
  }

  return (
    <ChatConversationView
      actor={actor}
      conversationId={conversationId}
      initialMessages={initialMessages}
      mentionParticipants={mentionParticipants}
      title={title}
      canDelete={canDelete}
    />
  );
}
