import { withMultiWorkspaceScarApi } from "../../../../../../runtime";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; userId: string; role: string }>;
  },
) {
  const { workspaceId, userId, role } = await context.params;
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.assignRole(request, workspaceId, userId, role),
  );
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ workspaceId: string; userId: string; role: string }>;
  },
) {
  const { workspaceId, userId, role } = await context.params;
  return withMultiWorkspaceScarApi((api) =>
    api.workspaces.revokeRole(request, workspaceId, userId, role),
  );
}
