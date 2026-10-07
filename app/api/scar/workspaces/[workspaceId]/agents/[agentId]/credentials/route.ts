import { withWorkspaceScarApi } from "../../../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) =>
    api.issueAgentCredential(request, agentId),
  );
}
