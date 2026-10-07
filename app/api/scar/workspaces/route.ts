import { withMultiWorkspaceScarApi } from "../runtime";

export async function POST(request: Request) {
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.createWorkspace(request),
  );
}
