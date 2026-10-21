import { ChatHistoryClient, type ChatHistoryInitialParams } from './ChatHistoryClient';

interface ChatHistoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChatHistoryPage({ searchParams }: ChatHistoryPageProps) {
  const params = await searchParams;
  const initialParams: ChatHistoryInitialParams = {};
  const streamId = firstParam(params.streamId);
  const from = firstParam(params.from);
  const to = firstParam(params.to);
  if (streamId) initialParams.streamId = streamId;
  if (from) initialParams.from = from;
  if (to) initialParams.to = to;

  return <ChatHistoryClient initialParams={initialParams} />;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
