import { withWorkspaceScarApi } from "../../../../../../runtime";

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
      agentId: string;
      credentialId: string;
    }>;
  },
) {
  const { workspaceId, agentId, credentialId } = await context.params;
  return withWorkspaceScarApi(workspaceId, (api) =>
    api.revokeAgentCredential(request, agentId, credentialId),
  );
}
