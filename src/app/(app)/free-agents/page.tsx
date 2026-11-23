import { FreeAgentsView } from "@/components/views/free-agents-view";

export const metadata = { title: "Free agents" };

export default async function FreeAgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <FreeAgentsView sp={await searchParams} />;
}
