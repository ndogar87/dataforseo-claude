"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
}

const STUB_WORKSPACE: Workspace = {
  id: "ws_agency",
  name: "Agency",
  slug: "agency",
  plan_tier: "internal",
};

const WorkspaceContext = createContext<Workspace>(STUB_WORKSPACE);

/**
 * Workspace provider. Phase 1 ships a single internal-tier workspace
 * (the agency itself) so the default value is hard-coded. Phase 2 will
 * resolve the active workspace from `workspace_members` for the signed-in
 * user and pass it in via the `workspace` prop.
 */
export function WorkspaceProvider({
  children,
  workspace = STUB_WORKSPACE,
}: {
  children: ReactNode;
  workspace?: Workspace;
}) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
