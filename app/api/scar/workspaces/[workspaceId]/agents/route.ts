import { withWorkspaceScarApi } from "../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) => api.registerAgent(request));
}
