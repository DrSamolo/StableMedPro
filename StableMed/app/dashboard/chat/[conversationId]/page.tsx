import { ChatConversationBootstrap } from "@/components/chat/chat-conversation-bootstrap";

type ConversationPageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({ params }: ConversationPageProps) {
  const { conversationId } = await params;
  return <ChatConversationBootstrap conversationId={conversationId} />;
}
