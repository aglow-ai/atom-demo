import { AtomsWorkbench } from "@/components/AtomsWorkbench";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AtomsWorkbench projectId={decodeURIComponent(id)} />;
}
