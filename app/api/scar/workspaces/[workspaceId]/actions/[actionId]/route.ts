import { withWorkspaceScarApi } from "../../../../runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; actionId: string }> },
) {
  const { workspaceId, actionId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) =>
    api.getActionState(request, actionId),
  );
}
