import { withWorkspaceScarApi } from "../../../../../../../runtime";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      actionId: string;
      incidentId: string;
    }>;
  },
) {
  const { workspaceId, actionId, incidentId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) =>
    api.retryIncident(request, actionId, incidentId),
  );
}
