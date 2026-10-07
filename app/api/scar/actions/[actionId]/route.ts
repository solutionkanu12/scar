import { withScarApi } from "../../runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  const { actionId } = await context.params;
  return withScarApi((api) => api.getActionState(request, actionId));
}
