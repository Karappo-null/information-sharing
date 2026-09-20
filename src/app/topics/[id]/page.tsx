"use client";

import { useParams } from "next/navigation";
import ShareboardApp from "@/app/components/shareboard-app";

export default function TopicPage() {
  const params = useParams<{ id: string }>();
  return <ShareboardApp page="topic" topicId={params.id} />;
}
