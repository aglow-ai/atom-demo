import { LoginPage } from "@/components/LoginPage";

export default async function LoginRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <LoginPage nextPath={params.next} initialError={params.error} />;
}
