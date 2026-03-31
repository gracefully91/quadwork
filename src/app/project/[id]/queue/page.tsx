import QueueManager from "@/components/QueueManager";

interface QueuePageProps {
  params: Promise<{ id: string }>;
}

export default async function QueuePage({ params }: QueuePageProps) {
  const { id } = await params;
  return <QueueManager projectId={id} />;
}
