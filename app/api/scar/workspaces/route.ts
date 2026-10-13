import { withMultiWorkspaceScarApi } from "../runtime";

export async function GET(request: Request) {
  return withMultiWorkspaceScarApi((api) => api.workspaces.listWorkspaces(request));
}

export async function POST(request: Request) {
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.createWorkspace(request),
  );
}
