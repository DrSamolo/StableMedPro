import { ReactNode } from "react";

import { ChatSidebar } from "@/components/chat/chat-sidebar";

type ChatLayoutProps = {
  children: ReactNode;
  params: Promise<{ conversationId?: string }>;
};

export default async function ChatLayout({ children, params }: ChatLayoutProps) {
  const resolvedParams = await params;
  const activeConversationId = resolvedParams?.conversationId ?? null;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 bg-zinc-50 p-4 lg:grid-cols-[320px_1fr]">
      <ChatSidebar activeConversationId={activeConversationId} />
      {children}
    </div>
  );
}
