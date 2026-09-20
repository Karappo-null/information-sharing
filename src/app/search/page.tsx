import ShareboardApp from "@/app/components/shareboard-app";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <ShareboardApp page="search" initialQuery={q ?? ""} />;
}
