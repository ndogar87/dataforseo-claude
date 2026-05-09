import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

import { NewProjectDialog } from "./new-project-dialog";

interface ProjectRow {
  id: string;
  domain: string;
  display_name: string;
  archived_at: string | null;
  updated_at: string;
}

export default async function ProjectsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("projects")
    .select("id, domain, display_name, archived_at, updated_at")
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  const projects = ((data ?? []) as ProjectRow[]) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Every client domain you manage. Click into one to run tasks.
          </p>
        </div>
        <NewProjectDialog />
      </div>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn&apos;t load projects: {error.message}
          </CardContent>
        </Card>
      )}

      {!error && projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <h2 className="text-lg font-medium">No projects yet</h2>
            <p className="text-sm text-muted-foreground">
              Add a domain to get started — most teams begin with a quick scan.
            </p>
            <div className="mt-4">
              <NewProjectDialog />
            </div>
          </CardContent>
        </Card>
      ) : !error ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${p.id}`}
                      className="hover:underline"
                    >
                      {p.display_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.domain}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">Active</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
