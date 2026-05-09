import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { Toaster } from "sonner";

import { Separator } from "@/components/ui/separator";
import { WorkspaceProvider } from "@/lib/workspace-context";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO: real auth guard
  // const supabase = await createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  // if (!user) redirect("/login");
  // const workspace = await fetchActiveWorkspace(supabase, user.id);

  return (
    <WorkspaceProvider>
      <Toaster position="top-right" richColors closeButton />
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 md:flex">
          <div className="flex h-14 items-center px-6">
            <Link
              href="/projects"
              className="text-sm font-semibold tracking-tight"
            >
              DataForSEO Studio
            </Link>
          </div>
          <Separator />
          <nav className="flex flex-1 flex-col gap-1 p-3 text-sm">
            <Link
              href="/projects"
              className="flex items-center gap-2 rounded-md px-3 py-2 font-medium text-foreground hover:bg-accent"
            >
              <FolderKanban className="h-4 w-4" />
              Projects
            </Link>
          </nav>
          <Separator />
          <div className="p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Agency</div>
            <div>internal tier</div>
          </div>
        </aside>
        <main className="flex-1">
          <header className="flex h-14 items-center justify-between border-b px-6 md:hidden">
            <Link href="/projects" className="text-sm font-semibold">
              DataForSEO Studio
            </Link>
          </header>
          <div className="px-6 py-8">{children}</div>
        </main>
      </div>
    </WorkspaceProvider>
  );
}
