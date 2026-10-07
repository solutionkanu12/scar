import { withMultiWorkspaceScarApi } from "../../../runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.addMember(request, workspaceId),
  );
}
