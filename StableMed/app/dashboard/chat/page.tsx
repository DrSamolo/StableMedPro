"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

type ConversationSummaryRow = {
  conversation_id: string;
};

export default function ChatIndexPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const resolveFirstConversation = async () => {
      const { data, error } = await supabase.rpc("get_chat_conversation_summaries", {
        p_limit: 1,
        p_before: null,
      });

      if (!mounted) return;

      if (error) {
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as ConversationSummaryRow[];
      const firstId = rows[0]?.conversation_id;

      if (firstId) {
        router.replace(`/dashboard/chat/${firstId}`);
        return;
      }

      setIsLoading(false);
    };

    void resolveFirstConversation();
    return () => {
      mounted = false;
    };
  }, [router]);

  if (isLoading) {
    return (
      <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <p className="text-sm text-zinc-500">Chargement des conversations...</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-2xl border border-zinc-200 bg-white">
      <p className="text-sm text-zinc-500">Aucune conversation disponible.</p>
    </section>
  );
}
