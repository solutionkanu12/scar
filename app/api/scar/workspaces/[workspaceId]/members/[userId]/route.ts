import { withMultiWorkspaceScarApi } from "../../../../runtime";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const { workspaceId, userId } = await context.params;
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.revokeMember(request, workspaceId, userId),
  );
}
