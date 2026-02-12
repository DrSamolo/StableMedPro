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
    <div className="ui-page ui-page-shell grid grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <ChatSidebar activeConversationId={activeConversationId} />
      {children}
    </div>
  );
}
