"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const MemoryDashboard = dynamic(() => import("@/components/MemoryDashboard"), { ssr: false });

export default function MemoryPageClient() {
  const pathname = usePathname();
  const segments = pathname.split("/");
  const id = segments[2] || "";

  if (!id || id === "_") {
    return null;
  }

  return <MemoryDashboard projectId={id} />;
}
