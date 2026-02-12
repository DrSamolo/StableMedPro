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
      <section className="ui-state-box ui-state-loading motion-fade-up flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-md text-sm">
        <div className="text-center">
          <p className="ui-state-title">Chargement des conversations...</p>
          <p className="ui-state-text">Préparation de votre espace de discussion.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ui-state-box ui-state-empty motion-fade-up flex min-h-[calc(100vh-9rem)] items-center justify-center rounded-md text-sm">
      <div className="text-center">
        <p className="ui-state-title">Aucune conversation disponible</p>
        <p className="ui-state-text">Créez un channel ou un DM pour commencer.</p>
      </div>
    </section>
  );
}
