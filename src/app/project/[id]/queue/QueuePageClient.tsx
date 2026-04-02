"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const QueueManager = dynamic(() => import("@/components/QueueManager"), { ssr: false });

export default function QueuePageClient() {
  const pathname = usePathname();
  const segments = pathname.split("/");
  const id = segments[2] || "";

  if (!id || id === "_") {
    return null;
  }

  return <QueueManager projectId={id} />;
}
