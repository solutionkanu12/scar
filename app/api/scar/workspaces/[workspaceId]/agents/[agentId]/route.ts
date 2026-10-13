import { withWorkspaceScarApi } from "../../../../runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) =>
    api.getAgent(request, agentId),
  );
}
