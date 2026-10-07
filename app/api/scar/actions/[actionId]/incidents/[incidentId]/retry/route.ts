import { withScarApi } from "../../../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string; incidentId: string }> },
) {
  const { actionId, incidentId } = await context.params;
  return withScarApi((api) => api.retryIncident(request, actionId, incidentId));
}
