"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  ConversationSummarySchema,
  MessageSchema,
  type ConversationSummary,
  type Message,
} from "@/schemas/chat-conversations";

const DEFAULT_MESSAGES_LIMIT = 100;
const DEFAULT_CONVERSATIONS_LIMIT = 40;
const CONVERSATIONS_STALE_TIME_MS = 30_000;
const MESSAGES_STALE_TIME_MS = 15_000;
const LAST_READ_TOUCH_THROTTLE_MS = 20_000;

type UseChatOptions = {
  initialConversations?: ConversationSummary[];
  initialMessages?: Message[];
  messagesLimit?: number;
  conversationsLimit?: number;
  disableConversationsQuery?: boolean;
};

type ConversationSummaryRpcRow = {
  conversation_id: string;
  conversation_type: "dm" | "group";
  conversation_name: string | null;
  conversation_description: string | null;
  conversation_created_by: string;
  conversation_created_at: string;
  conversation_updated_at: string;
  participants_count: number;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  activity_at: string;
};

type ConversationsPage = {
  items: ConversationSummary[];
  nextCursor: string | null;
};

type MessagesPage = {
  items: Message[];
  nextCursor: string | null;
};

export function useChat(conversationId: string | null, options: UseChatOptions = {}) {
  const queryClient = useQueryClient();
  const currentUserIdRef = useRef<string | null>(null);
  const lastReadTouchAtRef = useRef(0);
  const messagesLimit = options.messagesLimit ?? DEFAULT_MESSAGES_LIMIT;
  const conversationsLimit = options.conversationsLimit ?? DEFAULT_CONVERSATIONS_LIMIT;
  const disableConversationsQuery = options.disableConversationsQuery ?? false;
  const conversationMessagesKey = ["chat-v2-messages", conversationId, messagesLimit] as const;

  const conversationsQuery = useInfiniteQuery<ConversationsPage>({
    queryKey: ["chat-v2-conversations", conversationsLimit],
    queryFn: async ({ pageParam }) => {
      const cursor = typeof pageParam === "string" ? pageParam : null;
      const { data, error } = await supabase.rpc("get_chat_conversation_summaries", {
        p_limit: conversationsLimit,
        p_before: cursor,
      });

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as ConversationSummaryRpcRow[];
      const items = rows.map((row) =>
        ConversationSummarySchema.parse({
          conversation: {
            id: String(row.conversation_id),
            type: row.conversation_type,
            name: row.conversation_name,
            description: row.conversation_description,
            created_by: String(row.conversation_created_by),
            created_at: String(row.conversation_created_at),
            updated_at: String(row.conversation_updated_at),
          },
          participants_count: Number(row.participants_count ?? 0),
          unread_count: Number(row.unread_count ?? 0),
          last_message_at: row.last_message_at ? String(row.last_message_at) : null,
          last_message_preview: row.last_message_preview ? String(row.last_message_preview) : null,
        }),
      );
      const nextCursor =
        rows.length >= conversationsLimit ? String(rows[rows.length - 1].activity_at ?? "") || null : null;
      return { items, nextCursor };
    },
    initialData: options.initialConversations
      ? {
          pages: [
            {
              items: options.initialConversations,
              nextCursor:
                options.initialConversations.length >= conversationsLimit
                  ? options.initialConversations[options.initialConversations.length - 1]?.last_message_at ??
                    options.initialConversations[options.initialConversations.length - 1]?.conversation.updated_at ??
                    null
                  : null,
            },
          ],
          pageParams: [null],
        }
      : undefined,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !disableConversationsQuery,
    staleTime: CONVERSATIONS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const conversations = useMemo(() => {
    return (conversationsQuery.data?.pages ?? []).flatMap((page) => page.items);
  }, [conversationsQuery.data]);

  const messagesQuery = useInfiniteQuery<MessagesPage>({
    queryKey: conversationMessagesKey,
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return { items: [], nextCursor: null };
      const cursor = typeof pageParam === "string" ? pageParam : null;

      let request = supabase
        .from("messages")
        .select("id,conversation_id,sender_id,content,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(messagesLimit);
      if (cursor) {
        request = request.lt("created_at", cursor);
      }
      const { data, error } = await request;

      if (error) {
        throw new Error(error.message);
      }

      const parsed = (data ?? []).map((row) => MessageSchema.parse(row));
      const nextCursor = parsed.length >= messagesLimit ? parsed[parsed.length - 1].created_at : null;
      return {
        items: parsed.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        nextCursor,
      };
    },
    initialData:
      options.initialMessages && conversationId
        ? {
            pages: [
              {
                items: options.initialMessages,
                nextCursor:
                  options.initialMessages.length >= messagesLimit
                    ? options.initialMessages[0]?.created_at ?? null
                    : null,
              },
            ],
            pageParams: [null],
          }
        : undefined,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(conversationId),
    staleTime: MESSAGES_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const messages = useMemo(() => {
    const all = (messagesQuery.data?.pages ?? []).flatMap((page) => page.items);
    return [...all].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messagesQuery.data]);

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!conversationId) {
        throw new Error("Aucune conversation selectionnee");
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Utilisateur non authentifie");
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content,
        })
        .select("id,conversation_id,sender_id,content,created_at")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return MessageSchema.parse(data);
    },
    onSuccess: (message) => {
      queryClient.setQueryData<InfiniteData<MessagesPage>>(conversationMessagesKey, (previous) => {
        if (!previous || previous.pages.length === 0) {
          return {
            pages: [{ items: [message], nextCursor: null }],
            pageParams: [null],
          };
        }

        const pages = previous.pages.map((page, index) => {
          if (index !== 0) return page;
          if (page.items.some((existing) => existing.id === message.id)) return page;
          return { ...page, items: [...page.items, message] };
        });
        return { ...previous, pages };
      });
    },
  });

  const resolveCurrentUserId = async () => {
    if (currentUserIdRef.current) {
      return currentUserIdRef.current;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionUserId = session?.user?.id ?? null;
    if (sessionUserId) {
      currentUserIdRef.current = sessionUserId;
      return sessionUserId;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    currentUserIdRef.current = user?.id ?? null;
    return currentUserIdRef.current;
  };

  useEffect(() => {
    if (disableConversationsQuery) {
      return;
    }

    let currentUserId: string | null = null;
    void resolveCurrentUserId().then((value) => {
      currentUserId = value;
    });

    let invalidateTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleConversationsRefresh = () => {
      if (invalidateTimeout) {
        clearTimeout(invalidateTimeout);
      }
      invalidateTimeout = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["chat-v2-conversations"] });
    }, 180);
    };

    const conversationsChannel = supabase
      .channel("chat-v2-conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        scheduleConversationsRefresh();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_participants" },
        (payload) => {
          const next = payload.new as { user_id?: string; last_read_at?: string | null } | undefined;
          const previous = payload.old as { user_id?: string; last_read_at?: string | null } | undefined;

          if (payload.eventType === "UPDATE" && currentUserId && next?.user_id === currentUserId) {
            const changedLastRead = (previous?.last_read_at ?? null) !== (next?.last_read_at ?? null);
            const unchangedUser = (previous?.user_id ?? null) === (next?.user_id ?? null);
            if (changedLastRead && unchangedUser) {
              return;
            }
          }
          scheduleConversationsRefresh();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        scheduleConversationsRefresh();
      })
      .subscribe();

    return () => {
      if (invalidateTimeout) {
        clearTimeout(invalidateTimeout);
      }
      void supabase.removeChannel(conversationsChannel);
    };
  }, [disableConversationsQuery, queryClient]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let isMounted = true;
    const touchLastRead = async () => {
      if (Date.now() - lastReadTouchAtRef.current < LAST_READ_TOUCH_THROTTLE_MS) {
        return;
      }

      const userId = await resolveCurrentUserId();

      if (!isMounted || !userId) return;

      const { error } = await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", userId);

      if (!error) {
        lastReadTouchAtRef.current = Date.now();
        queryClient.setQueriesData<InfiniteData<ConversationsPage>>({ queryKey: ["chat-v2-conversations"] }, (previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.conversation.id === conversationId ? { ...item, unread_count: 0 } : item,
              ),
            })),
          };
        });
        await queryClient.invalidateQueries({ queryKey: ["sidebar-chat-unread-dot"] });
      }
    };

    void touchLastRead();

    const onWindowFocus = () => {
      void touchLastRead();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void touchLastRead();
      }
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [conversationId, queryClient]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const messagesChannel = supabase
      .channel(`chat-v2-messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const incoming = MessageSchema.parse(payload.new);
          queryClient.setQueryData<InfiniteData<MessagesPage>>(conversationMessagesKey, (previous) => {
            if (!previous || previous.pages.length === 0) {
              return {
                pages: [{ items: [incoming], nextCursor: null }],
                pageParams: [null],
              };
            }
            const pages = previous.pages.map((page, index) => {
              if (index !== 0) return page;
              if (page.items.some((message) => message.id === incoming.id)) return page;
              return { ...page, items: [...page.items, incoming] };
            });
            return { ...previous, pages };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = MessageSchema.parse(payload.new);
          queryClient.setQueryData<InfiniteData<MessagesPage>>(conversationMessagesKey, (previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              pages: previous.pages.map((page) => ({
                ...page,
                items: page.items.map((message) => (message.id === updated.id ? updated : message)),
              })),
            };
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const deletedId = String(payload.old.id ?? "");
          queryClient.setQueryData<InfiniteData<MessagesPage>>(conversationMessagesKey, (previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              pages: previous.pages.map((page) => ({
                ...page,
                items: page.items.filter((message) => message.id !== deletedId),
              })),
            };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(messagesChannel);
    };
  }, [conversationId, messagesLimit, queryClient]);

  return {
    conversations,
    messages,
    conversationsQuery,
    messagesQuery,
    sendMessageMutation,
  };
}
