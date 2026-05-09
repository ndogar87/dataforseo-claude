import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";

import { ProjectNotes } from "./project-notes";
import { TaskButtons } from "./task-buttons";

interface ProjectRow {
  id: string;
  workspace_id: string;
  domain: string;
  display_name: string;
  notes_md: string;
}

interface TaskRow {
  id: string;
  type: string;
  status: string;
  cost_usd: number | null;
  created_at: string;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("id, workspace_id, domain, display_name, notes_md")
    .eq("id", id)
    .maybeSingle();

  if (projectError) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn&apos;t load project: {projectError.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  const project = projectData as ProjectRow | null;
  if (!project) notFound();

  const { data: tasksData } = await supabase
    .from("tasks")
    .select("id, type, status, cost_usd, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  const recentTasks = (tasksData ?? []) as TaskRow[];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.display_name}
            </h1>
            <Badge variant="secondary">Active</Badge>
          </div>
          <a
            href={`https://${project.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:underline"
          >
            {project.domain}
          </a>
        </div>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All projects
        </Link>
      </header>

      <Separator />

      <section className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run a task</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskButtons projectId={project.id} domain={project.domain} />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectNotes
              projectId={project.id}
              initialValue={project.notes_md ?? ""}
            />
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tasks yet. Pick one above to get started.
              </p>
            ) : (
              <ul className="divide-y">
                {recentTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex flex-col">
                      <Link
                        href={`/projects/${project.id}/tasks/${task.id}`}
                        className="font-medium hover:underline"
                      >
                        {task.type.replace("_", " ")}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {new Date(task.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        ${(task.cost_usd ?? 0).toFixed(2)}
                      </span>
                      <StatusBadge status={task.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: React.ComponentProps<typeof Badge>["variant"] =
    status === "succeeded"
      ? "default"
      : status === "running"
        ? "default"
        : status === "failed"
          ? "destructive"
          : status === "queued"
            ? "secondary"
            : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}
