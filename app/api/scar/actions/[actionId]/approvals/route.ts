import { withScarApi } from "../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  const { actionId } = await context.params;
  return withScarApi((api) => api.approveAction(request, actionId));
}
