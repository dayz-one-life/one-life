import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { QueryProvider } from "@/components/query-provider";

export const metadata = { robots: { index: false, follow: false } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await apiGet<{ user?: unknown } | null>("/api/auth/get-session").catch(() => null);
  if (!session || !session.user) redirect("/login");
  return <QueryProvider>{children}</QueryProvider>;
}
