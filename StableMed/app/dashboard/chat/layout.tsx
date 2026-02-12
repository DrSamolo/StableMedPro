import { ReactNode } from "react";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { cn } from "@/lib/utils/cn";

type ChatLayoutProps = {
  children: ReactNode;
  params: Promise<{ conversationId?: string }>;
};

export default async function ChatLayout({ children, params }: ChatLayoutProps) {
  const resolvedParams = await params;
  const activeConversationId = resolvedParams?.conversationId ?? null;

  return (
    <div className="ui-page ui-page-shell grid grid-cols-1 gap-2 p-2 sm:gap-3 sm:p-3 lg:grid-cols-[330px_1fr] lg:gap-4 motion-page-enter">
      <div className={cn(activeConversationId ? "hidden lg:block" : "block")}>
        <ChatSidebar activeConversationId={activeConversationId} />
      </div>
      <div className={cn(!activeConversationId ? "hidden lg:block" : "block")}>{children}</div>
    </div>
  );
}
