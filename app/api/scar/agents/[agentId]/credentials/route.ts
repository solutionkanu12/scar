import { withScarApi } from "../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  return withScarApi((api) => api.issueAgentCredential(request, agentId));
}
